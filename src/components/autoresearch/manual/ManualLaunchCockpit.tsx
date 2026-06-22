import React, { useState } from 'react';
import { t, getCurrentLocale } from '@/i18n';
import type { SshConfig, AutoResearchRunRecord } from '@/store/autoresearchStore';
import { AutoResearchActiveRunBanner } from '../AutoResearchSetupHelpers';
import { ManualSectionCard } from './ManualSectionCard';
import { RuntimeTargetSection } from './sections/RuntimeTargetSection';
import { WorkspaceTargetSection } from './sections/WorkspaceTargetSection';
import { MetricIterationsSection } from './sections/MetricIterationsSection';
import { EnvironmentCheckSection } from './sections/EnvironmentCheckSection';
import { LaunchConfirmSection } from './sections/LaunchConfirmSection';
import { AdvancedFieldsSection } from './sections/AdvancedFieldsSection';
import { ManualCockpitPanel } from './ManualCockpitPanel';
import {
  formatRuntimeTargetSummary,
  formatMetricIterationsSummary,
} from './manualFormatting';
import type { ManualSetupReadiness } from './manualReadiness';

interface ConnectionTestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  output: string;
}

interface ManualLaunchCockpitProps {
  setupForm: SshConfig;
  setSetupForm: React.Dispatch<React.SetStateAction<SshConfig>>;
  maxIter: number;
  setMaxIter: (val: number) => void;
  metric: string;
  setMetric: (val: string) => void;
  direction: 'lower' | 'higher';
  setDirection: (val: 'lower' | 'higher') => void;
  experimentDir: string;
  setExperimentDir: (val: string) => void;
  baselineInput: string;
  setBaselineInput: (val: string) => void;
  baselineInvalid: boolean;
  prefillSource: string;
  windowsShellProfile?: string;
  connectionTest: ConnectionTestState;
  setupError: string | null;
  isStarting: boolean;
  activeRun: AutoResearchRunRecord | null;
  providerReady: boolean;
  agentConfigError: string;
  readiness: ManualSetupReadiness;

  handleResetToDefaults: () => void;
  handlePickLocalWorkDir: () => void | Promise<void>;
  handlePickExperimentDir: () => void | Promise<void>;
  handleTestConnection: () => void | Promise<void>;
  handleSetupSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  handleStart: () => void | Promise<void>;
  handleViewActiveRun: () => void;
  setShowRunList: (val: boolean) => void;
  onToggleSettings: () => void;
}

