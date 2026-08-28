import React from 'react';
import { t, getCurrentLocale } from '@/i18n';
import type { SshConfig } from '@/store/autoresearchStore';
import type { AutoResearchRunStatus } from '@/services/autoresearch/history';
import type { SetupPhaseLoopState } from '@/services/autoresearch/setupPhase';
import { AutoResearchSetupPhaseChip } from '../AutoResearchSetupPhaseChip';
import type { ManualSetupReadiness } from './manualReadiness';
import { getManualSetupNextAction } from './manualReadiness';

interface ManualCockpitPanelProps {
  setupForm: SshConfig;
  experimentDir: string;
  metric: string;
  direction: 'lower' | 'higher';
  baselineInput: string;
  maxIter: number;
  providerReady: boolean;
  connectionTestStatus: 'idle' | 'testing' | 'success' | 'error';
  isStarting: boolean;
  setupError: string | null;
  agentConfigError: string;
  readiness: ManualSetupReadiness;
  setActiveSection: (section: string | null) => void;
  onToggleSettings: () => void;
  handleTestConnection: () => void | Promise<void>;
  handleStart: () => void | Promise<void>;
  handleViewActiveRun: () => void;
  activeRunId: string | null;
  loopState?: SetupPhaseLoopState | null;
  activeRunStatus?: AutoResearchRunStatus | null;
}

