import { useEffect, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { t } from '@/i18n';
import type { DbBackupEntry, DbDiagnostics } from '@/types/database';
import { safeInvoke } from '@/utils/safeInvoke';
import { isTauri } from '@/utils/isTauri';

type NotificationLevel = 'success' | 'error' | 'info' | 'warning';

interface DatabaseHealthSectionProps {
  addNotification: (level: NotificationLevel, message: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, unitIndex);
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return t('diagnostics.notAvailable');
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000));
}

function defaultExportName(backup?: DbBackupEntry): string {
  if (backup) {
    return backup.name;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `db-export-${stamp}.sqlite`;
}

export function DatabaseHealthSection({ addNotification }: DatabaseHealthSectionProps) {
  const [diagnostics, setDiagnostics] = useState<DbDiagnostics | null>(null);
  const [backups, setBackups] = useState<DbBackupEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isOpeningDirectory, setIsOpeningDirectory] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showBackupList, setShowBackupList] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<DbBackupEntry | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');

  const loadDatabaseHealth = async () => {
    setIsLoading(true);

    if (!isTauri()) {
      setErrorMessage(t('diagnostics.notAvailableInBrowser'));
      setIsLoading(false);
      return;
    }

    try {
      const [nextDiagnostics, nextBackups] = await Promise.all([
        safeInvoke<DbDiagnostics>('db_get_diagnostics'),
        safeInvoke<DbBackupEntry[]>('list_backups'),
      ]);
      setDiagnostics(nextDiagnostics);
      setBackups(nextBackups);
      setErrorMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      addNotification('error', t('diagnostics.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDatabaseHealth();
  }, []);

  const handleExport = async (backup?: DbBackupEntry) => {
    const destinationPath = await save({
      defaultPath: defaultExportName(backup),
      filters: [{ name: 'SQLite', extensions: ['sqlite'] }],
    });

    if (!destinationPath) {
      return;
    }

    setIsExporting(true);
    try {
      await safeInvoke<string>('export_database_backup', {
        path: destinationPath,
        backupPath: backup?.path ?? null,
      });
      addNotification('success', t('diagnostics.exportSuccess'));
    } catch {
      addNotification('error', t('diagnostics.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenDataDirectory = async () => {
    setIsOpeningDirectory(true);
    try {
      await safeInvoke<string>('open_data_directory');
      addNotification('info', t('diagnostics.openDirectorySuccess'));
    } catch {
      addNotification('error', t('diagnostics.openDirectoryFailed'));
    } finally {
      setIsOpeningDirectory(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup || restoreConfirmText !== 'CONFIRM') {
      return;
    }

    setIsRestoring(true);
    try {
      await safeInvoke('restore_from_backup', { backupPath: selectedBackup.path });
      addNotification('success', t('diagnostics.restoreSuccess'));
      setTimeout(() => {
        window.location.reload();
      }, 150);
    } catch {
      addNotification('error', t('diagnostics.restoreFailed'));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t('diagnostics.dbHealth')}</h2>
            <p className="text-xs text-gray-500 mt-1">{t('diagnostics.dbHealthDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void loadDatabaseHealth()}
            className="text-xs px-2.5 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
          >
            {t('diagnostics.refresh')}
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <div className="font-medium">{t('common.error')}</div>
            <div className="mt-1 break-all">{errorMessage}</div>
          </div>
        )}

        {isLoading || !diagnostics ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 text-center">
            {t('common.loading')}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-gray-500">{t('diagnostics.schemaVersion')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">v{diagnostics.schema_version}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-gray-500">{t('diagnostics.fileSize')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{formatBytes(diagnostics.file_size_bytes)}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-gray-500">{t('diagnostics.walSize')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{formatBytes(diagnostics.wal_size_bytes)}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-gray-500">{t('diagnostics.lastMigration')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{formatTimestamp(diagnostics.last_migration_at)}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-gray-500">{t('diagnostics.integrityCheck')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900 break-all">{diagnostics.integrity_check}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <div className="text-gray-500">{t('diagnostics.backupCount')}</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{diagnostics.backup_count}</div>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600 break-all">
              <span className="font-medium text-gray-700">{t('diagnostics.path')}:</span> {diagnostics.path}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={isExporting}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {t('diagnostics.exportBackup')}
              </button>
              <button
                type="button"
                onClick={() => void handleOpenDataDirectory()}
                disabled={isOpeningDirectory}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('diagnostics.openDataDirectory')}
              </button>
              <button
                type="button"
                onClick={() => setShowBackupList(true)}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                {t('diagnostics.backupList')}
              </button>
            </div>
          </>
        )}
      </div>

      {showBackupList && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowBackupList(false)} />
          <div className="relative w-full max-w-3xl rounded-xl bg-white shadow-xl border border-gray-200 max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{t('diagnostics.backupList')}</h3>
                <p className="text-xs text-gray-500 mt-1">{t('diagnostics.restoreConfirmDescription')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowBackupList(false)}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                {t('common.close')}
              </button>
            </div>

            <div className="overflow-auto max-h-[60vh]">
              {backups.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-500 text-center">{t('diagnostics.noBackups')}</div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50 text-left text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t('common.name')}</th>
                      <th className="px-4 py-3 font-medium">{t('diagnostics.createdAt')}</th>
                      <th className="px-4 py-3 font-medium">{t('diagnostics.schemaVersion')}</th>
                      <th className="px-4 py-3 font-medium">{t('diagnostics.size')}</th>
                      <th className="px-4 py-3 font-medium">{t('diagnostics.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {backups.map((backup) => (
                      <tr key={backup.path}>
                        <td className="px-4 py-3 align-top text-gray-700 break-all">{backup.name}</td>
                        <td className="px-4 py-3 align-top text-gray-600">{formatTimestamp(backup.created_at)}</td>
                        <td className="px-4 py-3 align-top text-gray-600">v{backup.schema_version}</td>
                        <td className="px-4 py-3 align-top text-gray-600">{formatBytes(backup.size_bytes)}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleExport(backup)}
                              className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                            >
                              {t('common.export')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBackup(backup);
                                setRestoreConfirmText('');
                              }}
                              className="px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                            >
                              {t('diagnostics.restoreBackup')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedBackup && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedBackup(null)} />
          <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900">{t('diagnostics.restoreConfirm')}</h3>
            <p className="mt-2 text-sm text-gray-600">{t('diagnostics.restoreConfirmDescription')}</p>
            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 break-all">
              {selectedBackup.name}
            </div>
            <input
              type="text"
              value={restoreConfirmText}
              onChange={(event) => setRestoreConfirmText(event.target.value)}
              placeholder={t('diagnostics.restorePlaceholder')}
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedBackup(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={restoreConfirmText !== 'CONFIRM' || isRestoring}
                className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}