# Knox

Knox is a Bun-based CLI payment client for paid HTTP APIs that support `402 Payment Required` with:

- x402
- MPP

It provides a curl-like request command, a local account store, and a plugin system with pre-sign hooks.

## Install

```bash
bun install
```

Global install from npm:

```bash
npm install -g knox-wallet
knox --help
```

## Run

```bash
knox --help
```

## Core Commands

```bash
# account management
knox account create --force
knox account import --private-key <hex> --force
knox account status

# request execution
knox request https://httpbin.org/get
knox request --protocol x402 "https://lorem.steer.fun/generate?count=2&units=paragraphs&format=plain"
knox request --protocol mpp "https://lorem.steer.fun/generate?count=2&units=paragraphs&format=plain"

# dry run (no signature, no payment)
knox --dry-run request --protocol x402 "https://lorem.steer.fun/generate?count=2&units=paragraphs&format=plain"

# transactions and plugins
knox tx list
knox tx show <id>
knox plugins list
knox plugins setup <plugin-name>
```

## Global Flags

- `--protocol auto|x402|mpp`
- `--dry-run`
- `--no-plugins`
- `--plugins-timeout-ms <ms>`

## Account Model

- Knox supports one local account for now.
- Running `account create` or `account import` replaces the existing account.
- If an account already exists, use `--force` with `account create` and `account import` to confirm replacement.

## Plugin Locations

- `~/.knox/plugins/*.{ts,js,mjs,cjs}`
- `.knox/plugins/*.{ts,js,mjs,cjs}`

## Plugins API

Plugin module shape:

```ts
export type AccountPlugin = {
  name: string;
  setup?: (event: PluginSetupEvent) => Promise<PluginSetupResult | void>;
  beforeTransaction?: (event: BeforeTransactionEvent) => Promise<BeforeTransactionResult | void>;
  beforeSign?: (event: BeforeSignEvent) => Promise<BeforeSignResult | void>;
  afterTransaction?: (event: AfterTransactionEvent) => Promise<void>;
  accountStatus?: (event: AccountStatusEvent) => Promise<AccountStatusResult | void>;
};
```

Event contracts:

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
  account: {
    address: `0x${string}`;
    source: string;
  } | null;
};
```

Behavior:

- `beforeTransaction`: fail-closed, can block payment.
- `beforeSign`: fail-closed, can block payment and optionally mutate `PaymentIntent` via `intentOverride`.
- `afterTransaction`: fail-open, errors are logged.
- `accountStatus`: runs during `knox account status`; output is rendered as multiline text under plugin name.
- `setup`: runs when invoking `knox plugins setup <plugin-name>` and receives current account context (or `null`).

Minimal plugin example:

```ts
export default {
  name: "status-note",
  async accountStatus() {
    return {
      output: "All systems nominal\nReady to pay",
    };
  },
};
```

Example plugins:

- `examples/plugins/confirm-before-sign.ts`: interactive blocking confirmation before signing.
- `examples/plugins/account-status-balances.ts`: reports Base USDC and Tempo token balances in `knox account status`.

To activate an example plugin, copy it to one of the plugin directories:

```bash
mkdir -p .knox/plugins
cp examples/plugins/confirm-before-sign.ts .knox/plugins/
cp examples/plugins/account-status-balances.ts .knox/plugins/
```

## Development

```bash
bun run typecheck
```

## Releasing

Knox uses Changesets with a manually triggered GitHub Actions workflow.

1. Add a changeset in your PR:

```bash
bun run changeset
```

2. Merge the PR into `main`.
3. In GitHub, run the `Release` workflow manually from Actions.
4. If there are unpublished changesets, the workflow creates or updates a version PR (`chore: version packages`).
5. Merge the version PR, then run the `Release` workflow again to publish.

Trusted publishing is configured for npm via GitHub OIDC, so no long-lived `NPM_TOKEN` is required for normal releases.

## Design

- Technical design: `docs/technical-design.md`
