# Knox

Knox is a Bun-based CLI payment client for paid HTTP APIs that support `402 Payment Required` with:

- x402
- MPP

It provides a curl-like request command, a local account store, and a plugin system with pre-sign hooks.

## Install

```bash
bun install
```

## Run

```bash
bun run src/cli.ts --help
```

## Core Commands

```bash
# account management
bun run src/cli.ts account create
bun run src/cli.ts account import --private-key <hex>
bun run src/cli.ts account status

# request execution
bun run src/cli.ts request https://httpbin.org/get
bun run src/cli.ts request --protocol x402 "https://lorem.steer.fun/generate?count=2&units=paragraphs&format=plain"
bun run src/cli.ts request --protocol mpp "https://lorem.steer.fun/generate?count=2&units=paragraphs&format=plain"

# dry run (no signature, no payment)
bun run src/cli.ts --dry-run request --protocol x402 "https://lorem.steer.fun/generate?count=2&units=paragraphs&format=plain"

# transactions and plugins
bun run src/cli.ts tx list
bun run src/cli.ts tx show <id>
bun run src/cli.ts plugins list
```

## Global Flags

- `--protocol auto|x402|mpp`
- `--dry-run`
- `--no-plugins`
- `--plugins-timeout-ms <ms>`

## Account Model

- Knox supports one local account for now.
- Running `account create` or `account import` replaces the existing account.

## Plugin Locations

- `~/.knox/plugins/*.{ts,js,mjs,cjs}`
- `.knox/plugins/*.{ts,js,mjs,cjs}`

## Development

```bash
bun run typecheck
```

## Design

- Technical design: `docs/technical-design.md`
