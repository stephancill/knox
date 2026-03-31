import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function knoxHomeDir(): string {
  return join(homedir(), ".knox");
}

function ensureDir(): string {
  const dir = knoxHomeDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): Database {
  const dir = ensureDir();
  const db = new Database(join(dir, "knox.db"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      private_key TEXT NOT NULL,
      chain_id INTEGER,
      source TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      protocol TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL,
      asset TEXT,
      amount TEXT,
      network TEXT,
      status TEXT NOT NULL,
      tx_hash TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS plugin_runs (
      id TEXT PRIMARY KEY,
      transaction_id TEXT,
      plugin_name TEXT NOT NULL,
      event_name TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugin_kv (
      plugin_name TEXT NOT NULL,
      kv_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plugin_name, kv_key)
    );
  `);

  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId({ prefix }: { prefix: string }): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
