# knox-wallet

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
