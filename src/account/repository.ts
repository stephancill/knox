import { getAddress } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { getDb, nowIso, randomId } from "../store/db.ts";

export type StoredAccount = {
  id: string;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  chainId?: number;
  source: string;
  createdAt: string;
};

const SINGLE_ACCOUNT_ID = "default";

function mapRow({ row }: { row: Record<string, unknown> }): StoredAccount {
  return {
    id: String(row.id),
    address: getAddress(String(row.address)),
    privateKey: String(row.private_key) as `0x${string}`,
    chainId: row.chain_id == null ? undefined : Number(row.chain_id),
    source: String(row.source),
    createdAt: String(row.created_at),
  };
}

export function createAccount(): StoredAccount {
  const privateKey = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as `0x${string}`;
  return importAccount({ privateKey, source: "created" });
}

export function importAccount({
  privateKey,
  source = "imported",
}: {
  privateKey: string;
  source?: string;
}): StoredAccount {
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  let account: PrivateKeyAccount;
  try {
    account = privateKeyToAccount(normalized as `0x${string}`);
  } catch {
    throw new Error("Invalid private key format");
  }

  const db = getDb();
  const id = SINGLE_ACCOUNT_ID;
  const createdAt = nowIso();

  db.exec("DELETE FROM accounts");

  const stmt = db.query(
    "INSERT INTO accounts (id, address, private_key, chain_id, source, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  stmt.run(id, account.address, normalized, null, source, 1, createdAt);

  return {
    id,
    address: account.address,
    privateKey: normalized as `0x${string}`,
    chainId: undefined,
    source,
    createdAt,
  };
}

export function getActiveAccount(): StoredAccount | null {
  const db = getDb();
  const row = db
    .query("SELECT id, address, private_key, chain_id, source, created_at FROM accounts ORDER BY created_at DESC LIMIT 1")
    .get() as Record<string, unknown> | null;

  if (!row) {
    return null;
  }
  return mapRow({ row });
}
