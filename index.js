// magpie's plugin host calls every function this file exports as a
// plugin, so it exports only the plugin's.

import { createPlugin } from "./codez.js"
import { Panel } from "./panel.js"
import { serve } from "./service.js"

const PORT = 3589

let server

export const CodeZ = async (input, options = {}) => {
  if (!server && input?.client) {
    // the panel's server: the host magpie runs serves it (a magpie
    // command's host is given a free port of its own by magpie)
    const log = (m) => console.error(`[codez] ${m}`)
    const panel = new Panel({ configDir: process.cwd(), client: input.client, log })
    server = serve({ port: Number(options?.port) || PORT, panel, log })
  }
  return createPlugin()
}
