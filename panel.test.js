import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { accountsIn, authWith, freshID, list, Panel, probe, tail, tryAPI } from "./panel.js"

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const MODELS = {
  data: [
    { id: "gemini-4-neon", supported_endpoint_types: ["openai", "openai-response", "anthropic", "gemini"] },
    { id: "claude-opus-5-5", supported_endpoint_types: ["anthropic", "openai"] },
  ],
}

// a CodeZ that knows the keys in good, and a client that saves as magpie's
function world(auth) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codez-panel-"))
  const file = path.join(dir, "plugin-auth.json")
  fs.writeFileSync(file, JSON.stringify(auth))
  const seen = []
  const good = new Set(["sk-a1111", "sk-b2222", "sk-n3333"])
  const fetchImpl = async (url, init) => {
    const key = (init?.headers?.authorization ?? "").replace("Bearer ", "")
    seen.push({ url, key, body: init?.body })
    if (!good.has(key)) return json(401, { error: { message: "无效的令牌" } })
    if (url.endsWith("/models")) return json(200, MODELS)
    return json(200, { choices: [{ message: { content: "ok" } }] })
  }
  const client = {
    auth: {
      set: async ({ path: { id }, body }) => {
        const all = JSON.parse(fs.readFileSync(file, "utf8"))
        all[id] = body
        fs.writeFileSync(file, JSON.stringify(all))
        return { data: true }
      },
      remove: async ({ path: { id } }) => {
        const all = JSON.parse(fs.readFileSync(file, "utf8"))
        delete all[id]
        fs.writeFileSync(file, JSON.stringify(all))
        return { data: true }
      },
    },
  }
  const read = () => JSON.parse(fs.readFileSync(file, "utf8"))
  return { panel: new Panel({ configDir: dir, client, fetchImpl }), seen, read }
}

describe("the keys in plugin-auth.json", () => {
  test("CodeZ's own, the first one first; only a key's tail is shown", () => {
    const all = { "codez#b": { type: "api", key: "k2" }, other: { type: "api", key: "x" }, codez: { type: "api", key: "k1" }, "codez#a": { type: "oauth" } }
    expect(accountsIn(all).map((a) => a.id)).toEqual(["codez", "codez#b"])
    expect(tail("sk-abcdef1234")).toBe("…1234")
    expect(tail("ab")).toBe("…")
  })

  test("a new key goes under codez while that's free", () => {
    expect(freshID({})).toBe("codez")
    expect(freshID({ codez: {} }, () => "x1y2z3")).toBe("codez#x1y2z3")
  })

  test("a change keeps what else the key had", () => {
    const was = { type: "api", key: "sk-a1111", metadata: { base: "https://api-s.codezsy.com/v1", other: 1 } }
    expect(authWith(was, { name: " Claude 组 " }).auth).toEqual({ type: "api", key: "sk-a1111", metadata: { base: "https://api-s.codezsy.com/v1", other: 1, name: "Claude 组" } })
    expect(authWith(was, { base: "custom", customBase: "my.relay" }).error).toContain("http")
    expect(authWith(was, { base: "custom", customBase: "https://my.relay.dev" }).auth.metadata).toMatchObject({ base: "custom", customBase: "https://my.relay.dev/v1" })
    expect(authWith(was, { base: "https://evil.example/v1" }).error).toBe("没有这个地址")
    expect(authWith(was, { key: "sk a" }).error).toContain("空格")
    expect(authWith({ type: "api", key: "k", metadata: { name: "x" } }, { name: "" }).auth).toEqual({ type: "api", key: "k" })
    expect(authWith(null, {}).error).toBe("密钥不能为空")
  })
})

describe("asking CodeZ", () => {
  test("a key's models, with the API magpie asks each on", async () => {
    const r = await list(async () => json(200, MODELS), "https://api.codezsy.com/v1", "sk-a1111")
    expect(r.status).toBe(200)
    expect(r.models[0]).toMatchObject({ id: "gemini-4-neon", family: "Gemini", uses: "gemini" })
    expect(r.models[0].also).toEqual(["chat", "responses", "messages"])
    expect(r.models[1]).toMatchObject({ uses: "messages", also: ["chat"] })
    const bad = await list(async () => json(401, { error: { message: "无效的令牌" } }), "https://x/v1", "k")
    expect(bad).toMatchObject({ status: 401, error: "无效的令牌" })
    const down = await list(async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }) }, "https://x/v1", "k")
    expect(down).toMatchObject({ status: 0, error: "ECONNREFUSED" })
  })

  test("each API's smallest request, Gemini's at /v1beta", () => {
    const b = "https://api-s.codezsy.com/v1"
    expect(probe("chat", b, "k", "m").url).toBe(b + "/chat/completions")
    expect(probe("responses", b, "k", "m").body.max_output_tokens).toBe(16)
    expect(probe("messages", b, "k", "m").headers["x-api-key"]).toBe("k")
    expect(probe("gemini", b, "k", "gemini-4-neon").url).toBe("https://api-s.codezsy.com/v1beta/models/gemini-4-neon:generateContent")
  })

  test("a model asked on an API: its reply, or CodeZ's error", async () => {
    const ok = await tryAPI(async () => json(200, { content: [{ type: "text", text: "ok" }] }), "messages", "https://x/v1", "k", "claude")
    expect(ok).toMatchObject({ api: "messages", ok: true, status: 200, text: "ok" })
    const no = await tryAPI(async () => json(503, { error: { message: "当前分组上游负载已饱和" } }), "gemini", "https://x/v1", "k", "m")
    expect(no).toMatchObject({ ok: false, status: 503, error: "当前分组上游负载已饱和" })
  })
})

