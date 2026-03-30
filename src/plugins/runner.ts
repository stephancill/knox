import { getDb, nowIso, randomId } from "../store/db.ts";
import { KnoxError } from "../types.ts";
import type { PaymentIntent } from "../types.ts";
import type {
  AccountPlugin,
  AfterTransactionEvent,
  BeforeSignEvent,
  BeforeSignResult,
  BeforeTransactionEvent,
  BeforeTransactionResult,
} from "./types.ts";

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
        const result = await withTimeout<BeforeTransactionResult | void>({
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
        const result = await withTimeout<BeforeSignResult | void>({
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
}
