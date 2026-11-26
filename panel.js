// What the panel shows and does: each CodeZ key signed in to magpie (its
// name, address, group and models), how fast each of CodeZ's addresses
// answers it, a model asked on each API, and a key added, changed (its
// key, address or name) or removed.
//
// The keys are read from magpie's plugin-auth.json, and only their last
// four characters leave this file. They are written through the client
// magpie hands the plugin (client.auth.set / auth.remove), which saves
// plugin-auth.json under its lock and tells magpie, so the account is
// loaded again with what changed.

import fs from "node:fs"
import path from "node:path"
import { apisOf, BASE, BASES, baseOf, familyOf, geminiURL, ID, normalBase } from "./codez.js"

const CUSTOM = "custom"
const TIMEOUT = 60000

// tail is what the panel shows of a key: its last four characters.
export function tail(key) {
  return typeof key === "string" && key.length > 4 ? "…" + key.slice(-4) : "…"
}

// accountsIn are CodeZ's accounts in plugin-auth.json's contents (all):
// the one under "codez" first, then codez#<slot>, as magpie orders them.
export function accountsIn(all) {
  return Object.keys(all ?? {})
    .filter((k) => (k === ID || k.startsWith(ID + "#")) && all[k]?.type === "api" && typeof all[k].key === "string")
    .sort((a, b) => (a === ID ? -1 : b === ID ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map((k) => ({ id: k, auth: all[k] }))
}

// freshID is where a new key goes: "codez" while that is free, else
// codez#<six letters or digits>, as magpie names another sign-in.
export function freshID(all, random = () => Math.random().toString(36).slice(2, 8)) {
  if (!(ID in (all ?? {}))) return ID
  for (;;) {
    const k = ID + "#" + random()
    if (!(k in all)) return k
  }
}

// nameOf is the name the user gave a key, "" for none.
export function nameOf(auth) {
  const n = auth?.metadata?.name
  return typeof n === "string" ? n.trim() : ""
}

// authWith is auth with what the panel changed: its key, its address
// (one of BASES, or a typed one) and its name; what else its metadata
// holds stays. null with why when a change doesn't hold.
export function authWith(auth, { key, base, customBase, name } = {}) {
  const md = { ...(auth?.metadata ?? {}) }
  const out = { ...(auth ?? {}), type: "api" }
  if (key !== undefined) {
    const k = String(key).trim()
    if (!k) return { error: "密钥不能为空" }
    if (/\s/.test(k)) return { error: "密钥里不能有空格或换行" }
    out.key = k
  }
  if (!out.key) return { error: "密钥不能为空" }
  if (base !== undefined) {
    if (base === CUSTOM) {
      const b = normalBase(customBase)
      if (!b) return { error: "自定义地址要是 http(s) 地址，比如 https://api.codezsy.com/v1" }
      md.base = CUSTOM
      md.customBase = b
    } else if (BASES.some((x) => x.value === base) || base === BASE) {
      md.base = base
      delete md.customBase
    } else return { error: "没有这个地址" }
  }
  if (name !== undefined) {
    const n = String(name).trim()
    if (n.length > 40) return { error: "名字最多 40 个字" }
    if (n) md.name = n
    else delete md.name
  }
  if (Object.keys(md).length) out.metadata = md
  else delete out.metadata
  return { auth: out }
}

// list asks base for the models key lists: {status, ms, models, error}.
export async function list(fetchImpl, base, key, timeout = 15000) {
  const t0 = performance.now()
  let res
  try {
    res = await fetchImpl(`${base}/models`, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    })
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), error: reason(e) }
  }
  const ms = Math.round(performance.now() - t0)
  let body = null
  try {
    body = await res.json()
  } catch {}
  if (!res.ok) return { status: res.status, ms, error: errorOf(body) || `HTTP ${res.status}` }
  if (!Array.isArray(body?.data)) return { status: res.status, ms, error: "CodeZ 没有回模型列表" }
  const models = body.data
    .filter((m) => typeof m?.id === "string" && m.id)
    .map((m) => {
      const types = Array.isArray(m.supported_endpoint_types) ? m.supported_endpoint_types.filter((t) => typeof t === "string") : []
      const { npm, also } = apisOf(m.id, types)
      return { id: m.id, family: familyOf(m.id), types, uses: API_OF[npm], also: also.map((x) => API_OF[x]) }
    })
  return { status: res.status, ms, models }
}

// the API each AI SDK package of a model's row is, as the panel names it
const API_OF = { "@ai-sdk/openai-compatible": "chat", "@ai-sdk/openai": "responses", "@ai-sdk/anthropic": "messages", "@ai-sdk/google": "gemini" }
// the API each of CodeZ's supported_endpoint_types is
export const TYPE_API = { openai: "chat", "openai-response": "responses", anthropic: "messages", gemini: "gemini" }
export const APIS = ["chat", "responses", "messages", "gemini"]

