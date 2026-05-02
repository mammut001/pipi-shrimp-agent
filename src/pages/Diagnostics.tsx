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
      <div className="flex h-full flex-col overflow-hidden bg-[#f7f6f3]">
        <div className="border-b border-[#e7e2d8] bg-[#fcfbf7] px-8 py-6">
          <div className="max-w-6xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9a7b57]">
              {t('diagnostics.sectionLabel')}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#2f251a]">
              {t('diagnostics.title')}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6e655c]">
              {t('diagnostics.description')}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-8">
          <section
            aria-label={t('diagnostics.tasksPanelTitle')}
            className="mx-auto max-w-6xl rounded-[28px] border border-[#e7dece] bg-white shadow-[0_18px_40px_rgba(47,37,26,0.08)]"
          >
            <div className="border-b border-[#efe7d9] px-6 py-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-[#2f251a]">
                    {t('diagnostics.tasksPanelTitle')}
                  </h2>
                  <p className="mt-1 text-sm text-[#71685f]">
                    {t('diagnostics.tasksPanelDescription')}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="flex min-w-[180px] flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8d7352]">
                    {t('diagnostics.kindFilter')}
                    <select
                      value={kindFilter}
                      onChange={(event) => setKindFilter(event.target.value as 'all' | DiagnosticsTaskKind)}
                      className="rounded-xl border border-[#ddd4c4] bg-[#fcfaf6] px-3 py-2 text-sm font-medium capitalize tracking-normal text-[#2f251a] outline-none transition focus:border-[#c69b61]"
                    >
                      {TASK_KIND_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option === 'all' ? t('common.all') : formatTaskKind(option)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-[180px] flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8d7352]">
                    {t('diagnostics.stateFilter')}
                    <select
                      value={stateFilter}
                      onChange={(event) => setStateFilter(event.target.value as 'all' | DiagnosticsTaskState)}
                      className="rounded-xl border border-[#ddd4c4] bg-[#fcfaf6] px-3 py-2 text-sm font-medium capitalize tracking-normal text-[#2f251a] outline-none transition focus:border-[#c69b61]"
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
              <div className="px-6 py-16 text-center text-sm text-[#7a7066]">
                {t('diagnostics.noTasks')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#efe7d9] text-left">
                  <thead className="bg-[#faf6ef] text-xs font-semibold uppercase tracking-[0.18em] text-[#8d7352]">
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
                  <tbody className="divide-y divide-[#f1ebe0] bg-white text-sm text-[#2f251a]">
                    {filteredTasks.map((task) => {
                      const cancelDisabled = !task.cancelable || cancelingTaskId === task.id;
                      return (
                        <tr key={task.id} className="align-top">
                          <td className="px-6 py-4 font-mono text-xs text-[#5f5346]">{task.id}</td>
                          <td className="px-6 py-4">{formatTaskKind(task.kind)}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex rounded-full bg-[#f6efe4] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#8a6c49]">
                              {formatTaskState(task.state)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-[#685d51]">{task.source}</td>
                          <td className="px-6 py-4 text-[#685d51]">{formatTimestamp(task.createdAt)}</td>
                          <td className="px-6 py-4 text-[#685d51]">{formatTimestamp(task.updatedAt)}</td>
                          <td className="px-6 py-4">
                            {task.cancelable ? (
                              <button
                                type="button"
                                onClick={() => void handleCancelTask(task.id)}
                                disabled={cancelDisabled}
                                className="rounded-lg border border-[#d7c8b5] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[#6b4020] transition hover:border-[#bb8a58] hover:bg-[#fcf2e7] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {cancelingTaskId === task.id ? t('common.loading') : t('diagnostics.cancelTask')}
                              </button>
                            ) : (
                              <span className="text-xs text-[#9f9387]">{t('diagnostics.noAction')}</span>
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
