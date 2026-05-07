# knox-wallet

## 0.0.5

### Patch Changes

- 251d806: Flatten plugin hook context to expose a common top-level `userAddress` field on all hook payloads.

  Hook-specific data remains on each event, but shared account identity is no longer nested under `context` or `account` wrapper objects.

- 251d806: Add a persistent, plugin-scoped JSON key-value store to plugin hook events via `event.kv`.

  Plugins can now write values during `setup` and read them later from `beforeTransaction`, `beforeSign`, `afterTransaction`, and `accountStatus`.

## 0.0.4

### Patch Changes

- 5e52848: Remove the `--plugins-timeout-ms` global flag and stop timing out plugin hooks.

  Also update CLI docs and skill documentation to remove references to the removed flag.

## 0.0.3

### Patch Changes

- b177964: Pass active account context into plugin `setup` lifecycle calls.

  This adds `PluginSetupEvent` with the current account (or `null`) and wires it through `knox plugins setup <plugin-name>`, the plugin runner, and docs/examples.

## 0.0.2

### Patch Changes

- 2dbda31: Add the LICENSE file and set up Changesets-based manual release automation with GitHub Actions.