export function ManualCockpitPanel({
  setupForm,
  experimentDir,
  metric,
  direction,
  baselineInput,
  maxIter,
  providerReady,
  connectionTestStatus,
  isStarting,
  setupError,
  agentConfigError,
  readiness,
  setActiveSection,
  onToggleSettings,
  handleTestConnection,
  handleStart,
  handleViewActiveRun,
  activeRunId,
  loopState = null,
  activeRunStatus = null,
}: ManualCockpitPanelProps) {
  const completedCount = readiness.completedCount;
  const nextAction = getManualSetupNextAction(readiness, connectionTestStatus);

  const requiredItems = [
    {
      id: 'provider',
      label: t('autoresearch.check.provider') || '模型配置',
      ready: providerReady,
      onClick: onToggleSettings,
    },
    {
      id: 'runtime',
      label: t('autoresearch.manual.runtimeTarget') || '运行目标',
      ready: readiness.sectionStatus.runtime,
      onClick: () => setActiveSection('runtime'),
    },
    {
      id: 'workspace',
      label: t('autoresearch.manual.workspace') || 'AutoResearch 工作区',
      ready: readiness.sectionStatus.workspace,
      onClick: () => setActiveSection('workspace'),
    },
    {
      id: 'targetProject',
      label: t('autoresearch.manual.targetProject') || '目标项目目录',
      ready: readiness.sectionStatus.targetProject,
      onClick: () => setActiveSection('workspace'),
    },
    {
      id: 'metric',
      label: t('autoresearch.manual.metricsAndIterations') || '指标与迭代',
      ready: readiness.sectionStatus.metric,
      onClick: () => setActiveSection('metric'),
    },
    {
      id: 'envCheck',
      label: t('autoresearch.manual.envCheck') || '运行环境检查',
      ready: readiness.sectionStatus.envCheck,
      onClick: () => setActiveSection('envCheck'),
    },
  ];

  const missingItems = requiredItems.filter((item) => !item.ready);

  let primaryActionLabel = '';
  let primaryActionHandler: () => void | Promise<void> = handleStart;
  let primaryActionDisabled = nextAction.disabled;

  if (nextAction.actionType === 'start') {
    primaryActionLabel = t('autoresearch.manual.start') || '开始 AutoResearch';
    primaryActionHandler = handleStart;
  } else if (nextAction.actionType === 'provider') {
    primaryActionLabel = t('autoresearch.manual.action.openProviderConfig') || '打开模型配置';
    primaryActionHandler = onToggleSettings;
  } else if (nextAction.actionType === 'runtime') {
    primaryActionLabel = t('autoresearch.manual.action.fillRuntime') || '先填写运行目标';
    primaryActionHandler = () => setActiveSection('runtime');
  } else if (nextAction.actionType === 'workspace') {
    primaryActionLabel = t('autoresearch.manual.action.fillWorkspace') || '先填写工作区';
    primaryActionHandler = () => setActiveSection('workspace');
  } else if (nextAction.actionType === 'targetProject') {
    primaryActionLabel = t('autoresearch.manual.action.fillTargetProject') || '先填写目标项目目录';
    primaryActionHandler = () => setActiveSection('workspace');
  } else if (nextAction.actionType === 'metric') {
    primaryActionLabel = t('autoresearch.manual.action.fillMetric') || '先填写主指标';
    primaryActionHandler = () => setActiveSection('metric');
  } else if (nextAction.actionType === 'envCheck') {
    if (connectionTestStatus === 'testing') {
      primaryActionLabel = t('autoresearch.connectionTesting') || '测试中...';
      primaryActionDisabled = true;
    } else if (connectionTestStatus === 'error') {
      primaryActionLabel = t('autoresearch.manual.action.envCheckFailed') || '环境检查失败，重新测试';
      primaryActionHandler = () => {
        setActiveSection('envCheck');
        void handleTestConnection();
      };
    } else {
      primaryActionLabel = t('autoresearch.manual.action.testEnv') || '先测试运行环境';
      primaryActionHandler = () => {
        setActiveSection('envCheck');
        void handleTestConnection();
      };
    }
  }

  if (isStarting) {
    primaryActionLabel = t('autoresearch.starting') || '正在启动...';
    primaryActionDisabled = true;
  }

  return (
    <div className="lg:sticky lg:top-6 space-y-4 h-fit font-sans">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm space-y-4 font-sans">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900 tracking-tight font-sans">启动面板 (Launch Cockpit)</h3>
          <AutoResearchSetupPhaseChip
            input={{
              bootstrapKind: 'manual',
              connectionStatus: connectionTestStatus,
              startingRun: isStarting,
              loopState,
              activeRunStatus,
              error: setupError,
            }}
          />
        </div>

        {/* Readiness progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between items-baseline text-xs text-slate-700 font-sans">
            <span className="text-slate-400">就绪进度</span>
            <span className="font-semibold text-sm">{completedCount} / 6</span>
          </div>
          <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${(completedCount / 6) * 100}%` }}
            />
          </div>
        </div>

        {/* Checklist of 6 required elements */}
        <div className="space-y-1.5">
          {requiredItems.map((item, idx) => {
            const isFailed = item.id === 'envCheck' && connectionTestStatus === 'error';
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className={`w-full flex items-center justify-between text-left p-2 rounded-xl border text-xs transition-all ${
                  isFailed
                    ? 'bg-rose-50/40 border-rose-200 text-rose-800 hover:bg-rose-50/70'
                    : !item.ready
                    ? 'bg-amber-50/30 border-amber-200/50 text-slate-700 hover:bg-amber-50/60'
                    : 'bg-emerald-50/20 border-emerald-100 text-slate-700 hover:bg-emerald-50/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold text-[9px] ${
                    isFailed
                      ? 'bg-rose-100 text-rose-700'
                      : item.ready
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {isFailed ? '!' : idx + 1}
                  </span>
                  <span>{item.label}</span>
                </div>
                <span className={isFailed ? 'text-rose-600 font-semibold' : item.ready ? 'text-emerald-600 font-semibold' : 'text-amber-600'}>
                  {isFailed ? (t('common.error') || '失败') : item.ready ? '✓' : '⋯'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Missing details list */}
        {missingItems.length > 0 && (
          <div className={`rounded-xl border p-3 space-y-1.5 text-xs font-sans ${
            connectionTestStatus === 'error'
              ? 'bg-rose-50/40 border-rose-200 text-rose-800'
              : 'bg-amber-50/30 border-amber-200/50 text-amber-800'
          }`}>
            {missingItems.length === 1 && missingItems[0].id === 'envCheck' ? (
              <div className={`font-semibold font-sans ${connectionTestStatus === 'error' ? 'text-rose-900' : 'text-amber-900'}`}>
                {connectionTestStatus === 'error'
                  ? (t('autoresearch.manual.action.envCheckFailed') || '运行环境检查失败。请修复上面的问题后重新测试。')
                  : t('autoresearch.manual.finalBlocker')}
              </div>
            ) : (
              <>
                <div className="font-semibold text-amber-900 font-sans">
                  {getCurrentLocale() === 'zh-CN' ? '需要完善的信息：' : 'Info to complete:'}
                </div>
                <ul className="list-disc list-inside space-y-1 text-[11px] font-sans">
                  {missingItems.map(item => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={item.onClick}
                        className="underline hover:text-amber-900 text-left font-sans"
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Setup Error or Agent Config Error Banners */}
        {(setupError || agentConfigError) && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 space-y-2 font-sans">
            <div>{setupError || agentConfigError}</div>
            {activeRunId && setupError && setupError !== agentConfigError && (
              <button
                type="button"
                className="w-full rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 font-sans"
                onClick={handleViewActiveRun}
              >
                {t('autoresearch.viewActiveRun')}
              </button>
            )}
          </div>
        )}

        {/* Primary Action Button */}
        <button
          type="button"
          onClick={primaryActionHandler}
          disabled={primaryActionDisabled}
          className="w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white shadow-md transition-colors hover:bg-neutral-800 disabled:opacity-50 font-sans"
        >
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}
