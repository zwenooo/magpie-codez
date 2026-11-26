// The panel in each CodeZ provider's editor: "Add another CodeZ" makes one
// more CodeZ provider (a copy, in a slot codez2…codez9) by the plugin's
// options, and every copy is listed here to rename or remove, so the
// first CodeZ's editor, which always has this panel, manages them all.
// codez.js copiesOf reads the options.
//
// Setting options has magpie load the plugin again, which takes a few
// seconds, and magpie's window doesn't read its providers again by itself
// while an editor is open: so the panel waits, then says to close the
// editor and press the window's refresh. A copy's own editor shows this
// panel only once the window has read the plugins' panels again.
const SLOTS = ["codez2", "codez3", "codez4", "codez5", "codez6", "codez7", "codez8", "codez9"]
const RELOAD_MS = 8000

const WORDS = {
  en: {
    about: "Each CodeZ provider has its own keys, models and settings: put keys of different groups, or one key on another address, in a CodeZ of their own.",
    add: "Add another CodeZ",
    full: "All 8 more CodeZ are in use.",
    rename: "Rename",
    remove: "Remove",
    working: "Saving, and magpie is loading the plugin again…",
    added: "Added {name}. Close this window, press refresh (↻, top right), then pick {name} under Add provider › From plugins and sign in with its key. If it then says no models, press refresh once more.",
    renamed: "Renamed. Close this window and press refresh (↻, top right) to see it.",
    removed: "Removed {name}. Close this window and press refresh (↻, top right). Its keys stay saved: a CodeZ added again in its place has them back.",
    named: "A name, please.",
  },
  zh: {
    about: "每个 CodeZ 供应商有自己的密钥、模型和设置：不同分组的密钥，或者同一把密钥走另一个地址，可以各放一个 CodeZ。",
    add: "再添加一个 CodeZ",
    full: "8 个额外的 CodeZ 都已用上。",
    rename: "改名",
    remove: "移除",
    working: "正在保存，magpie 正在重新加载插件…",
    added: "已添加 {name}。关闭这个窗口，点右上角的刷新（↻），然后在「添加供应商 › 来自插件」里点 {name}，登录它的密钥。登录后如果显示「未暴露模型」，再点一次刷新。",
    renamed: "已改名。关闭这个窗口，点右上角的刷新（↻）后显示新名字。",
    removed: "已移除 {name}。关闭这个窗口，点右上角的刷新（↻）。它的密钥还留着：以后在同一个位置再添加 CodeZ，密钥会回来。",
    named: "请填一个名字。",
  },
}

;(async () => {
  await magpie.ready
  const lang = String(magpie.theme?.lang || navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en"
  const say = (k, v = {}) => WORDS[lang][k].replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "")
  const $ = (id) => document.getElementById(id)
  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props)
  let opts = (await magpie.options.get()) || {}
  let busy = false
  const copies = () => (Array.isArray(opts.copies) ? opts.copies : []).filter((c) => SLOTS.includes(c?.id))
  const nameOf = (c) => (c.name || "").trim() || `CodeZ ${c.id.slice(5)}`

  const draw = () => {
    $("about").textContent = say("about")
    const cs = copies()
    const box = $("copies")
    box.replaceChildren()
    for (const c of cs) {
      const row = el("div", { className: "copy" })
      const input = el("input", { value: nameOf(c), maxLength: 40 })
      input.setAttribute("aria-label", c.id)
      const rename = el("button", { textContent: say("rename"), disabled: busy })
      const remove = el("button", { textContent: say("remove"), disabled: busy })
      rename.onclick = () => {
        const name = input.value.trim().slice(0, 40)
        if (!name) return void ($("msg").textContent = say("named"))
        save(cs.map((x) => (x.id === c.id ? { ...x, name } : x)), say("renamed"))
      }
      input.onkeydown = (e) => { if (e.key === "Enter") rename.onclick() }
      remove.onclick = () => save(cs.filter((x) => x.id !== c.id), say("removed", { name: nameOf(c) }))
      row.append(el("code", { textContent: c.id }), input, rename, remove)
      box.append(row)
    }
    const free = SLOTS.find((s) => !cs.some((c) => c.id === s))
    $("add").textContent = say("add")
    $("add").disabled = busy || !free
    $("full").textContent = free ? "" : say("full")
  }

  const save = async (next, done) => {
    if (busy) return
    busy = true
    $("msg").textContent = say("working")
    draw()
    try {
      opts = (await magpie.options.set({ ...opts, copies: next })) || { ...opts, copies: next }
      // the plugin is loaded again with them meanwhile
      await new Promise((r) => setTimeout(r, RELOAD_MS))
      $("msg").textContent = done
    } catch (e) {
      $("msg").textContent = String(e?.message || e)
    }
    busy = false
    draw()
  }

  $("add").onclick = () => {
    const cs = copies()
    const id = SLOTS.find((s) => !cs.some((c) => c.id === s))
    if (!id) return
    const name = `CodeZ ${id.slice(5)}`
    save([...cs, { id, name }], say("added", { name }))
  }
  draw()
})()
