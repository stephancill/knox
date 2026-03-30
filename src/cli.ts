#!/usr/bin/env bun

import { Command } from "commander";

import { createAccount, getActiveAccount, importAccount } from "./account/repository.ts";
import { parseRequestArgs } from "./http/request.ts";
import { requestWithPayment } from "./payments/orchestrator.ts";
import { loadPlugins } from "./plugins/loader.ts";
import { PluginRunner } from "./plugins/runner.ts";
import { getDb } from "./store/db.ts";
import { KnoxError } from "./types.ts";

type GlobalFlags = {
  disablePlugins: boolean;
  pluginsTimeoutMs: number;
  protocol: "auto" | "x402" | "mpp";
  dryRun: boolean;
};

type RootOptions = {
  dryRun?: boolean;
  plugins?: boolean;
  pluginsTimeoutMs?: number;
  protocol?: "auto" | "x402" | "mpp";
};

function getGlobalFlags({ program }: { program: Command }): GlobalFlags {
  const options = program.opts<RootOptions>();
  return {
    disablePlugins: options.plugins === false,
    pluginsTimeoutMs: options.pluginsTimeoutMs ?? 10_000,
    protocol: options.protocol ?? "auto",
    dryRun: options.dryRun ?? false,
  };
}

async function printResponse({ response, includeHeaders }: { response: Response; includeHeaders: boolean }): Promise<void> {
  const body = await response.text();
    if (includeHeaders) {
      console.log(`HTTP ${response.status}`);
      for (const [key, value] of response.headers.entries()) {
        console.log(`${key}: ${value}`);
      }
      console.log("");
    }
    console.log(body);
}

async function handlePluginsList({ cwd }: { cwd: string }): Promise<void> {
  const plugins = await loadPlugins({ cwd });
  if (!plugins.length) {
    console.log("No plugins found.");
    return;
  }
  for (const plugin of plugins) {
    console.log(plugin.name);
  }
}

async function handlePluginSetup({
  cwd,
  pluginName,
  timeoutMs,
}: {
  cwd: string;
  pluginName: string;
  timeoutMs: number;
}): Promise<void> {
  const plugins = await loadPlugins({ cwd });
  const runner = new PluginRunner({
    plugins,
    options: {
      timeoutMs,
    },
  });

  const result = await runner.runSetup({ pluginName });
  console.log(`Setup complete: ${result.pluginName}`);
  if (result.output) {
    for (const line of formatPluginOutputLines({ output: result.output })) {
      console.log(line);
    }
  }
}

async function handleTransactionsList(): Promise<void> {
  const db = getDb();
  const rows = db
    .query("SELECT id, created_at, protocol, status, url FROM transactions ORDER BY created_at DESC LIMIT 50")
    .all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    console.log(`${row.id} ${row.protocol} ${row.status} ${row.url} ${row.created_at}`);
  }
}

async function handleTransactionShow({ id }: { id: string }): Promise<void> {
  const db = getDb();
  const row = db
    .query("SELECT id, created_at, protocol, url, method, asset, amount, network, status, tx_hash, error FROM transactions WHERE id = ? LIMIT 1")
    .get(id) as Record<string, unknown> | null;
  if (!row) {
    console.log("Transaction not found.");
    return;
  }
  console.log(JSON.stringify(row, null, 2));
}

async function handleRequest({ args, flags, cwd }: { args: string[]; flags: GlobalFlags; cwd: string }): Promise<void> {
  const parsed = parseRequestArgs({ args });
  const response = await requestWithPayment({
    url: parsed.url,
    request: parsed.options,
    cwd,
    disablePlugins: flags.disablePlugins,
    pluginsTimeoutMs: flags.pluginsTimeoutMs,
    preferredProtocol: flags.protocol,
    dryRun: flags.dryRun,
  });

  await printResponse({ response, includeHeaders: parsed.options.includeHeaders });
}

