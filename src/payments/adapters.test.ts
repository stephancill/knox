import { describe, expect, test } from "bun:test";

import { KnoxError } from "../types.ts";
import { detectProtocol, parseIntentFromChallenge } from "./adapters.ts";

function b64({ value }: { value: unknown }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

describe("detectProtocol", () => {
  test("detects x402 from PAYMENT-REQUIRED header", () => {
    const response = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": "abc" },
    });

    expect(detectProtocol({ response })).toBe("x402");
  });

  test("detects mpp from WWW-Authenticate header", () => {
    const response = new Response("{}", {
      status: 402,
      headers: { "WWW-Authenticate": 'Payment method="tempo"' },
    });

    expect(detectProtocol({ response })).toBe("mpp");
  });

  test("returns null for non-payment headers", () => {
    const response = new Response("ok", { status: 200 });
    expect(detectProtocol({ response })).toBeNull();
  });
});

describe("parseIntentFromChallenge", () => {
  test("parses x402 exact evm challenge", () => {
    const challenge = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89",
        },
      ],
    };

    const response = new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": b64({ value: challenge }),
      },
    });

    const intent = parseIntentFromChallenge({
      protocol: "x402",
      response,
      url: "https://example.com/paid",
      method: "GET",
    });

    expect(intent.protocol).toBe("x402");
    expect(intent.mode).toBe("exact");
    expect(intent.chainId).toBe(8453);
    expect(intent.amount).toBe(1000n);
    expect(intent.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(intent.payTo).toBe("0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89");
  });

  test("parses mpp challenge from WWW-Authenticate request payload", () => {
    const requestPayload = {
      amount: "1000",
      currency: "0x20c000000000000000000000b9537d11c60e8b50",
      recipient: "0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89",
      methodDetails: { chainId: 4217 },
    };

    const response = new Response("{}", {
      status: 402,
      headers: {
        "WWW-Authenticate": `Payment method=\"tempo\" request=\"${b64({ value: requestPayload })}\"`,
      },
    });

    const intent = parseIntentFromChallenge({
      protocol: "mpp",
      response,
      url: "https://example.com/mpp",
      method: "POST",
    });

    expect(intent.protocol).toBe("mpp");
    expect(intent.mode).toBe("charge");
    expect(intent.chainId).toBe(4217);
    expect(intent.network).toBe("eip155:4217");
    expect(intent.amount).toBe(1000n);
  });

  test("throws KnoxError for malformed x402 header payload", () => {
    const response = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": "!!!not-base64-json!!!" },
    });

    expect(() =>
      parseIntentFromChallenge({
        protocol: "x402",
        response,
        url: "https://example.com",
        method: "GET",
      }),
    ).toThrow(KnoxError);
  });

  test("throws when x402 amount is not integer string", () => {
    const challenge = {
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1.25",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x8d25687829D6b85d9e0020B8c89e3Ca24dE20a89",
        },
      ],
    };

    const response = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": b64({ value: challenge }) },
    });

    expect(() =>
      parseIntentFromChallenge({
        protocol: "x402",
        response,
        url: "https://example.com",
        method: "GET",
      }),
    ).toThrow("Payment amount must be an integer string");
  });
});
