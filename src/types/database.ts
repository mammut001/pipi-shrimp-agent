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