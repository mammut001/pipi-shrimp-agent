import { useMemo, useState } from 'react';

import { MainLayout } from '@/layout';
import { t } from '@/i18n';
import {
  useTaskRegistryStore,
  type DiagnosticsTaskKind,
  type DiagnosticsTaskState,
} from '@/store/taskRegistryStore';

const TASK_KIND_OPTIONS: Array<'all' | DiagnosticsTaskKind> = ['all', 'chat', 'workflow', 'swarm', 'telegram', 'browser'];
const TASK_STATE_OPTIONS: Array<'all' | DiagnosticsTaskState> = ['all', 'created', 'running', 'completed', 'failed', 'cancelled'];

function formatTaskKind(kind: DiagnosticsTaskKind): string {
  return t(`diagnostics.taskKind.${kind}` as const);
}

function formatTaskState(state: DiagnosticsTaskState): string {
  return t(`diagnostics.taskState.${state}` as const);
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function Diagnostics() {
  const tasks = useTaskRegistryStore((state) => state.tasks);
  const cancelTask = useTaskRegistryStore((state) => state.cancelTask);
  const [kindFilter, setKindFilter] = useState<'all' | DiagnosticsTaskKind>('all');
  const [stateFilter, setStateFilter] = useState<'all' | DiagnosticsTaskState>('all');
  const [cancelingTaskId, setCancelingTaskId] = useState<string | null>(null);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    const matchesKind = kindFilter === 'all' || task.kind === kindFilter;
    const matchesState = stateFilter === 'all' || task.state === stateFilter;
    return matchesKind && matchesState;
  }), [kindFilter, stateFilter, tasks]);

  const handleCancelTask = async (taskId: string) => {
    setCancelingTaskId(taskId);
    try {
      await cancelTask(taskId);
    } finally {
      setCancelingTaskId(null);
    }
  };

  return (
    <MainLayout>
      <div className="flex h-full flex-col overflow-hidden bg-white text-gray-900">
        <div className="border-b border-gray-200 px-8 py-6">
          <div className="max-w-6xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
              {t('diagnostics.sectionLabel')}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
              {t('diagnostics.title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
              {t('diagnostics.description')}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-8">
          <section
            aria-label={t('diagnostics.tasksPanelTitle')}
            className="mx-auto max-w-6xl rounded-2xl border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-100 px-6 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {t('diagnostics.tasksPanelTitle')}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {t('diagnostics.tasksPanelDescription')}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="flex min-w-[180px] flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                    {t('diagnostics.kindFilter')}
                    <select
                      value={kindFilter}
                      onChange={(event) => setKindFilter(event.target.value as 'all' | DiagnosticsTaskKind)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium capitalize tracking-normal text-gray-900 outline-none transition focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
                    >
                      {TASK_KIND_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'all' ? t('common.all') : formatTaskKind(option)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-[180px] flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                    {t('diagnostics.stateFilter')}
                    <select
                      value={stateFilter}
                      onChange={(event) => setStateFilter(event.target.value as 'all' | DiagnosticsTaskState)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium capitalize tracking-normal text-gray-900 outline-none transition focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
                    >
                      {TASK_STATE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'all' ? t('common.all') : formatTaskState(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            {filteredTasks.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-gray-500">
                {t('diagnostics.noTasks')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-left">
                  <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    <tr>
                      <th className="px-6 py-4">{t('diagnostics.table.id')}</th>
                      <th className="px-6 py-4">{t('diagnostics.table.kind')}</th>
                      <th className="px-6 py-4">{t('diagnostics.table.state')}</th>
                      <th className="px-6 py-4">{t('diagnostics.table.source')}</th>
                      <th className="px-6 py-4">{t('diagnostics.table.created')}</th>
                      <th className="px-6 py-4">{t('diagnostics.table.updated')}</th>
                      <th className="px-6 py-4">{t('diagnostics.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white text-sm text-gray-900">
                    {filteredTasks.map((task) => {
                      const cancelDisabled = !task.cancelable || cancelingTaskId === task.id;
                      return (
                        <tr key={task.id} className="align-top transition-colors hover:bg-gray-50">
                          <td className="px-6 py-4 font-mono text-xs text-gray-500">{task.id}</td>
                          <td className="px-6 py-4 text-gray-900">{formatTaskKind(task.kind)}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-gray-700">
                              {formatTaskState(task.state)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-gray-600">{task.source}</td>
                          <td className="px-6 py-4 text-gray-600">{formatTimestamp(task.createdAt)}</td>
                          <td className="px-6 py-4 text-gray-600">{formatTimestamp(task.updatedAt)}</td>
                          <td className="px-6 py-4">
                            {task.cancelable ? (
                              <button
                                type="button"
                                onClick={() => void handleCancelTask(task.id)}
                                disabled={cancelDisabled}
                                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {cancelingTaskId === task.id ? t('common.loading') : t('diagnostics.cancelTask')}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">{t('diagnostics.noAction')}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </MainLayout>
  );
}

export default Diagnostics;
