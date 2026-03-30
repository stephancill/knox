export type Protocol = "mpp" | "x402";

export type PaymentIntent = {
  protocol: Protocol;
  mode: "charge" | "session" | "exact";
  network: string;
  chainId?: number;
  asset: `0x${string}`;
  amount: bigint;
  payTo: `0x${string}`;
  requestUrl: string;
  requestMethod: string;
};

export type KnoxErrorCode =
  | "HTTP_ERROR"
  | "CHALLENGE_PARSE_ERROR"
  | "PLUGIN_ABORT"
  | "PLUGIN_FAILURE"
  | "PRECONDITION_FAILED"
  | "SIGNING_ERROR"
  | "SETTLEMENT_REJECTED";

export class KnoxError extends Error {
  constructor(
    public readonly code: KnoxErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KnoxError";
  }
}
