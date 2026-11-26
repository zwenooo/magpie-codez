import { describe, expect, test } from "bun:test"
import { apisOf, BASE, BASES, baseOf, createPlugin, familyOf, geminiURL, normalBase, summary, openAIModel, readsImages, rowsOf } from "./codez.js"
import * as entry from "./index.js"

// Entries as CodeZ's /v1/models answered on 2026-11-25, one per key group.
const LIST = {
  object: "list",
  data: [
    { id: "claude-opus-5-5", object: "model", owned_by: "custom", created: 1, supported_endpoint_types: ["anthropic", "openai"] },
    { id: "gpt-6.2-sol", object: "model", owned_by: "custom", created: 1, supported_endpoint_types: ["openai", "openai-alpha-search"] },
    { id: "codex-auto-review", object: "model", owned_by: "custom", created: 1, supported_endpoint_types: ["openai", "openai-alpha-search"] },
    { id: "deepseek-v4-pro", object: "model", owned_by: "custom", created: 1, supported_endpoint_types: ["openai", "openai-alpha-search"] },
    { id: "gemini-4-neon", object: "model", owned_by: "custom", created: 1, supported_endpoint_types: ["openai", "openai-response", "anthropic", "gemini", "openai-alpha-search"] },
  ],
}

describe("which API each model is asked on", () => {
  test("GPT, Codex and o-series on Responses, Claude on Messages, the rest on chat", () => {
    expect(apisOf("gpt-6.2-sol", ["openai"])).toEqual({ npm: "@ai-sdk/openai", also: ["@ai-sdk/openai-compatible"] })
    expect(apisOf("codex-auto-review", ["openai"]).npm).toBe("@ai-sdk/openai")
    expect(apisOf("o4-mini", []).npm).toBe("@ai-sdk/openai")
    expect(apisOf("claude-opus-5-5", ["anthropic", "openai"])).toEqual({ npm: "@ai-sdk/anthropic", also: ["@ai-sdk/openai-compatible"] })
    expect(apisOf("deepseek-v4-pro", ["openai", "openai-alpha-search"])).toEqual({ npm: "@ai-sdk/openai-compatible", also: [] })
    // a Gemini model on Gemini's own API where CodeZ serves it, else on chat
    expect(apisOf("gemini-4-neon", ["openai", "openai-response", "anthropic", "gemini"])).toEqual({
      npm: "@ai-sdk/google",
      also: ["@ai-sdk/openai-compatible", "@ai-sdk/openai", "@ai-sdk/anthropic"],
    })
    expect(apisOf("gemini-4-neon", ["openai"])).toEqual({ npm: "@ai-sdk/openai-compatible", also: [] })
    // not OpenAI's: an o that isn't followed by a digit
    expect(openAIModel("omni-1")).toBe(false)
    expect(readsImages("glm-5.2")).toBe(false)
    expect(readsImages("gemini-4-neon")).toBe(true)
  })

  test("rows carry the API, the base and the others, as magpie's host reads them", () => {
    const rows = rowsOf(LIST)
    expect(Object.keys(rows)).toEqual(LIST.data.map((m) => m.id))
    expect(rows["gpt-6.2-sol"].api).toEqual({ id: "gpt-6.2-sol", url: BASE, npm: "@ai-sdk/openai" })
    expect(rows["gpt-6.2-sol"].also).toEqual(["@ai-sdk/openai-compatible"])
    expect(rows["deepseek-v4-pro"].also).toBeUndefined()
    expect(rows["deepseek-v4-pro"].capabilities.input).toEqual({ text: true, image: false })
    expect(rows["claude-opus-5-5"].capabilities.input).toEqual({ text: true, image: true })
    expect(rowsOf({ data: [{ id: "" }] })).toBe(null)
    expect(rowsOf({ error: "x" })).toBe(null)
  })
})

function fakeFetch(answer) {
  const seen = []
  const f = async (url, init) => {
    const h = init?.headers
    seen.push({ url, auth: h instanceof Headers ? (h.get("authorization") ?? undefined) : h?.authorization })
    return typeof answer === "function" ? answer() : answer
  }
  return { f, seen }
}

