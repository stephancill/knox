import type { PaymentIntent } from "../types.ts";

export type BeforeTransactionEvent = {
  intent: PaymentIntent;
  attempt: number;
};

export type BeforeTransactionResult =
  | { action: "continue" }
  | { action: "abort"; reason: string };

export type BeforeSignEvent = {
  intent: PaymentIntent;
  account: {
    address: `0x${string}`;
  };
  challengeRaw: unknown;
  attempt: number;
};

export type BeforeSignResult =
  | {
      action: "continue";
      intentOverride?: Partial<PaymentIntent>;
    }
  | { action: "abort"; reason: string };

export type AfterTransactionEvent = {
  intent: PaymentIntent;
  success: boolean;
  responseStatus?: number;
  error?: string;
};

export type AccountStatusEvent = {
  account: {
    address: `0x${string}`;
    source: string;
  };
};

export type AccountStatusResult = {
  output: string;
};

export type AccountPlugin = {
  name: string;
  beforeTransaction?: (e: BeforeTransactionEvent) => Promise<BeforeTransactionResult | void>;
  beforeSign?: (e: BeforeSignEvent) => Promise<BeforeSignResult | void>;
  afterTransaction?: (e: AfterTransactionEvent) => Promise<void>;
  accountStatus?: (e: AccountStatusEvent) => Promise<AccountStatusResult | void>;
};
