// The panel in a CodeZ provider's editor: "Add another CodeZ" makes one
// more CodeZ provider (a copy, in a slot codez2…codez9) by the plugin's
// options, which has magpie load the plugin again with it; a copy's
// editor can rename it or take it away. codez.js copiesOf reads them.
const SLOTS = ["codez2", "codez3", "codez4", "codez5", "codez6", "codez7", "codez8", "codez9"]

const WORDS = {
  en: {
    about: "Each CodeZ provider has its own keys, models and settings: put a key of another group, or the same key on another address, in a CodeZ of its own.",
    add: "Add another CodeZ",
    full: "All 8 more CodeZ are in use.",
    copies: "More CodeZ: {names}",
    saveName: "Rename",
    remove: "Remove this CodeZ",
    added: "Added {name} ({id}). In a few seconds, once magpie has loaded the plugin again, it is under Add provider › From plugins: pick it there and sign in with its key.",
    renamed: "Renamed. magpie loads the plugin again to show it.",
    removed: "Removed {name}. Its keys stay saved; adding a CodeZ again in its place brings them back.",
  },
  zh: {
    about: "每个 CodeZ 供应商有自己的密钥、模型和设置：不同分组的密钥，或者同一把密钥走另一个地址，可以各放一个 CodeZ。",
    add: "再添加一个 CodeZ",
    full: "8 个额外的 CodeZ 都已用上。",
    copies: "其他 CodeZ：{names}",
    saveName: "改名",
    remove: "移除这个 CodeZ",
    added: "已添加 {name}（{id}）。几秒后 magpie 重新加载插件，它会出现在「添加供应商 › 来自插件」里：在那里点它，登录它的密钥。",
    renamed: "已改名，magpie 重新加载插件后显示新名字。",
    removed: "已移除 {name}。它的密钥还留着，以后在同一个位置再添加 CodeZ 时会回来。",
  },
}

;(async () => {
  await magpie.ready
  const lang = String(magpie.theme?.lang || navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en"
  const say = (k, v = {}) => WORDS[lang][k].replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "")
  const $ = (id) => document.getElementById(id)
  const here = magpie.context?.provider?.id || ""
  let opts = (await magpie.options.get()) || {}
  const copies = () => (Array.isArray(opts.copies) ? opts.copies : []).filter((c) => SLOTS.includes(c?.id))
  const nameOf = (c) => (c.name || "").trim() || `CodeZ ${c.id.slice(5)}`

  const draw = () => {
    $("about").textContent = say("about")
    const cs = copies()
    const free = SLOTS.find((s) => !cs.some((c) => c.id === s))
    $("add").textContent = say("add")
    $("add").disabled = !free
    $("list").textContent = !free ? say("full") : cs.length ? say("copies", { names: cs.map(nameOf).join("、") }) : ""
    const mine = cs.find((c) => c.id === here)
    $("rename").hidden = !mine
    if (mine) {
      $("name").value = nameOf(mine)
      $("saveName").textContent = say("saveName")
      $("remove").textContent = say("remove")
    }
  }

  const save = async (next, msg) => {
    for (const b of document.querySelectorAll("button")) b.disabled = true
    try {
      opts = (await magpie.options.set({ ...opts, copies: next })) || { ...opts, copies: next }
      $("msg").textContent = msg
    } catch (e) {
      $("msg").textContent = String(e?.message || e)
    }
    for (const b of document.querySelectorAll("button")) b.disabled = false
    draw()
  }

  $("add").onclick = () => {
    const cs = copies()
    const id = SLOTS.find((s) => !cs.some((c) => c.id === s))
    if (!id) return
    const name = `CodeZ ${id.slice(5)}`
    save([...cs, { id, name }], say("added", { name, id }))
  }
  $("saveName").onclick = () => {
    const name = $("name").value.trim().slice(0, 40)
    if (!name) return
    save(copies().map((c) => (c.id === here ? { ...c, name } : c)), say("renamed"))
  }
  $("remove").onclick = () => {
    const c = copies().find((x) => x.id === here)
    if (c) save(copies().filter((x) => x.id !== here), say("removed", { name: nameOf(c) }))
  }
  draw()
})()
