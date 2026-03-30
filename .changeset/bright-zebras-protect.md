---
"knox-wallet": minor
---

Flatten plugin hook context to expose a common top-level `userAddress` field on all hook payloads.

Hook-specific data remains on each event, but shared account identity is no longer nested under `context` or `account` wrapper objects.
