export function formatTaskTypeLabel(taskType: string, locale: string): string {
  if (locale === 'zh-CN') {
    switch (taskType) {
      case 'reproduce_paper': return '复现论文';
      case 'beat_baseline': return '超越基线';
      case 'ablation': return '消融实验';
      case 'from_scratch': return '从零开始';
      default: return taskType;
    }
  } else {
    switch (taskType) {
      case 'reproduce_paper': return 'Reproduce paper';
      case 'beat_baseline': return 'Beat baseline';
      case 'ablation': return 'Ablation';
      case 'from_scratch': return 'From scratch';
      default: return taskType;
    }
  }
}

export function formatDirectionLabel(direction: 'higher' | 'lower', locale: string): string {
  if (locale === 'zh-CN') {
    return direction === 'higher' ? '目标越大越好' : '目标越小越好';
  } else {
    return direction === 'higher' ? 'larger is better' : 'smaller is better';
  }
}

export function formatWorkspaceSummary(
  workspaceOrWorkDir: { workDir: string; folderName: string } | string,
  folderNameOrLocale?: string,
  locale?: string
): string {
  let workDir = '';
  let folderName = '';
  let activeLocale = 'zh-CN';

  if (typeof workspaceOrWorkDir === 'object' && workspaceOrWorkDir !== null) {
    workDir = workspaceOrWorkDir.workDir || '';
    folderName = workspaceOrWorkDir.folderName || '';
    activeLocale = folderNameOrLocale || 'zh-CN';
  } else {
    workDir = workspaceOrWorkDir || '';
    folderName = folderNameOrLocale || '';
    activeLocale = locale || 'zh-CN';
  }

  const rootText = workDir ? workDir : (activeLocale === 'zh-CN' ? '未选择' : 'not selected');
  if (activeLocale === 'zh-CN') {
    return `工作区根目录：${rootText} · 脚手架目录：${folderName}`;
  } else {
    return `Workspace root: ${rootText} · Scaffold directory: ${folderName}`;
  }
}

export interface OutputContract {
  includeMetrics: boolean;
  includeArtifacts: boolean;
  includeCommandsRun: boolean;
  includeFailureReason: boolean;
  includeRemainingRisks: boolean;
}

export function formatOutputContractSummary(
  outputContract: OutputContract,
  locale: string
): string {
  if (!outputContract) return locale === 'zh-CN' ? '最终报告包含：无' : 'Final report contains: none';
  const items: string[] = [];
  if (outputContract.includeMetrics) {
    items.push(locale === 'zh-CN' ? '指标' : 'metrics');
  }
  if (outputContract.includeArtifacts) {
    items.push(locale === 'zh-CN' ? '产物' : 'artifacts');
  }
  if (outputContract.includeCommandsRun) {
    items.push(locale === 'zh-CN' ? '命令记录' : 'command log');
  }
  if (outputContract.includeFailureReason) {
    items.push(locale === 'zh-CN' ? '失败原因' : 'failure reason');
  }
  if (outputContract.includeRemainingRisks) {
    items.push(locale === 'zh-CN' ? '剩余风险' : 'remaining risks');
  }
  
  const joined = items.join(locale === 'zh-CN' ? '、' : ', ');
  if (locale === 'zh-CN') {
    return `最终报告包含：${joined || '无'}`;
  } else {
    return `Final report contains: ${joined || 'none'}`;
  }
}

export function formatReferenceGuidance(taskType: string, locale: string): string {
  if (locale === 'zh-CN') {
    switch (taskType) {
      case 'reproduce_paper':
        return '建议添加论文 PDF、README 或代码仓库说明。';
      case 'beat_baseline':
        return '建议添加 baseline 日志、指标表或论文链接。';
      case 'ablation':
        return '建议添加模型配置、实验日志或消融表。';
      case 'from_scratch':
        return '可选：添加相关论文或已有代码作为灵感。';
      default:
        return '';
    }
  } else {
    switch (taskType) {
      case 'reproduce_paper':
        return 'Recommended: add paper PDF, README, or repository description.';
      case 'beat_baseline':
        return 'Recommended: add baseline logs, metrics tables, or paper links.';
      case 'ablation':
        return 'Recommended: add model config, experiment logs, or ablation tables.';
      case 'from_scratch':
        return 'Optional: add relevant papers or existing code for inspiration.';
      default:
        return '';
    }
  }
}
