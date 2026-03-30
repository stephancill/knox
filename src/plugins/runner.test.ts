import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnoxError } from "../types.ts";
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
      options: { timeoutMs: 1000 },
    });

    const result = await runner.runBeforeSign({
      event: {
        attempt: 1,
        challengeRaw: {},
        account: { address: "0x0000000000000000000000000000000000000001" },
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
      options: { timeoutMs: 1000 },
    });

    await expect(
      runner.runBeforeTransaction({
        event: {
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
      options: { timeoutMs: 1000 },
    });

    const outputs = await runner.runAccountStatus({
      event: {
        account: {
          address: "0x0000000000000000000000000000000000000001",
          source: "created",
        },
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
          async setup() {
            return { output: "ready" };
          },
        },
      ],
      options: { timeoutMs: 1000 },
    });

    const result = await runner.runSetup({ pluginName: "setup-ok" });
    expect(result).toEqual({
      pluginName: "setup-ok",
      output: "ready",
    });
  });

  test("fails plugin setup when setup is missing", async () => {
    await setupIsolatedHome();

    const runner = new PluginRunner({
      plugins: [{ name: "no-setup" }],
      options: { timeoutMs: 1000 },
    });

    await expect(runner.runSetup({ pluginName: "no-setup" })).rejects.toThrow(
      "Plugin does not implement setup(): no-setup",
    );
  });
});
