import { afterAll, expect, test } from "bun:test"
import net from "node:net"
import { hostOK, originOK, serve } from "./service.js"

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

const calls = []
const panel = {
  status: () => ({ accounts: [{ id: "codez", key: "…1111" }], events: [] }),
  check: async (id) => calls.push(["check", id]),
  speed: async () => (calls.push(["speed"]), { rows: [] }),
  test: async (id, model) => (calls.push(["test", id, model]), { results: [] }),
  save: async (id, change) => (calls.push(["save", id, change]), { id }),
  add: async (change) => (calls.push(["add", change]), { id: "codez#n" }),
  remove: async (id) => {
    calls.push(["remove", id])
    throw Object.assign(new Error("没有这把密钥"), { code: 404 })
  },
}
const port = await freePort()
const server = serve({ port, panel, log: () => {} })
await new Promise((r) => (server.listening ? r() : server.once("listening", r)))
afterAll(() => server.close())
const base = `http://127.0.0.1:${port}`
const token = /const TOKEN = "([0-9a-f]+)"/.exec(await (await fetch(base + "/")).text())?.[1]
const post = (p, b) => fetch(base + "/api/" + p, { method: "POST", headers: { "X-CodeZ-Token": token, "Content-Type": "application/json", Origin: "null" }, body: JSON.stringify(b) })

test("hostOK and originOK: this server's names, and magpie's sandboxed frame", () => {
  expect(hostOK("127.0.0.1:3589", 3589)).toBe(true)
  expect(hostOK("evil.example:3589", 3589)).toBe(false)
  expect(originOK("null", 3589)).toBe(true)
  expect(originOK("https://evil.example", 3589)).toBe(false)
})

test("the page carries the token; /api wants it", async () => {
  expect(token).toMatch(/^[0-9a-f]{48}$/)
  expect((await fetch(base + "/api/status")).status).toBe(403)
  const r = await fetch(base + "/api/status", { headers: { "X-CodeZ-Token": token, Origin: "null" } })
  expect(r.status).toBe(200)
  expect(r.headers.get("access-control-allow-origin")).toBe("null")
  expect((await r.json()).accounts[0].key).toBe("…1111")
  expect((await fetch(base + "/icon.png")).headers.get("content-type")).toBe("image/png")
  expect((await fetch(base + "/api/status", { headers: { "X-CodeZ-Token": token, Origin: "https://evil.example" } })).status).toBe(403)
  expect((await fetch(base + "/", { headers: { Host: "evil.example:" + port } })).status).toBe(403)
})

test("a save or add passes on only what it may change", async () => {
  expect((await post("save", { id: "codez", name: "x", key: "k", base: "b", customBase: "c", type: "oauth", metadata: {} })).status).toBe(200)
  expect(calls.at(-1)).toEqual(["save", "codez", { key: "k", base: "b", customBase: "c", name: "x" }])
  expect((await post("add", { key: "k" })).status).toBe(200)
  const gone = await post("remove", { id: "codez#gone" })
  expect(gone.status).toBe(404)
  expect((await gone.json()).error).toBe("没有这把密钥")
  expect((await post("open", { what: "file:///c:/windows" })).status).toBe(400)
})
