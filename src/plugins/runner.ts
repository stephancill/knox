import { getDb, nowIso, randomId } from "../store/db.ts";
import { KnoxError } from "../types.ts";
import type { PaymentIntent } from "../types.ts";
import type {
  AccountPlugin,
  AccountStatusEvent,
  AccountStatusResult,
  AfterTransactionEvent,
  BeforeSignEvent,
  BeforeSignResult,
  BeforeTransactionEvent,
  BeforeTransactionResult,
  PluginSetupEvent,
  PluginSetupResult,
} from "./types.ts";

export type AccountStatusPluginOutput = {
  pluginName: string;
  output: string;
};

export type PluginSetupOutput = {
  pluginName: string;
  output?: string;
};

type RunnerOptions = {
  timeoutMs: number;
  transactionId?: string;
};

function withTimeout<T>({
  promise,
  timeoutMs,
  label,
}: {
  promise: Promise<T>;
  timeoutMs: number;
  label: string;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(id);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

function logPluginRun({
  options,
  pluginName,
  eventName,
  status,
  durationMs,
  error,
}: {
  options: RunnerOptions;
  pluginName: string;
  eventName: string;
  status: string;
  durationMs: number;
  error?: string;
}): void {
  const db = getDb();
  const stmt = db.query(
    "INSERT INTO plugin_runs (id, transaction_id, plugin_name, event_name, status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  stmt.run(
    randomId({ prefix: "prun" }),
    options.transactionId ?? null,
    pluginName,
    eventName,
    status,
    durationMs,
    error ?? null,
    nowIso(),
  );
}

export class PluginRunner {
  private readonly plugins: AccountPlugin[];
  private readonly options: RunnerOptions;

  constructor({ plugins, options }: { plugins: AccountPlugin[]; options: RunnerOptions }) {
    this.plugins = plugins;
    this.options = options;
  }

  async runBeforeTransaction({ event }: { event: BeforeTransactionEvent }): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.beforeTransaction) {
        continue;
      }
      const start = performance.now();
      try {
        const result = await withTimeout<BeforeTransactionResult | undefined>({
          promise: Promise.resolve(plugin.beforeTransaction(event)),
          timeoutMs: this.options.timeoutMs,
          label: `${plugin.name}.beforeTransaction`,
        });
        const ms = Math.round(performance.now() - start);
        if (result?.action === "abort") {
          logPluginRun({
            options: this.options,
            pluginName: plugin.name,
            eventName: "beforeTransaction",
            status: "aborted",
            durationMs: ms,
            error: result.reason,
          });
          throw new KnoxError("PLUGIN_ABORT", result.reason, { plugin: plugin.name, event: "beforeTransaction" });
        }
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "beforeTransaction",
          status: "ok",
          durationMs: ms,
        });
      } catch (error) {
        const ms = Math.round(performance.now() - start);
        const message = error instanceof Error ? error.message : String(error);
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "beforeTransaction",
          status: "failed",
          durationMs: ms,
          error: message,
        });
        if (error instanceof KnoxError) {
          throw error;
        }
        throw new KnoxError("PLUGIN_FAILURE", message, { plugin: plugin.name, event: "beforeTransaction" });
      }
    }
  }

  async runBeforeSign({ event }: { event: BeforeSignEvent }): Promise<PaymentIntent> {
    let intent = event.intent;
    for (const plugin of this.plugins) {
      if (!plugin.beforeSign) {
        continue;
      }
      const start = performance.now();
      try {
        const result = await withTimeout<BeforeSignResult | undefined>({
          promise: Promise.resolve(plugin.beforeSign({ ...event, intent })),
          timeoutMs: this.options.timeoutMs,
          label: `${plugin.name}.beforeSign`,
        });
        const ms = Math.round(performance.now() - start);
        if (result?.action === "abort") {
          logPluginRun({
            options: this.options,
            pluginName: plugin.name,
            eventName: "beforeSign",
            status: "aborted",
            durationMs: ms,
            error: result.reason,
          });
          throw new KnoxError("PLUGIN_ABORT", result.reason, { plugin: plugin.name, event: "beforeSign" });
        }
        if (result?.action === "continue" && result.intentOverride) {
          intent = { ...intent, ...result.intentOverride };
        }
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "beforeSign",
          status: "ok",
          durationMs: ms,
        });
      } catch (error) {
        const ms = Math.round(performance.now() - start);
        const message = error instanceof Error ? error.message : String(error);
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "beforeSign",
          status: "failed",
          durationMs: ms,
          error: message,
        });
        if (error instanceof KnoxError) {
          throw error;
        }
        throw new KnoxError("PLUGIN_FAILURE", message, { plugin: plugin.name, event: "beforeSign" });
      }
    }

    return intent;
  }

  async runAfterTransaction({ event }: { event: AfterTransactionEvent }): Promise<void> {
    for (const plugin of this.plugins) {
      if (!plugin.afterTransaction) {
        continue;
      }
      const start = performance.now();
      try {
        await withTimeout<void>({
          promise: Promise.resolve(plugin.afterTransaction(event)),
          timeoutMs: this.options.timeoutMs,
          label: `${plugin.name}.afterTransaction`,
        });
        const ms = Math.round(performance.now() - start);
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "afterTransaction",
          status: "ok",
          durationMs: ms,
        });
      } catch (error) {
        const ms = Math.round(performance.now() - start);
        const message = error instanceof Error ? error.message : String(error);
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "afterTransaction",
          status: "failed",
          durationMs: ms,
          error: message,
        });
      }
    }
  }

  async runAccountStatus({ event }: { event: AccountStatusEvent }): Promise<AccountStatusPluginOutput[]> {
    const outputs: AccountStatusPluginOutput[] = [];
    for (const plugin of this.plugins) {
      if (!plugin.accountStatus) {
        continue;
      }

      const start = performance.now();
      try {
        const result = await withTimeout<AccountStatusResult | undefined>({
          promise: Promise.resolve(plugin.accountStatus(event)),
          timeoutMs: this.options.timeoutMs,
          label: `${plugin.name}.accountStatus`,
        });
        const ms = Math.round(performance.now() - start);
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "accountStatus",
          status: "ok",
          durationMs: ms,
        });

        if (result && "output" in result) {
          if (typeof result.output !== "string") {
            throw new Error("accountStatus output must be a string");
          }
          outputs.push({
            pluginName: plugin.name,
            output: result.output,
          });
        }
      } catch (error) {
        const ms = Math.round(performance.now() - start);
        const message = error instanceof Error ? error.message : String(error);
        logPluginRun({
          options: this.options,
          pluginName: plugin.name,
          eventName: "accountStatus",
          status: "failed",
          durationMs: ms,
          error: message,
        });
        outputs.push({
          pluginName: plugin.name,
          output: `[error] ${message}`,
        });
      }
    }
    return outputs;
  }

  async runSetup({ pluginName, event }: { pluginName: string; event: PluginSetupEvent }): Promise<PluginSetupOutput> {
    const plugin = this.plugins.find((item) => item.name === pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }
    if (!plugin.setup) {
      throw new Error(`Plugin does not implement setup(): ${pluginName}`);
    }

    const start = performance.now();
    try {
      const result = await withTimeout<PluginSetupResult | undefined>({
        promise: Promise.resolve(plugin.setup(event)),
        timeoutMs: this.options.timeoutMs,
        label: `${plugin.name}.setup`,
      });
      const ms = Math.round(performance.now() - start);
      logPluginRun({
        options: this.options,
        pluginName: plugin.name,
        eventName: "setup",
        status: "ok",
        durationMs: ms,
      });

      return {
        pluginName: plugin.name,
        output: result?.output,
      };
    } catch (error) {
      const ms = Math.round(performance.now() - start);
      const message = error instanceof Error ? error.message : String(error);
      logPluginRun({
        options: this.options,
        pluginName: plugin.name,
        eventName: "setup",
        status: "failed",
        durationMs: ms,
        error: message,
      });
      throw new Error(`Plugin setup failed (${plugin.name}): ${message}`);
    }
  }
}
