// magpie's plugin host calls every function this file exports as a
// plugin, so it exports only the plugin's: the first CodeZ provider, and
// one function for each copy's slot, which gives a provider only when the
// options have that copy (copiesOf).

import { copiesOf, createPlugin } from "./codez.js"

export const CodeZ = async () => createPlugin()

const copy = (slot) => async (_input, options) => {
  const c = copiesOf(options).find((x) => x.id === slot)
  return c ? createPlugin({ id: c.id, name: c.name }) : {}
}

export const CodeZ2 = copy("codez2")
export const CodeZ3 = copy("codez3")
export const CodeZ4 = copy("codez4")
export const CodeZ5 = copy("codez5")
export const CodeZ6 = copy("codez6")
export const CodeZ7 = copy("codez7")
export const CodeZ8 = copy("codez8")
export const CodeZ9 = copy("codez9")
