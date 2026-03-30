import type { AccountPlugin } from "../../src/plugins/types.ts";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function askConfirmation({
  intent,
}: {
  intent: {
    protocol: string;
    network: string;
    asset: string;
    amount: bigint;
    payTo: string;
  };
}): Promise<boolean> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
  });

  const prompt = [
    "Payment confirmation required.",
    `Protocol: ${intent.protocol}`,
    `Network: ${intent.network}`,
    `Asset: ${intent.asset}`,
    `Amount: ${intent.amount.toString()}`,
    `Pay To: ${intent.payTo}`,
    "Continue? [y/N] ",
  ].join("\n");

  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

const plugin: AccountPlugin = {
  name: "confirm-before-sign",
  async beforeSign({ intent }) {
    if (!stdin.isTTY || !stdout.isTTY) {
      return {
        action: "abort",
        reason: "Confirmation plugin requires an interactive terminal",
      };
    }

    const confirmed = await askConfirmation({ intent });
    if (!confirmed) {
      return {
        action: "abort",
        reason: "Payment cancelled by user",
      };
    }

    return { action: "continue" };
  },
};

export default plugin;
