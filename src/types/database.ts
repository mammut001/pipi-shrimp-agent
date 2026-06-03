export interface DbDiagnostics {
  path: string;
  initialized: boolean;
  schema_version: number;
  last_migration_at: number | null;
  integrity_check: string;
  file_size_bytes: number;
  wal_size_bytes: number;
  backup_count: number;
  sessions_count: number;
  messages_count: number;
  projects_count: number;
  token_usage_count: number;
  telegram_bindings_count: number;
  telegram_tasks_count: number;
}

export interface DbBackupEntry {
  name: string;
  path: string;
  created_at: number;
  schema_version: number;
  size_bytes: number;
}

/**
 * Row shape of the `token_usage` table — mirrors `DbTokenUsage` in
 * `src-tauri/src/database.rs`. Mirrors the 4-bucket Anthropic prompt-cache
 * breakdown that was added in DB schema v7 (see apply_migration in the
 * Rust file). All numeric columns are stored as i64 on disk and arrive
 * as `number` on the TS side after the bridge deserializes them.
 *
 * Cache fields default to 0 for pre-v7 rows and for non-Anthropic
 * providers that don't report prompt-cache usage.
 */
export interface DbTokenUsage {
  id: string;
  session_id: string | null;
  /** YYYY-MM-DD */
  date: string;
  input_tokens: number;
  output_tokens: number;
  /** v7: tokens served from Anthropic's prompt cache (~0.1x input price). */
  cache_read_input_tokens: number;
  /** v7: tokens written into Anthropic's prompt cache (~1.25x input price). */
  cache_creation_input_tokens: number;
  model: string;
  api_config_id: string | null;
  created_at: number;
}

/**
 * v7 schema migration: documents the two new token_usage columns that
 * this PR adds. Mirrors the `apply_migration` 7 => { ... } arm in
 * `src-tauri/src/database.rs`; keep them in sync.
 */
export const TOKEN_USAGE_V7_COLUMNS = [
  'cache_read_input_tokens INTEGER NOT NULL DEFAULT 0',
  'cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0',
] as const;
