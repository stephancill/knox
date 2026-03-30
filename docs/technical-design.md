# Knox Technical Design

## 1. Goals

Build a CLI-first crypto account and HTTP client that:

1. Supports paid API flows for both MPP and x402.
2. Feels curl-like for request execution.
3. Supports pluggable plugins around payment execution, including a new `beforeSign` plugin event.
4. Lets integrators implement custom pre-sign behavior without coupling to any single funding strategy.
5. Supports EVM networks only in MVP.

## 2. Non-Goals (MVP)

1. Full plugin marketplace or remote plugin loading.
2. GUI account features.
3. Cross-process plugin sandboxing beyond local process controls.
4. Complete protocol coverage for every x402 and MPP extension on day one.
5. Non-EVM settlement/signing support.

## 3. Product Shape

Single application package with one binary: `knox`.

Account scope for MVP:

1. Exactly one local account is supported.
2. `knox account create` and `knox account import` replace the existing account.

Primary command:

```bash
knox request [curl-style flags] <url>
```

Supporting commands:

```bash
knox account status
knox account create
knox account import --private-key <hex>
knox tx list
knox tx show <id>
knox plugins list
```

## 4. Architecture

Keep implementation lean in one package:

```text
src/
  cli/        # command parsing + output
  http/       # request builder/executor
  payments/   # 402 detection, protocol adapters, orchestration
  account/    # key/signer/network operations (viem)
  plugins/    # plugin loader and plugin runner
  store/      # sqlite persistence
  types/      # shared interfaces/errors
```

### 4.1 Core Runtime Components

1. `RequestRunner`: executes HTTP requests and handles retries.
2. `PaymentOrchestrator`: decides whether a payment flow is needed and coordinates plugins + signing.
3. `ProtocolAdapter` (`mpp`, `x402`): protocol-specific challenge parsing, payload signing, retry header creation.
4. `PluginRunner`: executes plugin event chain with deterministic ordering and timeouts.
5. `AccountSigner`: signs protocol payloads and any chain tx needed by plugin code.

## 5. End-to-End Request Flow

1. User executes `knox request ...`.
2. `RequestRunner` sends request.
3. If response is not `402`, return response.
4. If response is `402`, `PaymentOrchestrator`:
   1. Detects protocol (`WWW-Authenticate` => MPP, `PAYMENT-REQUIRED` => x402).
   2. Parses challenge into normalized `PaymentIntent`.
   3. Runs `beforeTransaction` plugins.
   4. Runs `beforeSign` plugins.
   5. Re-validates signer preconditions (balance, allowance, nonce where applicable).
   6. Produces signed payment authorization using adapter.
   7. Retries request with protocol proof headers.
   8. Runs `afterTransaction` plugins.
   9. Persists transaction result.

## 6. Plugin System

### 6.1 Plugin Events

MVP plugin events:

1. `beforeTransaction`: preflight confirmation/policy gate.
2. `beforeSign`: pre-sign side effects and final policy gate.
3. `afterTransaction`: post-payment notifications/auditing.

Optional future event:

1. `onError`.

### 6.2 Why `beforeSign` Exists

`beforeTransaction` is too early for some integrators. They may need protocol-specific context and exact spend amount before acting.

`beforeSign` runs after `PaymentIntent` is fully resolved and immediately before signing. This allows:

1. Triggering custom pre-sign funding or authorization flows.
2. Performing allowance top-ups.
3. Running final human/device confirmation with exact amount/network/token.

### 6.3 Plugin Ordering and Failure Rules

1. Plugins run in deterministic load order.
2. `before*` plugin events are fail-closed:
   - explicit abort blocks payment
   - thrown error blocks payment
   - timeout blocks payment
3. `afterTransaction` plugins are fail-open by default:
   - failures are logged and included in metadata
   - they do not change transaction success state

### 6.4 Plugin Discovery

Auto-discovered local paths:

1. `~/.knox/plugins/*.ts`
2. `~/.knox/plugins/*.js`
3. `~/.knox/plugins/*.mjs`
4. `~/.knox/plugins/*.cjs`
5. `.knox/plugins/*.ts`
6. `.knox/plugins/*.js`
7. `.knox/plugins/*.mjs`
8. `.knox/plugins/*.cjs`

Supported module formats:

1. ESM (`.ts`, `.js`, `.mjs`) with default export.
2. CommonJS (`.cjs`, `module.exports`) when runtime requires it.

CLI switches:

1. `--no-plugins`: disable all plugins for current request.
2. `--plugins-timeout-ms <n>`: override default timeout.

## 7. Key Data Contracts

### 7.1 Normalized Payment Intent

```ts
type PaymentIntent = {
  protocol: "mpp" | "x402";
  mode: "charge" | "session" | "exact";
  network: string;           // EVM CAIP-2 network id (e.g. eip155:8453)
  chainId?: number;
  asset: `0x${string}`;
  amount: bigint;
  payTo: `0x${string}`;
  requestUrl: string;
  requestMethod: string;
};
```

### 7.2 `beforeSign` Event

