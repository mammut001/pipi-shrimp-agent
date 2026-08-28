export interface ManualSshConfig {
  mode: 'local' | 'ssh';
  host: string;
  user: string;
  port: number;
}

export function formatRuntimeTargetSummary(cfg: ManualSshConfig, locale: string): string {
  if (!cfg) return '';
  if (cfg.mode === 'local') {
    return locale === 'zh-CN' ? '本机运行' : 'Local run';
  } else {
    if (!cfg.host) {
      return locale === 'zh-CN' ? 'SSH：尚未填写主机' : 'SSH: Host not specified';
    }
    return `SSH: ${cfg.user}@${cfg.host}:${cfg.port}`;
  }
}

export function formatManualWorkspaceSummary(
  workspace: { remoteWorkDir: string; experimentDir: string },
  locale: string
): string {
  if (!workspace) return '';
  const workDirText = workspace.remoteWorkDir || (locale === 'zh-CN' ? '未选择工作区' : 'not selected');
  const expDirText = workspace.experimentDir || (locale === 'zh-CN' ? '未选择项目' : 'not selected');
  if (locale === 'zh-CN') {
    return `工作区：${workDirText} · 目标项目：${expDirText}`;
  } else {
    return `Workspace: ${workDirText} · Target: ${expDirText}`;
  }
}

export function formatMetricIterationsSummary(
  metricConfig: { metric: string; direction: 'lower' | 'higher'; baselineInput: string; maxIter: number },
  locale: string
): string {
  if (!metricConfig) return '';
  const metric = metricConfig.metric;
  const direction = metricConfig.direction;
  const baseline = metricConfig.baselineInput || '';
  const iterations = metricConfig.maxIter;

  const dirLabel = direction === 'higher'
    ? (locale === 'zh-CN' ? '目标越大越好' : 'higher is better')
    : (locale === 'zh-CN' ? '目标越小越好' : 'lower is better');
  const baselineLabel = baseline.trim()
    ? (locale === 'zh-CN' ? `基线：${baseline}` : `baseline: ${baseline}`)
    : (locale === 'zh-CN' ? '无基线' : 'no baseline');
  if (locale === 'zh-CN') {
    return `主指标：${metric || '未设置'} (${dirLabel}) · ${baselineLabel} · 最大迭代 ${iterations} 轮`;
  } else {
    return `Metric: ${metric || 'none'} (${dirLabel}) · ${baselineLabel} · max ${iterations} iterations`;
  }
}

import { parseAutoResearchConnectionProbeOutput } from '@/services/autoresearch/connectionProbe';

export interface ParsedConnectionSuccess {
  platform: string;
  pwd: string;
  isGitRepo: boolean;
  gitStatus: 'ok' | 'missing' | 'not_installed' | 'unknown';
  experimentPresent: boolean;
  pythonPresent: boolean;
  workspaceReady: boolean;
}

export function parseConnectionCheckOutput(output: string): ParsedConnectionSuccess {
  const probe = parseAutoResearchConnectionProbeOutput(output);
  if (probe.targetOk || probe.git !== 'unknown' || probe.workspace !== 'unknown') {
    return {
      platform: probe.platform,
      pwd: probe.pwd,
      isGitRepo: probe.git === 'ok',
      gitStatus: probe.git,
      experimentPresent: probe.experiment !== 'missing',
      pythonPresent: probe.python !== 'missing',
      workspaceReady: probe.workspace !== 'failed',
    };
  }

  const lines = (output || '').split('\n').map((l) => l.trim());
  const platform = lines[0] || 'Unknown';
  const pwd = lines[1] || 'Unknown';
  const gitLine = lines.find((line) => line === 'true' || line === 'false' || line.startsWith('git:')) || lines[2] || '';
  const isGitRepo = gitLine === 'true' || gitLine === 'git:ok';
  return {
    platform,
    pwd,
    isGitRepo,
    gitStatus: isGitRepo ? 'ok' : gitLine === 'git:not_installed' ? 'not_installed' : gitLine ? 'missing' : 'unknown',
    experimentPresent: true,
    pythonPresent: true,
    workspaceReady: true,
  };
}
