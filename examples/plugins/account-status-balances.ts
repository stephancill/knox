import { http, createPublicClient, erc20Abi, formatUnits } from "viem";
import { base } from "viem/chains";

import type { AccountPlugin } from "../../src/plugins/types.ts";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TEMPO_TOKEN_ADDRESS = "0x20c000000000000000000000b9537d11c60e8b50" as const;

function resolveRpcUrls(): { baseRpcUrl: string; tempoRpcUrl?: string } {
  const baseRpcUrl = Bun.env.EVM_RPC_URL_8453 ?? Bun.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const tempoRpcUrl = Bun.env.EVM_RPC_URL_4217 ?? Bun.env.TEMPO_RPC_URL ?? "https://tempo-mainnet.drpc.org";
  return { baseRpcUrl, tempoRpcUrl };
}

async function readErc20Balance({
  rpcUrl,
  tokenAddress,
  accountAddress,
  chain,
}: {
  rpcUrl: string;
  tokenAddress: `0x${string}`;
  accountAddress: `0x${string}`;
  chain?: typeof base;
}): Promise<string> {
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const [rawBalance, decimals] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [accountAddress],
    }),
    client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  return formatUnits(rawBalance, decimals);
}

const plugin: AccountPlugin = {
  name: "account-status-balances",
  async setup({ userAddress }) {
    const { baseRpcUrl, tempoRpcUrl } = resolveRpcUrls();
    return {
      output: [
        "Balance plugin configured.",
        `Account: ${userAddress ?? "[none]"}`,
        `Base RPC: ${baseRpcUrl}`,
        `Tempo RPC: ${tempoRpcUrl}`,
      ].join("\n"),
    };
  },
  async accountStatus({ userAddress }) {
    const { baseRpcUrl, tempoRpcUrl } = resolveRpcUrls();

    let baseUsdc = "[unavailable]";
    let tempoToken = "[unavailable]";

    try {
      baseUsdc = await readErc20Balance({
        rpcUrl: baseRpcUrl,
        tokenAddress: BASE_USDC_ADDRESS,
        accountAddress: userAddress,
        chain: base,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      baseUsdc = `[unavailable] ${message}`;
    }

    if (tempoRpcUrl) {
      try {
        tempoToken = await readErc20Balance({
          rpcUrl: tempoRpcUrl,
          tokenAddress: TEMPO_TOKEN_ADDRESS,
          accountAddress: userAddress,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        tempoToken = `[unavailable] ${message}`;
      }
    } else {
      tempoToken = "[unavailable] tempo RPC is not configured";
    }

    return {
      output: [`Base USDC: ${baseUsdc}`, `Tempo: ${tempoToken}`].join("\n"),
    };
  },
};

export default plugin;