function reason(e) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "超时"
  return e?.cause?.code || e?.message || String(e)
}

function errorOf(body) {
  const e = body?.error
  if (typeof e === "string") return e
  if (typeof e?.message === "string") return e.message
  if (typeof body?.message === "string") return body.message
  return ""
}

// probe is the smallest request for model on api at base: what is sent.
export function probe(api, base, key, model) {
  const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" }
  const ask = "Reply with the word ok."
  switch (api) {
    case "chat":
      return { url: `${base}/chat/completions`, headers: auth, body: { model, messages: [{ role: "user", content: ask }], max_tokens: 16 } }
    case "responses":
      return { url: `${base}/responses`, headers: auth, body: { model, input: ask, max_output_tokens: 16 } }
    case "messages":
      return { url: `${base}/messages`, headers: { ...auth, "x-api-key": key, "anthropic-version": "2023-06-01" }, body: { model, max_tokens: 16, messages: [{ role: "user", content: ask }] } }
    case "gemini":
      return {
        url: geminiURL(`${base}/models/${encodeURIComponent(model)}:generateContent`, base),
        headers: { ...auth, "x-goog-api-key": key },
        body: { contents: [{ role: "user", parts: [{ text: ask }] }], generationConfig: { maxOutputTokens: 16 } },
      }
  }
  return null
}

// tryAPI asks model on api once: {api, status, ms, ok, error, text}.
export async function tryAPI(fetchImpl, api, base, key, model, timeout = TIMEOUT) {
  const p = probe(api, base, key, model)
  if (!p) return { api, ok: false, status: 0, ms: 0, error: "没有这个接口" }
  const t0 = performance.now()
  let res
  try {
    res = await fetchImpl(p.url, { method: "POST", headers: p.headers, body: JSON.stringify(p.body), signal: AbortSignal.timeout(timeout), redirect: "error" })
  } catch (e) {
    return { api, ok: false, status: 0, ms: Math.round(performance.now() - t0), error: reason(e) }
  }
  const raw = await res.text().catch(() => "")
  const ms = Math.round(performance.now() - t0)
  let body = null
  try {
    body = JSON.parse(raw)
  } catch {}
  if (!res.ok) return { api, ok: false, status: res.status, ms, error: (errorOf(body) || raw || `HTTP ${res.status}`).slice(0, 400) }
  return { api, ok: true, status: res.status, ms, text: textOf(api, body).slice(0, 80) }
}

