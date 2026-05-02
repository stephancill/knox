---
"knox-wallet": minor
---

Detect x402 from response body for servers that return the payment challenge as JSON (`x402Version` + `accepts`) rather than a `PAYMENT-REQUIRED` header (e.g. Neynar). Only Base-chain v1 intents are supported.