const json = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("the plugin's hooks", () => {
  test("the entry exports only the plugin function", () => {
    expect(Object.keys(entry)).toEqual(["CodeZ"])
  })

  test("config declares the provider and keeps the user's own", async () => {
    const p = createPlugin()
    const cfg = {}
    await p.config(cfg)
    expect(cfg.provider.codez).toEqual({ name: "CodeZ", npm: "@ai-sdk/openai-compatible", api: BASE, models: {} })
    const own = { provider: { codez: { name: "mine" } } }
    await p.config(own)
    expect(own.provider.codez).toEqual({ name: "mine" })
  })

  test("each key lists its own models", async () => {
    const { f, seen } = fakeFetch(() => json(200, LIST))
    const p = createPlugin({ fetchImpl: f })
    const got = await p.provider.models({ models: { old: {} } }, { auth: { type: "api", key: "sk-one" } })
    expect(Object.keys(got)).toHaveLength(5)
    expect(seen).toEqual([{ url: `${BASE}/models`, auth: "Bearer sk-one" }])
  })

  test("a refused key marks the account; a failure keeps the list it had", async () => {
    const was = { models: { old: {} } }
    const auth = { auth: { type: "api", key: "sk-x" } }
    await expect(createPlugin({ fetchImpl: fakeFetch(() => json(401, { error: "bad" })).f }).provider.models(was, auth)).rejects.toMatchObject({ signIn: "expired" })
    expect(await createPlugin({ fetchImpl: fakeFetch(() => json(502, "bad gateway")).f }).provider.models(was, auth)).toBe(was.models)
    expect(
      await createPlugin({
        fetchImpl: async () => {
          throw new Error("down")
        },
      }).provider.models(was, auth),
    ).toBe(was.models)
    await expect(createPlugin({ fetchImpl: fakeFetch(() => json(200, { nope: 1 })).f }).provider.models(was, auth)).rejects.toThrow("no model list")
    // not signed in: nothing asked
    const none = fakeFetch(() => json(200, LIST))
    expect(await createPlugin({ fetchImpl: none.f }).provider.models(was, {})).toBe(was.models)
    expect(none.seen).toEqual([])
  })

  test("the loader hands magpie the base and the key; usage checks the key", async () => {
    const p = createPlugin({ fetchImpl: fakeFetch(() => json(403, {})).f })
    expect(await p.auth.loader(async () => ({ type: "api", key: "sk-k" }))).toMatchObject({ baseURL: BASE, apiKey: "sk-k" })
    expect(await p.auth.loader(async () => undefined)).toEqual({})
    expect(await p.auth.usage(async () => ({ type: "api", key: "sk-k" }))).toMatchObject({ signIn: "expired" })
    const ok = createPlugin({ fetchImpl: fakeFetch(() => json(200, LIST)).f })
    expect((await ok.auth.usage(async () => ({ type: "api", key: "sk-k" }))).plan).toContain("codezsy.com")
  })
})

