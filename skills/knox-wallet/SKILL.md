---
name: knox-wallet
description: Help users install and use the Knox Wallet CLI from npm. Use when users want setup instructions, command examples, plugin usage, dry-run behavior, account import/create flows, or troubleshooting x402 and MPP paid API requests.
---

# Knox Wallet

Use Knox as a CLI payment client for paid HTTP APIs supporting x402 and MPP.

## Install

1. Install globally:

```bash
npm install -g knox-wallet
```

2. Confirm install:

```bash
knox --help
```

3. Upgrade to latest:

```bash
npm install -g knox-wallet@latest
```

## Quick Start

1. Create or import account:

```bash
knox account create
knox account import --private-key <hex>
knox account status
```

2. Try a free request:

```bash
knox request https://httpbin.org/get
```

3. Inspect paid request without spending:

```bash
knox --dry-run request --protocol x402 "https://lorem.steer.fun/generate?count=1&units=paragraphs&format=plain"
```

4. Make paid requests:

```bash
knox request --protocol x402 "https://lorem.steer.fun/generate?count=1&units=paragraphs&format=plain"
knox request --protocol mpp "https://lorem.steer.fun/generate?count=1&units=paragraphs&format=plain"
```

## Core Commands

1. Account:
   - `knox account create`
   - `knox account import --private-key <hex>`
   - `knox account status`
2. Requests:
   - `knox request [curl-style options] <url>`
3. Transactions:
   - `knox tx list`
   - `knox tx show <id>`
4. Plugins:
    - `knox plugins list`
    - `knox plugins setup <plugin-name>`

## Global Flags

1. `--protocol auto|x402|mpp`
2. `--dry-run`
3. `--no-plugins`

## Plugins

1. Load plugins from:
   - `~/.knox/plugins/*.{ts,js,mjs,cjs}`
   - `.knox/plugins/*.{ts,js,mjs,cjs}`
2. Implement plugin module shape:

```ts
export type AccountPlugin = {
  name: string;
  setup?: (event: PluginSetupEvent) => Promise<PluginSetupResult | undefined>;
  beforeTransaction?: (event: BeforeTransactionEvent) => Promise<BeforeTransactionResult | undefined>;
  beforeSign?: (event: BeforeSignEvent) => Promise<BeforeSignResult | undefined>;
  afterTransaction?: (event: AfterTransactionEvent) => Promise<void>;
  accountStatus?: (event: AccountStatusEvent) => Promise<AccountStatusResult | undefined>;
};
```

3. Use event result contracts:

```ts
type BeforeTransactionResult =
  | { action: "continue" }
  | { action: "abort"; reason: string };

type BeforeSignResult =
  | { action: "continue"; intentOverride?: Partial<PaymentIntent> }
  | { action: "abort"; reason: string };

type AccountStatusResult = { output: string };

type PluginSetupResult = { output?: string };

type PluginSetupEvent = {
  userAddress: `0x${string}` | null;
};

type BeforeTransactionEvent = {
  userAddress: `0x${string}`;
  intent: PaymentIntent;
  attempt: number;
};

type BeforeSignEvent = {
  userAddress: `0x${string}`;
  intent: PaymentIntent;
  challengeRaw: unknown;
  attempt: number;
};

type AfterTransactionEvent = {
  userAddress: `0x${string}`;
  intent: PaymentIntent;
  success: boolean;
  responseStatus?: number;
  error?: string;
};

type AccountStatusEvent = {
  userAddress: `0x${string}`;
  accountSource: string;
};
```
4. Use plugin events:
   - `setup`
   - `beforeTransaction`
   - `beforeSign`
   - `afterTransaction`
   - `accountStatus`
5. Understand event behavior:
   - `beforeTransaction`: run after 402 is parsed and before payment processing.
   - `beforeSign`: run before signing and can return `intentOverride`.
   - `afterTransaction`: run after payment attempt; failures are logged and do not block command success.
   - `accountStatus`: run during `knox account status`; plugin output is displayed under account address/source with plugin name.
   - `setup`: run on demand via `knox plugins setup <plugin-name>` and receives `userAddress` (or `null`).
6. Expect output formatting for account status:
   - Knox prints:
     - `Active account: <address>`
     - `Source: <source>`
     - `Plugin outputs:`
     - `<plugin-name>:`
     - `  <plugin output line 1>`
     - `  <plugin output line 2>`
7. Use `--no-plugins` to bypass plugins for troubleshooting.

## Troubleshooting

1. If request still returns `402`, verify funded account and token/network match challenge.
2. If x402 fails, retry with `--protocol x402` and inspect output headers (`-i`).
3. If MPP fails, retry with `--protocol mpp` and inspect error for chain/token balance.
4. Use dry-run first to confirm expected payment intent before spending.
5. Never expose private keys in logs, screenshots, or committed files.
