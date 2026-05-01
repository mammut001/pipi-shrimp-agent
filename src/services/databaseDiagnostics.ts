import { safeInvoke } from '@/utils/safeInvoke';

export interface DbDiagnostics {
  path: string;
  initialized: boolean;
  schema_version: number;
  integrity_check: string;
  sessions_count: number;
  messages_count: number;
  projects_count: number;
  token_usage_count: number;
  telegram_bindings_count: number;
  telegram_tasks_count: number;
}

export function getDatabaseDiagnostics(): Promise<DbDiagnostics> {
  return safeInvoke<DbDiagnostics>('db_get_diagnostics', undefined, {
    source: 'databaseDiagnostics.getDatabaseDiagnostics',
  });
}