function handleCliError({ error }: { error: unknown }): never {
  if (error instanceof KnoxError) {
    console.error(`Error [${error.code}]: ${error.message}`);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}

function requireForceForReplacement({
  force,
  command,
  existingAddress,
}: {
  force?: boolean;
  command: string;
  existingAddress?: string;
}): void {
  if (force || !existingAddress) {
    return;
  }

  const warning = [
    `Warning: this command will replace your current local account: ${existingAddress}`,
    `Rerun with --force to continue: ${command} --force`,
  ].join("\n");

  throw new Error(warning);
}

function formatPluginOutputLines({ output }: { output: string }): string[] {
  return output.split("\n").map((line) => `  ${line}`);
}

async function main(): Promise<void> {
  const program = new Command();
  const cwd = process.cwd();

  program
    .name("knox")
    .description("curl-like crypto payment CLI")
    .showHelpAfterError()
    .option("--dry-run", "Parse payment challenge and print plan without signing or paying")
    .option("--no-plugins", "Disable all plugins")
    .option("--plugins-timeout-ms <ms>", "Plugin timeout in milliseconds", (value) => Number(value), 10_000)
    .addOption(
      new Command()
        .createOption("--protocol <protocol>", "Preferred payment protocol")
        .choices(["auto", "x402", "mpp"])
        .default("auto"),
    );

  const account = program.command("account").description("Manage local account");

  account
    .command("status")
    .description("Show active account")
    .action(async () => {
      const active = getActiveAccount();
      if (!active) {
        console.log("No active account configured.");
        return;
      }

      const flags = getGlobalFlags({ program });
      console.log(`Active account: ${active.address}`);
      console.log(`Source: ${active.source}`);

      if (!flags.disablePlugins) {
        const plugins = await loadPlugins({ cwd });
        const runner = new PluginRunner({
          plugins,
          options: {
            timeoutMs: flags.pluginsTimeoutMs,
          },
        });
        const outputs = await runner.runAccountStatus({
          event: {
            account: {
              address: active.address,
              source: active.source,
            },
          },
        });

        if (outputs.length > 0) {
          console.log("Plugin outputs:");
          for (const item of outputs) {
            console.log(`${item.pluginName}:`);
            for (const line of formatPluginOutputLines({ output: item.output })) {
              console.log(line);
            }
          }
        }
      }
    });

  account
    .command("create")
    .description("Create and activate a new account")
    .option("--force", "Acknowledge account replacement")
    .action((options: { force?: boolean }) => {
      const active = getActiveAccount();
      requireForceForReplacement({
        force: options.force,
        command: "knox account create",
        existingAddress: active?.address,
      });
      const createdAccount = createAccount();
      console.log("Created account:");
      console.log(createdAccount.address);
    });

  account
    .command("import")
    .description("Import and activate account from private key")
    .requiredOption("--private-key <hex>", "Hex private key")
    .option("--force", "Acknowledge account replacement")
    .action((options: { privateKey: string; force?: boolean }) => {
      const active = getActiveAccount();
      requireForceForReplacement({
        force: options.force,
        command: "knox account import --private-key <hex>",
        existingAddress: active?.address,
      });
      const importedAccount = importAccount({ privateKey: options.privateKey });
      console.log("Imported and activated account:");
      console.log(importedAccount.address);
    });

  const tx = program.command("tx").description("Inspect payment transactions");

  tx
    .command("list")
    .description("List recent transactions")
    .action(async () => {
      await handleTransactionsList();
    });

  tx
    .command("show")
    .description("Show transaction details")
    .argument("<id>", "Transaction id")
    .action(async (id: string) => {
      await handleTransactionShow({ id });
    });

  const plugins = program.command("plugins").description("Inspect plugins");

  plugins
    .command("list")
    .description("List discovered plugins")
    .action(async () => {
      await handlePluginsList({ cwd });
    });

  plugins
    .command("setup")
    .description("Run setup for a specific plugin")
    .argument("<pluginName>", "Plugin name")
    .action(async (pluginName: string) => {
      const flags = getGlobalFlags({ program });
      await handlePluginSetup({
        cwd,
        pluginName,
        timeoutMs: flags.pluginsTimeoutMs,
      });
    });

  program
    .command("request")
    .description("Execute a curl-like paid request")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument("[curlArgs...]", "Request URL and curl-style options")
    .action(async (curlArgs: string[]) => {
      const flags = getGlobalFlags({ program });
      await handleRequest({ args: curlArgs, flags, cwd });
    });

  if (Bun.argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(Bun.argv);
}

main().catch((error) => {
  handleCliError({ error });
});
