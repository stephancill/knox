import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

import { getActiveAccount } from "../account/repository.ts";
import { executeHttpRequest, type RequestOptions } from "../http/request.ts";
import { loadPlugins } from "../plugins/loader.ts";
import { PluginRunner } from "../plugins/runner.ts";
import { getDb, nowIso, randomId } from "../store/db.ts";
import type { PaymentIntent } from "../types.ts";
import { KnoxError } from "../types.ts";
import { detectProtocol, parseIntentFromChallenge } from "./adapters.ts";

type RequestWithPaymentOptions = {
  url: string;
  request: RequestOptions;
  cwd: string;
  disablePlugins: boolean;
  pluginsTimeoutMs: number;
  preferredProtocol: "auto" | "x402" | "mpp";
  dryRun: boolean;
};

function resolveProtocol({
  response,
  preferredProtocol,
}: {
  response: Response;
  preferredProtocol: "auto" | "x402" | "mpp";
}): "x402" | "mpp" | null {
  const hasX402 = response.headers.get("PAYMENT-REQUIRED") != null;
  const hasMpp = response.headers.get("WWW-Authenticate") != null;

  if (preferredProtocol === "x402") {
    return hasX402 ? "x402" : null;
  }
  if (preferredProtocol === "mpp") {
    return hasMpp ? "mpp" : null;
  }

  return detectProtocol({ response });
}

function logTransaction({
  id,
  protocol,
  url,
  method,
  status,
  asset,
  amount,
  network,
  txHash,
  error,
}: {
  id: string;
  protocol: string;
  url: string;
  method: string;
  status: string;
  asset?: string;
  amount?: bigint;
  network?: string;
  txHash?: string;
  error?: string;
}): void {
  const db = getDb();
  const stmt = db.query(
    "INSERT INTO transactions (id, created_at, protocol, url, method, asset, amount, network, status, tx_hash, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  stmt.run(
    id,
    nowIso(),
    protocol,
    url,
    method,
    asset ?? null,
    amount ? amount.toString() : null,
    network ?? null,
    status,
    txHash ?? null,
    error ?? null,
  );
}

function assertEvmIntent({ intent }: { intent: PaymentIntent }): void {
  if (!intent.network.startsWith("eip155:")) {
    throw new KnoxError("PRECONDITION_FAILED", "Only EVM networks are supported", {
      network: intent.network,
    });
  }

  if (intent.chainId && intent.chainId <= 0) {
    throw new KnoxError("PRECONDITION_FAILED", "Invalid chain id", { chainId: intent.chainId });
  }
}

function resolveRpcUrl({ chainId }: { chainId: number }): string {
  const chainScoped = Bun.env[`EVM_RPC_URL_${chainId}`];
  if (chainScoped) {
    return chainScoped;
  }

  if (Bun.env.EVM_RPC_URL) {
    return Bun.env.EVM_RPC_URL;
  }

  if (chainId === 8453) {
    return "https://mainnet.base.org";
  }

  if (chainId === 84532) {
    return "https://sepolia.base.org";
  }

  throw new KnoxError("PRECONDITION_FAILED", "Missing RPC URL. Set EVM_RPC_URL or EVM_RPC_URL_<chainId>", {
    chainId,
  });
}

function requirementMatchesIntent({
  requirement,
  intent,
}: {
  requirement: Record<string, unknown>;
  intent: PaymentIntent;
}): boolean {
  const network = String(requirement.network ?? "");
  const asset = String(requirement.asset ?? "").toLowerCase();
  const payTo = String(requirement.payTo ?? "").toLowerCase();
  const amount = String(requirement.amount ?? "");

  return (
    network === intent.network &&
    asset === intent.asset.toLowerCase() &&
    payTo === intent.payTo.toLowerCase() &&
    amount === intent.amount.toString()
  );
}

async function payWithX402({
  url,
  request,
  initial,
  privateKey,
  intent,
}: {
  url: string;
  request: RequestOptions;
  initial: Response;
  privateKey: `0x${string}`;
  intent: PaymentIntent;
}): Promise<{ response: Response; txHash?: string }> {
  const signer = privateKeyToAccount(privateKey);
  const client = new x402Client((_, requirements) => {
    const chosen = requirements.find((item) => requirementMatchesIntent({ requirement: item as Record<string, unknown>, intent }));
    if (!chosen) {
      throw new KnoxError("PRECONDITION_FAILED", "Mutated intent does not match any x402 accepted requirement", {
        network: intent.network,
        asset: intent.asset,
        payTo: intent.payTo,
        amount: intent.amount.toString(),
      });
    }
    return chosen;
  });

  registerExactEvmScheme(client, {
    signer,
    schemeOptions: {
      rpcUrl: resolveRpcUrl({ chainId: intent.chainId ?? 8453 }),
    },
  });

  const httpClient = new x402HTTPClient(client);
  const paymentRequired = httpClient.getPaymentRequiredResponse((name) => initial.headers.get(name));
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const response = await executeHttpRequest({
    url,
    options: {
      ...request,
      headers: {
        ...request.headers,
        ...paymentHeaders,
      },
    },
  });

  const txHash =
    typeof (paymentPayload.payload as Record<string, unknown>)?.signature === "string"
      ? String((paymentPayload.payload as Record<string, unknown>).signature)
      : undefined;

  return { response, txHash };
}