describe("where a key's requests go", () => {
  test("a typed address is taken as requests take it", () => {
    expect(normalBase(" https://api.codezsy.com/v1/ ")).toBe("https://api.codezsy.com/v1")
    expect(normalBase("https://relay.example.com")).toBe("https://relay.example.com/v1")
    expect(normalBase("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/v1")
    expect(normalBase("https://x.example.com/openai/v1")).toBe("https://x.example.com/openai/v1")
    for (const bad of ["", "api.codezsy.com", "ftp://x.com", "https://x.com/v1?a=1", "https://u:p@x.com/v1", null]) expect(normalBase(bad)).toBe(null)
  })

  test("each account goes where it chose, an older one to the default", () => {
    expect(baseOf({ type: "api", key: "k" })).toBe(BASE)
    expect(baseOf({ type: "api", key: "k", metadata: { base: BASES[2].value } })).toBe("https://api-s.codezsy.com/v1")
    expect(baseOf({ type: "api", key: "k", metadata: { base: "custom", customBase: "https://my.relay.dev/" } })).toBe("https://my.relay.dev/v1")
    expect(baseOf({ type: "api", key: "k", metadata: { base: "custom", customBase: "nonsense" } })).toBe(BASE)
  })

  test("sign-in asks the address, the other one only when chosen", () => {
    const [m] = createPlugin().auth.methods
    const [pick, typed] = m.prompts
    expect(m.authorize).toBeUndefined() // magpie asks the key and keeps the answers
    expect(pick.options.map((o) => o.value)).toEqual([...BASES.map((b) => b.value), "custom"])
    expect(BASES.map((b) => b.label)).toEqual(["api-cfmax.codezsy.com", "codezsy.com", "api-s.codezsy.com"])
    for (const o of pick.options) expect(o.hint && o.hints.zh).toBeTruthy()
    expect(typed.when).toEqual({ key: "base", op: "eq", value: "custom" })
    expect(typed.validate("https://ok.dev/v1")).toBeUndefined()
    expect(typed.validate("nope")).toContain("http")
  })

  test("the loader, the list and the check all use the account's address", async () => {
    const auth = { type: "api", key: "sk-s", metadata: { base: "https://api-s.codezsy.com/v1" } }
    const { f, seen } = fakeFetch(() => json(200, LIST))
    const p = createPlugin({ fetchImpl: f })
    expect(await p.auth.loader(async () => auth)).toMatchObject({ baseURL: "https://api-s.codezsy.com/v1", apiKey: "sk-s" })
    const rows = await p.provider.models({ models: {} }, { auth })
    expect(rows["gpt-6.2-sol"].api.url).toBe("https://api-s.codezsy.com/v1")
    await p.auth.usage(async () => auth)
    expect(seen.map((x) => x.url)).toEqual(["https://api-s.codezsy.com/v1/models", "https://api-s.codezsy.com/v1/models"])
  })
})

describe("Gemini's own API", () => {
  test("a Gemini request magpie sends under the base goes to /v1beta", () => {
    const b = "https://api-s.codezsy.com/v1"
    expect(geminiURL(b + "/models/gemini-4-neon:streamGenerateContent?alt=sse", b)).toBe("https://api-s.codezsy.com/v1beta/models/gemini-4-neon:streamGenerateContent?alt=sse")
    expect(geminiURL(b + "/models/gemini-4-neon:generateContent", b)).toBe("https://api-s.codezsy.com/v1beta/models/gemini-4-neon:generateContent")
    expect(geminiURL(b + "/models/gemini-4-neon:countTokens", b)).toBe("https://api-s.codezsy.com/v1beta/models/gemini-4-neon:countTokens")
    // an address with a path of its own keeps it
    expect(geminiURL("https://x.dev/relay/v1/models/m:generateContent", "https://x.dev/relay/v1")).toBe("https://x.dev/relay/v1beta/models/m:generateContent")
    // anything else is as it was
    for (const u of [b + "/chat/completions", b + "/messages", b + "/responses", b + "/models", "https://other.dev/v1/models/m:generateContent"]) expect(geminiURL(u, b)).toBe(u)
  })

  test("the loader's fetch sends it there, the others where magpie said", async () => {
    const auth = { type: "api", key: "sk-g", metadata: { base: "https://api-s.codezsy.com/v1" } }
    const { f, seen } = fakeFetch(() => json(200, {}))
    const o = await createPlugin({ fetchImpl: f }).auth.loader(async () => auth)
    await o.fetch("https://api-s.codezsy.com/v1/models/gemini-4-neon:streamGenerateContent?alt=sse", { method: "POST", headers: new Headers({ "x-goog-api-key": "sk-g" }) })
    // a Gemini model's request on Responses: magpie put the key in
    // x-goog-api-key, which CodeZ's Responses API doesn't read
    await o.fetch("https://api-s.codezsy.com/v1/responses", { method: "POST", headers: new Headers({ "x-goog-api-key": "sk-g" }) })
    expect(seen).toEqual([
      { url: "https://api-s.codezsy.com/v1beta/models/gemini-4-neon:streamGenerateContent?alt=sse", auth: "Bearer sk-g" },
      { url: "https://api-s.codezsy.com/v1/responses", auth: "Bearer sk-g" },
    ])
  })

  test("a model CodeZ serves on Gemini's API is said to be", async () => {
    const rows = rowsOf(LIST)
    expect(rows["gemini-4-neon"].api.npm).toBe("@ai-sdk/google")
    expect(rows["claude-opus-5-5"].also ?? []).not.toContain("@ai-sdk/google")
  })
})

describe("an account's row", () => {
  test("says where its key goes and the families it lists, most first", () => {
    expect(familyOf("gpt-6.2-sol")).toBe("GPT")
    expect(familyOf("codex-auto-review")).toBe("GPT")
    expect(familyOf("claude-opus-5-5")).toBe("Claude")
    expect(familyOf("deepseek-v4-pro")).toBe("DeepSeek")
    expect(familyOf("minimax-m3")).toBe("MiniMax")
    expect(familyOf("doubao-seed-2")).toBe("Doubao")
    expect(familyOf("qwen3.7-plus")).toBe("Qwen")
    expect(familyOf("k2")).toBe("K")
    expect(summary(BASE, LIST.data.map((m) => m.id))).toBe("api.codezsy.com · GPT 2 · Claude 1 · DeepSeek 1 · Gemini 1")
    expect(summary("https://api-s.codezsy.com/v1", ["a-1", "b-1", "c-1", "d-1", "e-1", "e-2"])).toBe("api-s.codezsy.com · E 2 · A 1 · B 1 · C 1 · +1")
    expect(summary(BASE, [])).toBe("api.codezsy.com · no models")
  })

  test("usage reads the key's list into its row", async () => {
    const auth = { type: "api", key: "sk-s", metadata: { base: "https://api-cfmax.codezsy.com/v1" } }
    const p = createPlugin({ fetchImpl: fakeFetch(() => json(200, LIST)).f })
    expect((await p.auth.usage(async () => auth)).plan).toBe("api-cfmax.codezsy.com · GPT 2 · Claude 1 · DeepSeek 1 · Gemini 1")
  })
})
