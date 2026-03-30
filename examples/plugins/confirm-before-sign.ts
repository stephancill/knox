import type { AccountPlugin } from "../../src/plugins/types.ts";

const plugin: AccountPlugin = {
  name: "confirm-before-sign",
  async beforeSign({ intent }) {
    if (intent.amount > 5_000_000n) {
      return {
        action: "abort",
        reason: `Blocked by plugin: amount ${intent.amount} exceeds threshold`,
      };
    }
    return { action: "continue" };
  },
};

export default plugin;