function textOf(api, b) {
  try {
    if (api === "chat") return b.choices?.[0]?.message?.content ?? ""
    if (api === "responses") return (b.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("")
    if (api === "messages") return (b.content ?? []).map((c) => c.text ?? "").join("")
    if (api === "gemini") return (b.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("")
  } catch {}
  return ""
}

// Panel is the panel's state over magpie's config folder: the accounts
// read from plugin-auth.json, what was last learned of each, and the
// changes, made through client.
export class Panel {
  constructor({ configDir, client, fetchImpl = globalThis.fetch, log = () => {} }) {
    this.file = path.join(configDir, "plugin-auth.json")
    this.client = client
    this.fetch = fetchImpl
    this.log = log
    this.checks = new Map() // account id → {at, base, status, ms, models, error}
    this.speeds = null // {at, rows: [{id, base, label, status, ms, error}]}
    this.events = []
  }

  note(msg) {
    this.events.push({ at: Date.now(), msg })
    if (this.events.length > 100) this.events.shift()
    this.log(msg)
  }

  all() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"))
    } catch (e) {
      if (e?.code === "ENOENT") return {}
      throw new Error(`读不了 ${this.file}：${e.message}`)
    }
  }

  accounts() {
    return accountsIn(this.all())
  }

  // status is what the panel draws; no key goes in it but its tail.
  status() {
    const accounts = this.accounts().map(({ id, auth }, i) => {
      const md = auth.metadata ?? {}
      const base = baseOf(auth)
      const c = this.checks.get(id)
      return {
        id,
        first: i === 0,
        name: nameOf(auth),
        key: tail(auth.key),
        base,
        choice: md.base === CUSTOM ? CUSTOM : BASES.some((b) => b.value === md.base) ? md.base : md.base ? CUSTOM : "",
        customBase: md.base === CUSTOM ? (normalBase(md.customBase) ?? "") : "",
        check: c && c.key === auth.key && c.base === base ? { at: c.at, status: c.status, ms: c.ms, error: c.error, models: c.models } : null,
      }
    })
    // which address each key goes to now, not when it was timed
    const now = new Map(accounts.map((a) => [a.id, a.base]))
    const speeds = this.speeds && { at: this.speeds.at, rows: this.speeds.rows.map((r) => ({ ...r, current: now.get(r.id) === r.base })) }
    return {
      at: Date.now(),
      file: this.file,
      bases: BASES.map((b) => ({ value: b.value, label: b.label, hint: b.hintZh })),
      fallback: BASE,
      accounts,
      speeds,
      events: this.events,
    }
  }

  find(id) {
    const a = this.accounts().find((x) => x.id === id)
    if (!a) throw Object.assign(new Error("没有这把密钥（可能已经在 magpie 里删掉了），刷新一下"), { code: 404 })
    return a
  }

  // check lists each key's models at its address (or only id's).
  async check(id) {
    const list_ = id ? [this.find(id)] : this.accounts()
    await Promise.all(
      list_.map(async ({ id, auth }) => {
        const base = baseOf(auth)
        const r = await list(this.fetch, base, auth.key)
        this.checks.set(id, { at: Date.now(), key: auth.key, base, ...r })
      }),
    )
  }

  // speed asks each of CodeZ's addresses (and a key's own typed one) for
  // each key's models, twice, and keeps the faster: no tokens are spent.
  async speed() {
    const accts = this.accounts()
    const rows = []
    await Promise.all(
      accts.flatMap(({ id, auth }) => {
        const own = baseOf(auth)
        const bases = [...BASES.map((b) => ({ value: b.value, label: b.label }))]
        if (!bases.some((b) => b.value === own)) bases.push({ value: own, label: new URL(own).host })
        return bases.map(async (b) => {
          let best = null
          for (let i = 0; i < 2; i++) {
            const r = await list(this.fetch, b.value, auth.key)
            if (!best || (r.status === 200 && (best.status !== 200 || r.ms < best.ms))) best = r
          }
          rows.push({ id, base: b.value, label: b.label, status: best.status, ms: best.ms, error: best.error, models: best.models?.length ?? null })
        })
      }),
    )
    const order = new Map(accts.map((a, i) => [a.id, i]))
    rows.sort((a, b) => order.get(a.id) - order.get(b.id) || a.label.localeCompare(b.label))
    this.speeds = { at: Date.now(), rows }
    this.note(`测速：${accts.length} 把密钥 × ${new Set(rows.map((r) => r.base)).size} 个地址`)
    return this.speeds
  }

  // test asks model on each API at id's address.
  async test(id, model, apis = APIS) {
    const { auth } = this.find(id)
    if (typeof model !== "string" || !model.trim()) throw Object.assign(new Error("选一个模型"), { code: 400 })
    const base = baseOf(auth)
    const out = await Promise.all(apis.filter((a) => APIS.includes(a)).map((a) => tryAPI(this.fetch, a, base, auth.key, model.trim())))
    this.note(`测试 ${model}（${nameOf(auth) || tail(auth.key)}）：` + out.map((r) => `${r.api} ${r.ok ? r.ms + "ms" : "✗ " + (r.status || r.error)}`).join("，"))
    return { at: Date.now(), id, model, base, results: out }
  }

  // save changes id's key, address or name; a new key is asked for its
  // models first, and one CodeZ refuses isn't saved.
  async save(id, change) {
    const { auth } = this.find(id)
    return this.write(id, auth, change, "已修改")
  }

  // add signs in one more key, as magpie's own sign-in would.
  async add(change) {
    return this.write(freshID(this.all()), null, { base: BASES[0].value, ...change }, "已添加")
  }

  async write(id, auth, change, did) {
    const r = authWith(auth, change)
    if (r.error) throw Object.assign(new Error(r.error), { code: 400 })
    const next = r.auth
    const moved = !auth || next.key !== auth.key || baseOf(next) !== baseOf(auth)
    if (moved) {
      const c = await list(this.fetch, baseOf(next), next.key)
      if (c.status === 401 || c.status === 403) throw Object.assign(new Error(`CodeZ 拒绝了这把密钥（HTTP ${c.status}）：${c.error}`), { code: 400 })
      if (c.status !== 200) throw Object.assign(new Error(`${baseOf(next)} 没有列出模型（${c.status ? "HTTP " + c.status : c.error}），没有保存`), { code: 502 })
      this.checks.set(id, { at: Date.now(), key: next.key, base: baseOf(next), ...c })
    }
    await this.client.auth.set({ path: { id }, body: next })
    this.note(`${did} ${nameOf(next) || id}（${tail(next.key)} · ${new URL(baseOf(next)).host}）`)
    return { id }
  }

  async remove(id) {
    const { auth } = this.find(id)
    await this.client.auth.remove({ path: { id } })
    this.checks.delete(id)
    this.note(`已删除 ${nameOf(auth) || id}（${tail(auth.key)}）`)
    return { id }
  }
}
