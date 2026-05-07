import { z } from "zod";

import type { AccountPlugin, JsonValue } from "../../src/plugins/types.ts";

const CONFIG_KEY = "telegram-approval-config";
const OFFSET_KEY = "telegram-approval-offset";

const botApiEnvelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
});

const getMeResultSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  username: z.string().optional(),
});

const webhookInfoSchema = z.object({
  url: z.string(),
});

const sendMessageResultSchema = z.object({
  message_id: z.number(),
});

const updateSchema = z.object({
  update_id: z.number(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: z
        .object({
          message_id: z.number(),
          chat: z.object({
            id: z.union([z.string(), z.number()]),
          }),
        })
        .optional(),
    })
    .optional(),
});

const updatesSchema = z.array(updateSchema);

const storedConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().regex(/^-?\d+$/),
  tokenDecimals: z.number().int().min(0).max(18),
  thresholdMinor: z.string().regex(/^\d+$/),
  pollTimeoutMs: z.number().int().min(5000).max(600000),
});

type StoredConfig = z.infer<typeof storedConfigSchema>;

const setupInputSchema = z.object({
  botToken: z.string().min(1).describe("Telegram bot token"),
  chatId: z
    .string()
    .regex(/^-?\d+$/)
    .describe("Telegram numeric chat id"),
  thresholdUsd: z.string().default("0.50").describe("Approval threshold in USD-like units"),
  tokenDecimals: z.coerce.number().int().min(0).max(18).default(6).describe("Decimals for threshold/amount comparison"),
  timeoutSeconds: z.coerce.number().int().min(5).max(600).default(120).describe("Approval timeout in seconds"),
});

function parseDecimalUnits({ value, decimals }: { value: string; decimals: number }): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const [wholePart, fracPart = ""] = normalized.split(".");
  const paddedFraction = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(`${wholePart}${paddedFraction}`);
}

function formatUnits({ value, decimals }: { value: bigint; decimals: number }): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (decimals === 0) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionText.length === 0 ? whole.toString() : `${whole.toString()}.${fractionText}`;
}