function getPathBasename(path: string): string {
  if (!path) return '';
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function ManualLaunchCockpit({
  setupForm,
  setSetupForm,
  maxIter,
  setMaxIter,
  metric,
  setMetric,
  direction,
  setDirection,
  experimentDir,
  setExperimentDir,
  baselineInput,
  setBaselineInput,
  baselineInvalid,
  prefillSource,
  windowsShellProfile,
  connectionTest,
  setupError,
  isStarting,
  activeRun,
  providerReady,
  agentConfigError,
  readiness,
  handleResetToDefaults,
  handlePickLocalWorkDir,
  handlePickExperimentDir,
  handleTestConnection,
  handleSetupSubmit,
  handleStart,
  handleViewActiveRun,
  setShowRunList,
  onToggleSettings,
}: ManualLaunchCockpitProps) {
  const [activeSection, setActiveSection] = useState<string | null>('runtime');
  const locale = getCurrentLocale();

  const getEnvCheckStatusLabel = () => {
    if (connectionTest.status === 'success') {
      return t('autoresearch.manual.passed') || '已通过';
    }
    if (connectionTest.status === 'testing') {
      return t('autoresearch.connectionTesting') || '测试中';
    }
    if (connectionTest.status === 'error') {
      return t('autoresearch.manual.failed') || '失败';
    }
    return t('autoresearch.manual.notTested') || '未测试';
  };

  const getEnvCheckCollapsedSummary = () => {
    if (connectionTest.status === 'success') {
      return '运行环境测试通过';
    }
    if (connectionTest.status === 'testing') {
      return '正在测试运行环境...';
    }
    if (connectionTest.status === 'error') {
      return '运行环境测试失败';
    }
    return '尚未测试运行环境';
  };

  const testConnectionDisabled =
    setupForm.mode === 'ssh'
      ? !setupForm.host ||
        !setupForm.user ||
        (setupForm.authMode === 'password' && !setupForm.password) ||
        (setupForm.authMode === 'key' && !setupForm.keyPath) ||
        !setupForm.remoteWorkDir ||
        !experimentDir ||
        Boolean(agentConfigError) ||
        baselineInvalid
      : !setupForm.remoteWorkDir || !experimentDir || Boolean(agentConfigError) || baselineInvalid;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50/50">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto max-w-[1200px] w-full flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">AutoResearch</p>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">
              {t('autoresearch.manual.title') || '手动配置 Launch'}
            </h2>
            <p className="text-sm text-gray-500 font-sans">
              {t('autoresearch.setupDescription') || '使用精确路径、目标、指标和运行限制启动实验循环。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
              onClick={handleResetToDefaults}
            >
              {t('autoresearch.resetToDefaults') || '重置默认值'}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable body content */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8 min-h-0">
        <div className="mx-auto max-w-[1200px] w-full space-y-6">
          {activeRun && (
            <AutoResearchActiveRunBanner
              run={activeRun}
              onView={handleViewActiveRun}
              onBrowseHistory={() => setShowRunList(true)}
            />
          )}

          {/* 2-Column Cockpit Layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Left Column: Sections */}
            <form onSubmit={handleSetupSubmit} className="space-y-4 lg:col-span-2">
              {/* SECTION 1: Runtime Target */}
              <ManualSectionCard
                id="runtime"
                number={1}
                emoji="💻"
                title={t('autoresearch.manual.runtimeTarget') || '运行目标'}
                status={readiness.sectionStatus.runtime ? 'completed' : 'missing'}
                statusLabel={
                  readiness.sectionStatus.runtime
                    ? t('autoresearch.recipe.completed') || '已完成'
                    : t('autoresearch.recipe.missing') || '缺失'
                }
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                collapsedSummary={formatRuntimeTargetSummary(setupForm, locale)}
              >
                <RuntimeTargetSection setupForm={setupForm} setSetupForm={setSetupForm} />
              </ManualSectionCard>

              {/* SECTION 2: Workspace & Target */}
              <ManualSectionCard
                id="workspace"
                number={2}
                emoji="📁"
                title="工作区与目标项目"
                status={
                  readiness.sectionStatus.workspace && readiness.sectionStatus.targetProject
                    ? 'completed'
                    : 'missing'
                }
                statusLabel={
                  readiness.sectionStatus.workspace && readiness.sectionStatus.targetProject
                    ? t('autoresearch.recipe.completed') || '已完成'
                    : t('autoresearch.recipe.missing') || '缺失'
                }
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                collapsedSummary={
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1.5 font-sans">
                      <span className="text-gray-400 font-medium">
                        {locale === 'zh-CN' ? '工作区：' : 'Workspace: '}
                      </span>
                      {setupForm.remoteWorkDir ? (
                        <span
                          title={setupForm.remoteWorkDir}
                          aria-label={setupForm.remoteWorkDir}
                          className="inline-flex items-center gap-1 bg-neutral-100 hover:bg-neutral-200 px-2 py-0.5 rounded-md font-medium text-neutral-800 transition-colors"
                        >
                          <span>{getPathBasename(setupForm.remoteWorkDir)}</span>
                          <button
                            type="button"
                            className="text-[10px] text-gray-400 hover:text-gray-700 ml-1 transition-colors"
                            title={locale === 'zh-CN' ? '复制完整路径' : 'Copy full path'}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(setupForm.remoteWorkDir);
                            }}
                          >
                            📋
                          </button>
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">
                          {locale === 'zh-CN' ? '未选择工作区' : 'not selected'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 font-sans">
                      <span className="text-gray-400 font-medium">
                        {locale === 'zh-CN' ? '目标项目：' : 'Target Project: '}
                      </span>
                      {experimentDir ? (
                        <span
                          title={experimentDir}
                          aria-label={experimentDir}
                          className="inline-flex items-center gap-1 bg-neutral-100 hover:bg-neutral-200 px-2 py-0.5 rounded-md font-medium text-neutral-800 transition-colors"
                        >
                          <span>{getPathBasename(experimentDir)}</span>
                          <button
                            type="button"
                            className="text-[10px] text-gray-400 hover:text-gray-700 ml-1 transition-colors"
                            title={locale === 'zh-CN' ? '复制完整路径' : 'Copy full path'}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(experimentDir);
                            }}
                          >
                            📋
                          </button>
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">
                          {locale === 'zh-CN' ? '未选择项目' : 'not selected'}
                        </span>
                      )}
                    </div>
                  </div>
                }
              >
                <WorkspaceTargetSection
                  setupForm={setupForm}
                  setSetupForm={setSetupForm}
                  experimentDir={experimentDir}
                  setExperimentDir={setExperimentDir}
                  handlePickLocalWorkDir={handlePickLocalWorkDir}
                  handlePickExperimentDir={handlePickExperimentDir}
                />
              </ManualSectionCard>

              {/* SECTION 3: Metric & Iterations */}
              <ManualSectionCard
                id="metric"
                number={3}
                emoji="📈"
                title={t('autoresearch.manual.metricsAndIterations') || '指标与迭代'}
                status={readiness.sectionStatus.metric ? 'completed' : 'missing'}
                statusLabel={
                  readiness.sectionStatus.metric
                    ? t('autoresearch.recipe.completed') || '已完成'
                    : t('autoresearch.recipe.missing') || '缺失'
                }
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                collapsedSummary={formatMetricIterationsSummary(
                  { metric, direction, baselineInput, maxIter },
                  locale,
                )}
              >
                <MetricIterationsSection
                  metric={metric}
                  setMetric={setMetric}
                  direction={direction}
                  setDirection={setDirection}
                  baselineInput={baselineInput}
                  setBaselineInput={setBaselineInput}
                  baselineInvalid={baselineInvalid}
                  maxIter={maxIter}
                  setMaxIter={setMaxIter}
                />
              </ManualSectionCard>

              {/* SECTION 4: Environment Check */}
              <ManualSectionCard
                id="envCheck"
                number={4}
                emoji="⚡"
                title={t('autoresearch.manual.envCheck') || '运行环境检查'}
                status={
                  connectionTest.status === 'success'
                    ? 'completed'
                    : connectionTest.status === 'error'
                    ? 'failed'
                    : connectionTest.status === 'testing'
                    ? 'testing'
                    : 'notTested'
                }
                statusLabel={getEnvCheckStatusLabel()}
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                collapsedSummary={getEnvCheckCollapsedSummary()}
              >
                <EnvironmentCheckSection
                  connectionTest={connectionTest}
                  testConnectionDisabled={testConnectionDisabled}
                  isStarting={isStarting}
                  handleTestConnection={handleTestConnection}
                />
              </ManualSectionCard>

              {/* SECTION 5: Launch Summary */}
              <ManualSectionCard
                id="summary"
                number={5}
                emoji="🚀"
                title={t('autoresearch.manual.launchConfirm') || '启动确认'}
                status="completed"
                statusLabel=""
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                collapsedSummary="查看配置总览确认无误后即可启动"
              >
                <LaunchConfirmSection
                  setupForm={setupForm}
                  experimentDir={experimentDir}
                  metric={metric}
                  direction={direction}
                  baselineInput={baselineInput}
                  maxIter={maxIter}
                  providerReady={providerReady}
                  connectionTestStatus={connectionTest.status}
                />
              </ManualSectionCard>

              <AdvancedFieldsSection
                setupForm={setupForm}
                experimentDir={experimentDir}
                prefillSource={prefillSource}
                windowsShellProfile={windowsShellProfile}
                handleResetToDefaults={handleResetToDefaults}
              />
            </form>

            {/* Right Column: Sticky Launch Cockpit */}
            <ManualCockpitPanel
              setupForm={setupForm}
              experimentDir={experimentDir}
              metric={metric}
              direction={direction}
              baselineInput={baselineInput}
              maxIter={maxIter}
              providerReady={providerReady}
              connectionTestStatus={connectionTest.status}
              isStarting={isStarting}
              setupError={setupError}
              agentConfigError={agentConfigError}
              readiness={readiness}
              setActiveSection={setActiveSection}
              onToggleSettings={onToggleSettings}
              handleTestConnection={handleTestConnection}
              handleStart={handleStart}
              handleViewActiveRun={handleViewActiveRun}
              activeRunId={activeRun ? activeRun.id : null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
