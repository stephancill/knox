import type { PaymentIntent, Protocol } from "../types.ts";
import { KnoxError } from "../types.ts";

type X402Accepted = {
  scheme: string;
  network: string;
  amount: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
};

function parseAmountAsBigInt({ value }: { value: string }): bigint {
  if (!/^\d+$/.test(value)) {
    throw new KnoxError("CHALLENGE_PARSE_ERROR", "Payment amount must be an integer string", {
      amount: value,
    });
  }
  return BigInt(value);
}

function parseEvmChainId({ network }: { network: string }): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match || !match[1]) {
    throw new KnoxError("PRECONDITION_FAILED", "Only EVM CAIP-2 network ids are supported", { network });
  }
  return Number(match[1]);
}

function normalizeEvmAddress({ value, field }: { value: unknown; field: string }): `0x${string}` {
  const address = String(value ?? "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new KnoxError("CHALLENGE_PARSE_ERROR", `Invalid ${field} address`, {
      field,
      value,
    });
  }
  return address as `0x${string}`;
}

function decodeBase64Json({
  payload,
  errorMessage,
}: { payload: string; errorMessage: string }): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new KnoxError("CHALLENGE_PARSE_ERROR", errorMessage);
  }
}

function findWwwAuthParam({ headerValue, key }: { headerValue: string; key: string }): string | null {
  const pattern = new RegExp(`${key}="([^"]+)"`);
  const match = pattern.exec(headerValue);
  return match?.[1] ?? null;
}

function parseX402Intent({
  url,
  method,
  header,
}: {
  url: string;
  method: string;
  header: string;
}): PaymentIntent {
  const decoded = decodeBase64Json({
    payload: header,
    errorMessage: "Invalid PAYMENT-REQUIRED payload",
  });

  const accepts = Array.isArray(decoded.accepts) ? decoded.accepts : [];
  const supported = accepts
    .map((entry) => entry as Record<string, unknown>)
    .find(
      (entry) => entry.scheme === "exact" && typeof entry.network === "string" && entry.network.startsWith("eip155:"),
    );

  if (!supported) {
    throw new KnoxError(
      "PRECONDITION_FAILED",
      "No supported x402 accepted payment option found (requires exact + eip155 network)",
    );
  }

  const accepted: X402Accepted = {
    scheme: String(supported.scheme),
    network: String(supported.network),
    amount: String(supported.amount ?? "0"),
    asset: normalizeEvmAddress({ value: supported.asset, field: "asset" }),
    payTo: normalizeEvmAddress({ value: supported.payTo, field: "payTo" }),
  };

  return {
    protocol: "x402",
    mode: "exact",
    network: accepted.network,
    chainId: parseEvmChainId({ network: accepted.network }),
    asset: accepted.asset,
    amount: parseAmountAsBigInt({ value: accepted.amount }),
    payTo: accepted.payTo,
    requestUrl: url,
    requestMethod: method,
  };
}

function parseMppIntent({
  url,
  method,
  header,
}: {
  url: string;
  method: string;
  header: string;
}): PaymentIntent {
  const requestB64 = findWwwAuthParam({ headerValue: header, key: "request" });
  if (!requestB64) {
    throw new KnoxError("CHALLENGE_PARSE_ERROR", "MPP challenge missing request field");
  }

  const requestPayload = decodeBase64Json({
    payload: requestB64,
    errorMessage: "Invalid MPP challenge request payload",
  });

  const methodDetails = (requestPayload.methodDetails ?? {}) as Record<string, unknown>;
  const chainId = Number(methodDetails.chainId ?? 8453);
  const currency = normalizeEvmAddress({ value: requestPayload.currency, field: "currency" });
  const recipient = normalizeEvmAddress({ value: requestPayload.recipient, field: "recipient" });

  return {
    protocol: "mpp",
    mode: "charge",
    network: `eip155:${chainId}`,
    chainId,
    asset: currency,
    amount: parseAmountAsBigInt({ value: String(requestPayload.amount ?? "0") }),
    payTo: recipient,
    requestUrl: url,
    requestMethod: method,
  };
}

export function detectProtocol({ response }: { response: Response }): Protocol | null {
  if (response.headers.get("PAYMENT-REQUIRED")) {
    return "x402";
  }

  const www = response.headers.get("WWW-Authenticate")?.toLowerCase() ?? "";
  if (www.includes("payment") && www.includes("method=")) {
    return "mpp";
  }

  return null;
}

export function parseIntentFromChallenge({
  protocol,
  response,
  url,
  method,
}: {
  protocol: Protocol;
  response: Response;
  url: string;
  method: string;
}): PaymentIntent {
  if (protocol === "x402") {
    const header = response.headers.get("PAYMENT-REQUIRED");
    if (!header) {
      throw new KnoxError("CHALLENGE_PARSE_ERROR", "Missing PAYMENT-REQUIRED header");
    }
    return parseX402Intent({ url, method, header });
  }

  const header = response.headers.get("WWW-Authenticate");
  if (!header) {
    throw new KnoxError("CHALLENGE_PARSE_ERROR", "Missing WWW-Authenticate header");
  }

  return parseMppIntent({ url, method, header });
}