describe("the panel", () => {
  test("status shows each key's name, tail and address, never the key", async () => {
    const { panel } = world({ codez: { type: "api", key: "sk-a1111", metadata: { name: "Claude" } }, "codez#x": { type: "api", key: "sk-b2222", metadata: { base: "https://api-s.codezsy.com/v1" } } })
    await panel.check()
    const s = panel.status()
    expect(s.accounts.map((a) => [a.id, a.name, a.key, a.base, a.choice])).toEqual([
      ["codez", "Claude", "…1111", "https://api.codezsy.com/v1", ""],
      ["codez#x", "", "…2222", "https://api-s.codezsy.com/v1", "https://api-s.codezsy.com/v1"],
    ])
    expect(s.accounts[0].check.models.length).toBe(2)
    expect(JSON.stringify(s)).not.toContain('"sk-a1111"')
  })

  test("a changed key is tried first; one CodeZ refuses isn't saved", async () => {
    const { panel, read } = world({ codez: { type: "api", key: "sk-a1111" } })
    await expect(panel.save("codez", { key: "sk-w4444" })).rejects.toThrow("拒绝")
    expect(read().codez.key).toBe("sk-a1111")
    await panel.save("codez", { key: "sk-n3333", name: "国模", base: "https://api-s.codezsy.com/v1" })
    expect(read().codez).toEqual({ type: "api", key: "sk-n3333", metadata: { base: "https://api-s.codezsy.com/v1", name: "国模" } })
  })

  test("a name alone is saved without asking CodeZ", async () => {
    const { panel, read, seen } = world({ codez: { type: "api", key: "sk-a1111" } })
    await panel.save("codez", { name: "主" })
    expect(seen).toEqual([])
    expect(read().codez.metadata).toEqual({ name: "主" })
  })

  test("add and remove", async () => {
    const { panel, read } = world({ codez: { type: "api", key: "sk-a1111" } })
    const { id } = await panel.add({ key: "sk-b2222", name: "Gemini" })
    expect(id).toMatch(/^codez#[a-z0-9]+$/)
    expect(read()[id]).toEqual({ type: "api", key: "sk-b2222", metadata: { base: "https://api-cfmax.codezsy.com/v1", name: "Gemini" } })
    await panel.remove(id)
    expect(Object.keys(read())).toEqual(["codez"])
    await expect(panel.remove("codez#gone")).rejects.toThrow("没有这把密钥")
  })

  test("speed asks every address with every key, twice", async () => {
    const { panel, seen } = world({ codez: { type: "api", key: "sk-a1111" } })
    const s = await panel.speed()
    expect(s.rows.map((r) => r.label).sort()).toEqual(["api-cfmax.codezsy.com", "api-s.codezsy.com", "api.codezsy.com", "codezsy.com"])
    expect(seen.length).toBe(8)
    expect(panel.status().speeds.rows.find((r) => r.current).base).toBe("https://api.codezsy.com/v1")
    // "current" is where the key goes now, not where it went when timed
    await panel.save("codez", { base: "https://api-s.codezsy.com/v1" })
    expect(panel.status().speeds.rows.find((r) => r.current).base).toBe("https://api-s.codezsy.com/v1")
  })

  test("test asks the model on each API at the key's address", async () => {
    const { panel, seen } = world({ codez: { type: "api", key: "sk-a1111", metadata: { base: "https://api-s.codezsy.com/v1" } } })
    const r = await panel.test("codez", "gemini-4-neon", ["chat", "gemini"])
    expect(r.results.map((x) => [x.api, x.ok])).toEqual([["chat", true], ["gemini", true]])
    expect(seen.map((x) => x.url)).toEqual(["https://api-s.codezsy.com/v1/chat/completions", "https://api-s.codezsy.com/v1beta/models/gemini-4-neon:generateContent"])
  })
})
