import type { PaymentIntent } from "../types.ts";

type UserAddressContext = {
  userAddress: `0x${string}`;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type PluginKvStore = {
  get: (params: { key: string }) => Promise<JsonValue | undefined>;
  set: (params: { key: string; value: JsonValue }) => Promise<void>;
};

export type BeforeTransactionEvent = {
  userAddress: UserAddressContext["userAddress"];
  intent: PaymentIntent;
  attempt: number;
  kv: PluginKvStore;
};

export type BeforeTransactionResult = { action: "continue" } | { action: "abort"; reason: string };

export type BeforeSignEvent = {
  userAddress: UserAddressContext["userAddress"];
  intent: PaymentIntent;
  challengeRaw: unknown;
  attempt: number;
  kv: PluginKvStore;
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
  kv: PluginKvStore;
};

export type AccountStatusEvent = {
  userAddress: UserAddressContext["userAddress"];
  accountSource: string;
  kv: PluginKvStore;
};

export type AccountStatusResult = {
  output: string;
};

export type PluginSetupResult = {
  output?: string;
};

export type PluginSetupEvent = {
  userAddress: UserAddressContext["userAddress"] | null;
  kv: PluginKvStore;
};

export type AccountPlugin = {
  name: string;
  beforeTransaction?: (e: BeforeTransactionEvent) => Promise<BeforeTransactionResult | undefined>;
  beforeSign?: (e: BeforeSignEvent) => Promise<BeforeSignResult | undefined>;
  afterTransaction?: (e: AfterTransactionEvent) => Promise<void>;
  accountStatus?: (e: AccountStatusEvent) => Promise<AccountStatusResult | undefined>;
  setup?: (e: PluginSetupEvent) => Promise<PluginSetupResult | undefined>;
};
