import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPlugins } from "./loader.ts";

let tempRoot: string | null = null;
let originalHome: string | undefined;

afterEach(async () => {
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
    originalHome = undefined;
  }
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function setupTempEnv(): Promise<{ cwd: string; home: string }> {
  tempRoot = await mkdtemp(join(tmpdir(), "knox-loader-test-"));
  const cwd = join(tempRoot, "project");
  const home = join(tempRoot, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(home, { recursive: true });

  originalHome = process.env.HOME;
  process.env.HOME = home;

  return { cwd, home };
}

describe("loadPlugins", () => {
  test("loads valid plugins from cwd plugin directory", async () => {
    const { cwd, home } = await setupTempEnv();

    const cwdPluginsDir = join(cwd, ".knox", "plugins");
    const homePluginsDir = join(home, ".knox", "plugins");
    await mkdir(cwdPluginsDir, { recursive: true });
    await mkdir(homePluginsDir, { recursive: true });

    await writeFile(
      join(cwdPluginsDir, "alpha.js"),
      'export default { name: "alpha", async beforeTransaction(){ return { action: "continue" }; } };',
      "utf8",
    );
    await writeFile(join(homePluginsDir, "beta.txt"), "ignored", "utf8");

    const plugins = await loadPlugins({ cwd });
    expect(plugins.map((plugin) => plugin.name)).toEqual(["alpha"]);
  });

  test("ignores files without plugin name or unsupported extensions", async () => {
    const { cwd } = await setupTempEnv();
    const pluginsDir = join(cwd, ".knox", "plugins");
    await mkdir(pluginsDir, { recursive: true });

    await writeFile(join(pluginsDir, "bad.js"), "export default { }", "utf8");
    await writeFile(join(pluginsDir, "notes.txt"), "ignore me", "utf8");

    const plugins = await loadPlugins({ cwd });
    expect(plugins).toHaveLength(0);
  });
});
