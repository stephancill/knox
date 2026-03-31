import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KnoxError } from "../types.ts";
import { PluginRunner } from "./runner.ts";
import type { AccountPlugin } from "./types.ts";

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

async function setupIsolatedHome(): Promise<void> {
  tempRoot = await mkdtemp(join(tmpdir(), "knox-runner-test-"));
  const home = join(tempRoot, "home");
  await mkdir(home, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = home;
}

describe("PluginRunner", () => {
  test("applies beforeSign intent overrides in plugin order", async () => {
    await setupIsolatedHome();

    const plugins: AccountPlugin[] = [
      {
        name: "a",
        async beforeSign() {
          return { action: "continue", intentOverride: { amount: 5n } };
        },
      },
      {
        name: "b",
        async beforeSign() {
          return { action: "continue", intentOverride: { amount: 9n } };
        },
      },
    ];

    const runner = new PluginRunner({
      plugins,
      options: {},
    });

    const result = await runner.runBeforeSign({
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
        attempt: 1,
        challengeRaw: {},
        intent: {
          protocol: "x402",
          mode: "exact",
          network: "eip155:8453",
          chainId: 8453,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: 1n,
          payTo: "0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89",
          requestUrl: "https://example.com",
          requestMethod: "GET",
        },
      },
    });

    expect(result.amount).toBe(9n);
  });

  test("throws PLUGIN_ABORT when beforeTransaction returns abort", async () => {
    await setupIsolatedHome();

    const runner = new PluginRunner({
      plugins: [
        {
          name: "guard",
          async beforeTransaction() {
            return { action: "abort", reason: "blocked" };
          },
        },
      ],
      options: {},
    });

    await expect(
      runner.runBeforeTransaction({
        event: {
          userAddress: "0x0000000000000000000000000000000000000001",
          attempt: 1,
          intent: {
            protocol: "mpp",
            mode: "charge",
            network: "eip155:8453",
            chainId: 8453,
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount: 1n,
            payTo: "0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89",
            requestUrl: "https://example.com",
            requestMethod: "GET",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "PLUGIN_ABORT",
    } satisfies Partial<KnoxError>);
  });

  test("collects accountStatus output and surfaces plugin failures", async () => {
    await setupIsolatedHome();

    const runner = new PluginRunner({
      plugins: [
        {
          name: "status-ok",
          async accountStatus() {
            return { output: "env=ok" };
          },
        },
        {
          name: "status-bad",
          async accountStatus() {
            return { output: 12 as unknown as string };
          },
        },
        {
          name: "status-fail",
          async accountStatus() {
            throw new Error("boom");
          },
        },
      ],
      options: {},
    });

    const outputs = await runner.runAccountStatus({
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
        accountSource: "created",
      },
    });

    expect(outputs).toEqual([
      {
        pluginName: "status-ok",
        output: "env=ok",
      },
      {
        pluginName: "status-bad",
        output: "[error] accountStatus output must be a string",
      },
      {
        pluginName: "status-fail",
        output: "[error] boom",
      },
    ]);
  });

  test("runs plugin setup and returns output", async () => {
    await setupIsolatedHome();

    const runner = new PluginRunner({
      plugins: [
        {
          name: "setup-ok",
          async setup({ userAddress }) {
            expect(userAddress).toBe("0x0000000000000000000000000000000000000001");
            return { output: "ready" };
          },
        },
      ],
      options: {},
    });

    const result = await runner.runSetup({
      pluginName: "setup-ok",
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
      },
    });
    expect(result).toEqual({
      pluginName: "setup-ok",
      output: "ready",
    });
  });

  test("fails plugin setup when setup is missing", async () => {
    await setupIsolatedHome();

    const runner = new PluginRunner({
      plugins: [{ name: "no-setup" }],
      options: {},
    });

    await expect(
      runner.runSetup({
        pluginName: "no-setup",
        event: {
          userAddress: null,
        },
      }),
    ).rejects.toThrow("Plugin does not implement setup(): no-setup");
  });

  test("persists plugin kv between setup and other hooks", async () => {
    await setupIsolatedHome();

    const plugins: AccountPlugin[] = [
      {
        name: "stateful",
        async setup({ kv }) {
          await kv.set({
            key: "config",
            value: {
              nested: {
                enabled: true,
              },
              list: [1, "two", null],
            },
          });
          return { output: "saved" };
        },
        async accountStatus({ kv }) {
          const config = await kv.get({ key: "config" });
          return { output: JSON.stringify(config) };
        },
      },
    ];

    const setupRunner = new PluginRunner({ plugins, options: {} });
    await setupRunner.runSetup({
      pluginName: "stateful",
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
      },
    });

    const statusRunner = new PluginRunner({ plugins, options: {} });
    const outputs = await statusRunner.runAccountStatus({
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
        accountSource: "created",
      },
    });

    expect(outputs).toEqual([
      {
        pluginName: "stateful",
        output: '{"nested":{"enabled":true},"list":[1,"two",null]}',
      },
    ]);
  });

  test("isolates kv keys by plugin name", async () => {
    await setupIsolatedHome();

    const plugins: AccountPlugin[] = [
      {
        name: "alpha",
        async setup({ kv }) {
          await kv.set({ key: "token", value: "alpha-value" });
          return { output: "ok" };
        },
        async accountStatus({ kv }) {
          const token = await kv.get({ key: "token" });
          return { output: String(token) };
        },
      },
      {
        name: "beta",
        async setup({ kv }) {
          await kv.set({ key: "token", value: "beta-value" });
          return { output: "ok" };
        },
        async accountStatus({ kv }) {
          const token = await kv.get({ key: "token" });
          return { output: String(token) };
        },
      },
    ];

    const runner = new PluginRunner({ plugins, options: {} });
    await runner.runSetup({
      pluginName: "alpha",
      event: { userAddress: null },
    });
    await runner.runSetup({
      pluginName: "beta",
      event: { userAddress: null },
    });

    const outputs = await runner.runAccountStatus({
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
        accountSource: "imported",
      },
    });

    expect(outputs).toEqual([
      { pluginName: "alpha", output: "alpha-value" },
      { pluginName: "beta", output: "beta-value" },
    ]);
  });

  test("returns undefined for missing kv key", async () => {
    await setupIsolatedHome();

    const runner = new PluginRunner({
      plugins: [
        {
          name: "missing-key",
          async accountStatus({ kv }) {
            const value = await kv.get({ key: "does-not-exist" });
            return { output: value === undefined ? "undefined" : "unexpected" };
          },
        },
      ],
      options: {},
    });

    const outputs = await runner.runAccountStatus({
      event: {
        userAddress: "0x0000000000000000000000000000000000000001",
        accountSource: "created",
      },
    });

    expect(outputs).toEqual([{ pluginName: "missing-key", output: "undefined" }]);
  });
});