async function callTelegramApi({
  token,
  method,
  payload,
}: {
  token: string;
  method: string;
  payload?: Record<string, unknown>;
}): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Telegram API request failed: ${response.status}`);
  }

  const body = botApiEnvelopeSchema.parse(await response.json());
  if (!body.ok) {
    throw new Error(body.description ?? `Telegram API ${method} failed`);
  }
  return body.result;
}

function parseStoredConfig({ value }: { value: JsonValue | undefined }): StoredConfig {
  if (value === undefined) {
    throw new Error("Plugin not configured. Run: knox plugins setup telegram-approval");
  }
  return storedConfigSchema.parse(value);
}

async function waitForDecision({
  config,
  messageId,
  approveData,
  denyData,
  offset,
}: {
  config: StoredConfig;
  messageId: number;
  approveData: string;
  denyData: string;
  offset: number;
}): Promise<{ approved: boolean; nextOffset: number }> {
  const deadline = Date.now() + config.pollTimeoutMs;
  let nextOffset = offset;

  while (Date.now() < deadline) {
    const rawUpdates = await callTelegramApi({
      token: config.botToken,
      method: "getUpdates",
      payload: {
        timeout: 15,
        offset: nextOffset,
        allowed_updates: ["callback_query"],
      },
    });
    const updates = updatesSchema.parse(rawUpdates);

    for (const update of updates) {
      nextOffset = Math.max(nextOffset, update.update_id + 1);
      const callback = update.callback_query;
      if (!callback || !callback.message) {
        continue;
      }
      const callbackChatId = String(callback.message.chat.id);
      if (callbackChatId !== config.chatId || callback.message.message_id !== messageId) {
        continue;
      }

      if (callback.data !== approveData && callback.data !== denyData) {
        continue;
      }

      await callTelegramApi({
        token: config.botToken,
        method: "answerCallbackQuery",
        payload: {
          callback_query_id: callback.id,
        },
      });

      await callTelegramApi({
        token: config.botToken,
        method: "editMessageReplyMarkup",
        payload: {
          chat_id: config.chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        },
      });

      return {
        approved: callback.data === approveData,
        nextOffset,
      };
    }
  }

  throw new Error("Timed out waiting for Telegram approval response");
}

const plugin: AccountPlugin = {
  name: "telegram-approval",
  async setup({ kv }) {
    const setupInput = setupInputSchema.parse({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      thresholdUsd: process.env.TELEGRAM_THRESHOLD_USD,
      tokenDecimals: process.env.TELEGRAM_TOKEN_DECIMALS,
      timeoutSeconds: process.env.TELEGRAM_TIMEOUT_SECONDS,
    });
    const { botToken, chatId, thresholdUsd, tokenDecimals, timeoutSeconds } = setupInput;

    const thresholdMinor = parseDecimalUnits({
      value: thresholdUsd,
      decimals: tokenDecimals,
    }).toString();

    const config = storedConfigSchema.parse({
      botToken,
      chatId,
      tokenDecimals,
      thresholdMinor,
      pollTimeoutMs: timeoutSeconds * 1000,
    });

    const me = getMeResultSchema.parse(
      await callTelegramApi({
        token: config.botToken,
        method: "getMe",
      }),
    );

    const webhookInfo = webhookInfoSchema.parse(
      await callTelegramApi({
        token: config.botToken,
        method: "getWebhookInfo",
      }),
    );
    if (webhookInfo.url.length > 0) {
      throw new Error("Bot has an active webhook; disable it to use getUpdates polling");
    }

    await callTelegramApi({
      token: config.botToken,
      method: "sendMessage",
      payload: {
        chat_id: config.chatId,
        text: "Knox telegram-approval plugin setup complete.",
      },
    });

    await kv.set({ key: CONFIG_KEY, value: config });
    await kv.set({ key: OFFSET_KEY, value: 0 });

    return {
      output: [
        `Configured with bot @${me.username ?? "unknown"}.`,
        `Chat: ${config.chatId}`,
        `Threshold: ${thresholdUsd} (token decimals: ${tokenDecimals})`,
      ].join("\n"),
    };
  },
  async beforeTransaction({ intent, kv }) {
    const config = parseStoredConfig({ value: await kv.get({ key: CONFIG_KEY }) });
    const thresholdMinor = BigInt(config.thresholdMinor);
    if (intent.amount <= thresholdMinor) {
      return { action: "continue" };
    }

    const requestId = crypto.randomUUID().slice(0, 8);
    const approveData = `knox:ok:${requestId}`;
    const denyData = `knox:no:${requestId}`;

    const sentMessage = sendMessageResultSchema.parse(
      await callTelegramApi({
        token: config.botToken,
        method: "sendMessage",
        payload: {
          chat_id: config.chatId,
          text: [
            "Knox payment approval requested",
            `Amount: ${formatUnits({ value: intent.amount, decimals: config.tokenDecimals })}`,
            `Threshold: ${formatUnits({ value: thresholdMinor, decimals: config.tokenDecimals })}`,
            `Asset: ${intent.asset}`,
            `Network: ${intent.network}`,
            `Pay to: ${intent.payTo}`,
            `Request URL: ${intent.requestUrl}`,
          ].join("\n"),
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Approve", callback_data: approveData },
                { text: "Deny", callback_data: denyData },
              ],
            ],
          },
        },
      }),
    );

    const storedOffset = z
      .number()
      .int()
      .min(0)
      .catch(0)
      .parse(await kv.get({ key: OFFSET_KEY }));

    const decision = await waitForDecision({
      config,
      messageId: sentMessage.message_id,
      approveData,
      denyData,
      offset: storedOffset,
    });

    await kv.set({ key: OFFSET_KEY, value: decision.nextOffset });

    if (!decision.approved) {
      return {
        action: "abort",
        reason: "Payment denied in Telegram",
      };
    }

    return { action: "continue" };
  },
};

export default plugin;
