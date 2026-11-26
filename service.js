// The panel's local service. magpie's page for a plugin is a sandboxed
// frame that can reach nothing (connect-src 'none'), so the page
// (ui/index.html) goes on to this server's address, and this serves the
// panel itself and what it reads and does. It listens on 127.0.0.1 only;
// magpie web serves it under its own address to a browser elsewhere
// (package.json magpie.page.service).
//
// The page stays in magpie's sandbox when it goes on here: its origin is
// opaque ("null"), so /api answers it with Access-Control-Allow-Origin:
// null. Another site's sandboxed frame is "null" too, and so is kept out
// by a token of this process's, written into the panel's HTML alone (a
// frame of another origin can't read that HTML). A Host other than this
// server's own name (DNS rebinding) is refused.

import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { KEYS, SITE } from "./codez.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))

// hostOK is whether a request's Host names this server: 127.0.0.1,
// localhost or [::1], at its port.
export function hostOK(host, port) {
  return ["127.0.0.1", "localhost", "[::1]"].some((h) => host === `${h}:${port}`)
}

// originOK is whether a request's Origin may use /api: none, "null"
// (magpie's sandboxed frame) or this server's own.
export function originOK(origin, port) {
  return origin === undefined || origin === "null" || hostOK(String(origin).replace(/^http:\/\//, ""), port)
}

// the pages of CodeZ's the panel opens in the browser
export const LINKS = { site: SITE, keys: KEYS, logs: SITE + "/console/log" }

function opener() {
  if (process.platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler"]]
  if (process.platform === "darwin") return ["open", []]
  return ["xdg-open", []]
}

const CORS = {
  "Access-Control-Allow-Origin": "null",
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "Content-Type, X-CodeZ-Token",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
}

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, {
    ...extra,
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
  })
  res.end(body)
}

function json(res, code, v) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(v), CORS)
}

function body(req) {
  return new Promise((resolve) => {
    let s = ""
    req.on("data", (c) => {
      s += c
      if (s.length > 64 << 10) req.destroy()
    })
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {})
      } catch {
        resolve(null)
      }
    })
    req.on("error", () => resolve(null))
  })
}

// serve starts the panel's server on 127.0.0.1:port over panel (panel.js
// Panel), and answers it.
export function serve({ port, panel, log = (m) => console.error(`[codez] ${m}`) }) {
  const token = crypto.randomBytes(24).toString("hex")
  const page = () => fs.readFileSync(path.join(HERE, "ui", "panel.html"), "utf8").replace("__CODEZ_TOKEN__", token)
  const icon = fs.readFileSync(path.join(HERE, "ui", "icon.png"))
  // one speed test or check at a time: each asks CodeZ once per key
  let busy = ""
  const once = async (what, fn) => {
    if (busy) throw Object.assign(new Error(`正在${busy}，等它做完`), { code: 409 })
    busy = what
    try {
      return await fn()
    } finally {
      busy = ""
    }
  }
  const server = http.createServer(async (req, res) => {
    if (!hostOK(req.headers.host ?? "", port)) return send(res, 403, "text/plain", "not this server's name")
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
    try {
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        if (url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", page())
        if (url.pathname === "/icon.png") return send(res, 200, "image/png", icon)
        return send(res, 404, "text/plain", "not found")
      }
      if (!url.pathname.startsWith("/api/")) return send(res, 405, "text/plain", "GET only")
      if (!originOK(req.headers.origin, port)) return send(res, 403, "text/plain", "not the panel's origin")
      if (req.method === "OPTIONS") return send(res, 204, "text/plain", "", CORS)
      const given = Buffer.from(String(req.headers["x-codez-token"] ?? ""))
      if (given.length !== token.length || !crypto.timingSafeEqual(given, Buffer.from(token))) return json(res, 403, { error: "面板的令牌不对或过期了：刷新页面" })
      if (req.method === "GET") {
        if (url.pathname === "/api/status") return json(res, 200, { ...panel.status(), busy })
        return json(res, 404, { error: "not found" })
      }
      if (req.method !== "POST") return json(res, 405, { error: "GET or POST" })
      const b = await body(req)
      if (b === null) return json(res, 400, { error: "请求不是 JSON" })
      switch (url.pathname) {
        case "/api/check":
          await once("检查密钥", () => panel.check(typeof b.id === "string" ? b.id : undefined))
          return json(res, 200, { ...panel.status(), busy })
        case "/api/speed":
          return json(res, 200, await once("测速", () => panel.speed()))
        case "/api/test":
          return json(res, 200, await panel.test(b.id, b.model, Array.isArray(b.apis) ? b.apis : undefined))
        case "/api/save":
          return json(res, 200, await panel.save(b.id, pick(b)))
        case "/api/add":
          return json(res, 200, await panel.add(pick(b)))
        case "/api/remove":
          return json(res, 200, await panel.remove(b.id))
        case "/api/open": {
          const to = LINKS[b.what]
          if (!to) return json(res, 400, { error: "没有这个页面" })
          const [cmd, args] = opener()
          execFile(cmd, [...args, to], { windowsHide: true }, () => {})
          return json(res, 200, { opened: to })
        }
      }
      return json(res, 404, { error: "not found" })
    } catch (e) {
      const code = Number.isInteger(e?.code) ? e.code : 500
      return json(res, code, { error: String(e?.message ?? e) })
    }
  })
  server.on("error", (e) => log(`the panel's server on 127.0.0.1:${port}: ${e.message}`))
  server.listen(port, "127.0.0.1", () => log(`panel at http://127.0.0.1:${port}/`))
  server.unref?.()
  return server
}

// pick is what a save or add may change, nothing else of the body.
function pick(b) {
  const out = {}
  for (const k of ["key", "base", "customBase", "name"]) if (b[k] !== undefined) out[k] = b[k]
  return out
}
