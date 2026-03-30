import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AccountPlugin } from "./types.ts";

const PLUGIN_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

function pluginDirs({ cwd }: { cwd: string }): string[] {
  return [join(homedir(), ".knox", "plugins"), join(resolve(cwd), ".knox", "plugins")];
}

export async function loadPlugins({ cwd }: { cwd: string }): Promise<AccountPlugin[]> {
  const loaded: AccountPlugin[] = [];
  const seen = new Set<string>();

  for (const dir of pluginDirs({ cwd })) {
    if (!existsSync(dir)) {
      continue;
    }

    for (const file of readdirSync(dir).sort()) {
      const ext = file.slice(file.lastIndexOf("."));
      if (!PLUGIN_EXTENSIONS.has(ext)) {
        continue;
      }
      const full = join(dir, file);
      if (seen.has(full)) {
        continue;
      }
      seen.add(full);

      const mod = await import(pathToFileURL(full).href);
      const plugin = (mod.default ?? mod.plugin ?? mod) as AccountPlugin;
      if (!plugin || typeof plugin.name !== "string") {
        continue;
      }
      loaded.push(plugin);
    }
  }

  return loaded;
}
