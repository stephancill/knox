---
"knox-wallet": patch
---

Pass active account context into plugin `setup` lifecycle calls.

This adds `PluginSetupEvent` with the current account (or `null`) and wires it through `knox plugins setup <plugin-name>`, the plugin runner, and docs/examples.
