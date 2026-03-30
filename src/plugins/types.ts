import type { PaymentIntent } from "../types.ts";

type UserAddressContext = {
  userAddress: `0x${string}`;
};

export type BeforeTransactionEvent = {
  userAddress: UserAddressContext["userAddress"];
  intent: PaymentIntent;
  attempt: number;
};

export type BeforeTransactionResult = { action: "continue" } | { action: "abort"; reason: string };

export type BeforeSignEvent = {
  userAddress: UserAddressContext["userAddress"];
  intent: PaymentIntent;
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
  userAddress: UserAddressContext["userAddress"];
  intent: PaymentIntent;
  success: boolean;
  responseStatus?: number;
  error?: string;
};

export type AccountStatusEvent = {
  userAddress: UserAddressContext["userAddress"];
  accountSource: string;
};

export type AccountStatusResult = {
  output: string;
};

export type PluginSetupResult = {
  output?: string;
};

export type PluginSetupEvent = {
  userAddress: UserAddressContext["userAddress"] | null;
};

export type AccountPlugin = {
  name: string;
  beforeTransaction?: (e: BeforeTransactionEvent) => Promise<BeforeTransactionResult | undefined>;
  beforeSign?: (e: BeforeSignEvent) => Promise<BeforeSignResult | undefined>;
  afterTransaction?: (e: AfterTransactionEvent) => Promise<void>;
  accountStatus?: (e: AccountStatusEvent) => Promise<AccountStatusResult | undefined>;
  setup?: (e: PluginSetupEvent) => Promise<PluginSetupResult | undefined>;
};