async function payWithMpp({
  url,
  request,
  privateKey,
}: {
  url: string;
  request: RequestOptions;
  privateKey: `0x${string}`;
}): Promise<{ response: Response; txHash?: string }> {
  const account = privateKeyToAccount(privateKey);
  const mppx = Mppx.create({
    fetch: fetch,
    methods: [tempo({ account })],
    polyfill: false,
  });

  const response = await mppx.fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  return { response, txHash: undefined };
}

export async function requestWithPayment({
  url,
  request,
  cwd,
  disablePlugins,
  pluginsTimeoutMs,
  preferredProtocol,
  dryRun,
}: RequestWithPaymentOptions): Promise<Response> {
  const initial = await executeHttpRequest({ url, options: request });
  if (initial.status !== 402) {
    return initial;
  }

  const account = getActiveAccount();
  if (!account) {
    throw new KnoxError("PRECONDITION_FAILED", "No active account. Run: knox account create or knox account import");
  }

  const protocol = resolveProtocol({
    response: initial,
    preferredProtocol,
  });
  if (!protocol) {
    throw new KnoxError("CHALLENGE_PARSE_ERROR", "Received 402 but could not select requested protocol", {
      preferredProtocol,
    });
  }

  const txId = randomId({ prefix: "tx" });
  const plugins = disablePlugins || dryRun ? [] : await loadPlugins({ cwd });
  const runner = new PluginRunner({
    plugins,
    options: {
      timeoutMs: pluginsTimeoutMs,
      transactionId: txId,
    },
  });

  const baseIntent = parseIntentFromChallenge({
    protocol,
    response: initial,
    url,
    method: request.method,
  });

  if (dryRun) {
    assertEvmIntent({ intent: baseIntent });

    logTransaction({
      id: txId,
      protocol,
      url,
      method: request.method,
      status: "dry_run",
      asset: baseIntent.asset,
      amount: baseIntent.amount,
      network: baseIntent.network,
    });

    return new Response(
      JSON.stringify(
        {
          dryRun: true,
          protocol,
          intent: {
            ...baseIntent,
            amount: baseIntent.amount.toString(),
          },
          note: "No payment signature or transaction was submitted.",
        },
        null,
        2,
      ),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-knox-dry-run": "true",
        },
      },
    );
  }

  await runner.runBeforeTransaction({
    event: {
      intent: baseIntent,
      attempt: 1,
    },
  });

  const intent = await runner.runBeforeSign({
    event: {
      intent: baseIntent,
      account: { address: account.address },
      challengeRaw: {
        paymentRequired: initial.headers.get("PAYMENT-REQUIRED"),
        wwwAuthenticate: initial.headers.get("WWW-Authenticate"),
      },
      attempt: 1,
    },
  });

  assertEvmIntent({ intent });

  try {
    const result =
      protocol === "x402"
        ? await payWithX402({
            url,
            request,
            initial,
            privateKey: account.privateKey,
            intent,
          })
        : await payWithMpp({
            url,
            request,
            privateKey: account.privateKey,
          });

    logTransaction({
      id: txId,
      protocol,
      url,
      method: request.method,
      status: result.response.status < 400 ? "success" : "failed",
      asset: intent.asset,
      amount: intent.amount,
      network: intent.network,
      txHash: result.txHash,
      error: result.response.status < 400 ? undefined : `HTTP ${result.response.status}`,
    });

    await runner.runAfterTransaction({
      event: {
        intent,
        success: result.response.status < 400,
        responseStatus: result.response.status,
        error: result.response.status < 400 ? undefined : `HTTP ${result.response.status}`,
      },
    });

    return result.response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logTransaction({
      id: txId,
      protocol,
      url,
      method: request.method,
      status: "failed",
      asset: intent.asset,
      amount: intent.amount,
      network: intent.network,
      error: message,
    });

    await runner.runAfterTransaction({
      event: {
        intent,
        success: false,
        error: message,
      },
    });

    throw error;
  }
}
