import { describe, expect, it } from '@jest/globals';
import {
  formatTaskTypeLabel,
  formatDirectionLabel,
  formatWorkspaceSummary,
  formatOutputContractSummary,
  formatReferenceGuidance
} from '../recipeFormatting';

describe('recipeFormatting tests', () => {
  it('formats task type labels correctly', () => {
    expect(formatTaskTypeLabel('reproduce_paper', 'zh-CN')).toBe('复现论文');
    expect(formatTaskTypeLabel('reproduce_paper', 'en-US')).toBe('Reproduce paper');
    expect(formatTaskTypeLabel('beat_baseline', 'zh-CN')).toBe('超越基线');
    expect(formatTaskTypeLabel('from_scratch', 'en-US')).toBe('From scratch');
  });

  it('formats direction labels correctly', () => {
    expect(formatDirectionLabel('higher', 'zh-CN')).toBe('目标越大越好');
    expect(formatDirectionLabel('lower', 'en-US')).toBe('smaller is better');
  });

  it('formats workspace summary correctly', () => {
    const workspace = { workDir: '/test/root', folderName: 'my-project' };
    expect(formatWorkspaceSummary(workspace, 'zh-CN')).toBe('工作区根目录：/test/root · 脚手架目录：my-project');
    expect(formatWorkspaceSummary({ workDir: '', folderName: '' }, 'en-US')).toBe('Workspace root: not selected · Scaffold directory: ');
  });

  it('formats output contract summaries correctly', () => {
    const contract = {
      includeMetrics: true,
      includeArtifacts: true,
      includeCommandsRun: false,
      includeFailureReason: true,
      includeRemainingRisks: false,
    };
    expect(formatOutputContractSummary(contract, 'zh-CN')).toContain('指标、产物、失败原因');
    expect(formatOutputContractSummary(contract, 'en-US')).toContain('metrics, artifacts, failure reason');
  });

  it('provides reference guidance', () => {
    expect(formatReferenceGuidance('reproduce_paper', 'zh-CN')).toBe('建议添加论文 PDF、README 或代码仓库说明。');
    expect(formatReferenceGuidance('beat_baseline', 'en-US')).toBe('Recommended: add baseline logs, metrics tables, or paper links.');
  });
});