```ts
type BeforeSignEvent = {
  intent: PaymentIntent;
  account: {
    address: `0x${string}`;
  };
  challengeRaw: unknown;
  attempt: number;
};

type BeforeSignResult =
  | {
      action: "continue";
      intentOverride?: Partial<PaymentIntent>;
    }
  | { action: "abort"; reason: string };
```

### 7.3 Payment Intent Mutability

`beforeSign` plugins may mutate `PaymentIntent` using `intentOverride`.

Validation rules:

1. All overrides are merged in load order, then validated once before signing.
2. Adapter must validate that final intent is still compatible with the server challenge.
3. Invalid override fails with `PRECONDITION_FAILED`.
4. Effective intent is persisted in transaction metadata for auditability.

### 7.4 Plugin Interface

```ts
export type AccountPlugin = {
  name: string;
  beforeTransaction?: (e: BeforeTransactionEvent) => Promise<BeforeTransactionResult | void>;
  beforeSign?: (e: BeforeSignEvent) => Promise<BeforeSignResult | void>;
  afterTransaction?: (e: AfterTransactionEvent) => Promise<void>;
};
```

## 8. Generic Pre-Sign Integration Model

### 8.1 Use Case

An implementer wants to perform custom funding/authorization work before signing x402 or MPP payment authorization.

### 8.2 Expected Pattern

In `beforeSign`:

1. Inspect `intent.asset`, `intent.amount`, `intent.chainId`, `account.address`.
2. Call custom service/SDK to prepare required payment preconditions.
3. Wait for operation completion or explicit proof.
4. Return `continue`.

Or return `abort` with reason when funding/authorization fails.

### 8.3 Safety Requirement

After `beforeSign`, orchestrator must refresh state and verify preconditions before signing:

1. Sufficient asset balance.
2. Sufficient permit/allowance where method requires it.
3. Chain/network consistency.

If checks fail, payment fails with explicit precondition error.

## 9. Protocol Adapter Responsibilities

### 9.1 MPP Adapter

1. Parse challenge from `WWW-Authenticate`.
2. Map to `PaymentIntent`.
3. Sign payment proof using configured signer.
4. Produce retry headers.
5. Parse and persist payment receipts when present.

### 9.2 x402 Adapter

1. Parse `PAYMENT-REQUIRED`.
2. Select accepted payment requirement.
3. Map to `PaymentIntent`.
4. Sign payment payload.
5. Produce `PAYMENT-SIGNATURE` retry header.
6. Parse `PAYMENT-RESPONSE` settlement metadata.

## 10. Persistence

SQLite tables:

1. `transactions`
   - `id`, `created_at`, `protocol`, `url`, `method`, `asset`, `amount`, `network`, `status`, `tx_hash`, `error`
2. `receipts`
   - `transaction_id`, `receipt_type`, `raw_json`, `header_value`
3. `plugin_runs`
   - `transaction_id`, `plugin_name`, `event_name`, `status`, `duration_ms`, `error`
4. `accounts`
   - `id`, `address`, `chain_id`, `source`, `created_at`

## 11. Error Model

Error categories:

1. `HTTP_ERROR`: non-payment transport failures.
2. `CHALLENGE_PARSE_ERROR`: malformed `402` payment challenge.
3. `PLUGIN_ABORT`: plugin blocked execution.
4. `PLUGIN_FAILURE`: plugin error/timeout in fail-closed stage.
5. `PRECONDITION_FAILED`: post-plugin balance/allowance checks fail.
6. `SIGNING_ERROR`: signer rejects or fails.
7. `SETTLEMENT_REJECTED`: server/facilitator rejects payment payload.

Output behavior:

1. Human output: concise reason and remediation hint.
2. JSON output: stable `code`, `message`, and `details`.

## 12. Security and Trust

1. Plugins are local and trusted by operator; no remote loading in MVP.
2. No secrets printed to logs.
3. Plugin timeout defaults to 10 seconds per plugin event.
4. `before*` plugin events fail-closed to avoid unsafe auto-sign.
5. `--no-plugins` available for operational recovery.

## 13. Testing Strategy

### 13.1 Unit Tests

1. Protocol detection and challenge parsing.
2. Plugin chain ordering and timeout behavior.
3. `beforeSign` abort and continue semantics.
4. Post-`beforeSign` precondition refresh logic.

### 13.2 Integration Tests

1. x402 paid request happy path with plugins.
2. MPP paid request happy path with plugins.
3. Plugin-induced abort path.
4. Simulated generic pre-sign plugin that updates allowance/balance before signing.

### 13.3 Contract Tests

1. Header generation conformance for MPP and x402 retry requests.
2. Receipt parsing conformance.

## 14. Implementation Plan

1. Implement core request + protocol detection.
2. Implement `beforeTransaction` and `afterTransaction` plugin runtime.
3. Add `beforeSign` event and wire into orchestration immediately pre-sign.
4. Add post-plugin precondition refresh and checks.
5. Add transaction and plugin run persistence.
6. Add sample plugin: `pre-sign-funds-check`.

## 15. Open Decisions

No open decisions currently.

---

This design keeps the app small while supporting advanced integration patterns through a precise, safe pre-sign plugin event.
