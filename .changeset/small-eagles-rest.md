---
"knox-wallet": patch
---

Add a persistent, plugin-scoped JSON key-value store to plugin hook events via `event.kv`.

Plugins can now write values during `setup` and read them later from `beforeTransaction`, `beforeSign`, `afterTransaction`, and `accountStatus`.
