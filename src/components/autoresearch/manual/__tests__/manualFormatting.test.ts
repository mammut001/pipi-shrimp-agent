import { describe, expect, it } from '@jest/globals';
import {
  formatRuntimeTargetSummary,
  formatManualWorkspaceSummary,
  formatMetricIterationsSummary,
  parseConnectionCheckOutput
} from '../manualFormatting';

describe('manualFormatting tests', () => {
  it('formats runtime summaries correctly', () => {
    expect(formatRuntimeTargetSummary({ mode: 'local', host: '', user: '', port: 22 }, 'zh-CN')).toBe('本机运行');
    expect(formatRuntimeTargetSummary({ mode: 'ssh', host: '192.168.1.1', user: 'root', port: 22 }, 'en-US')).toBe('SSH: root@192.168.1.1:22');
    expect(formatRuntimeTargetSummary({ mode: 'ssh', host: '', user: 'root', port: 22 }, 'zh-CN')).toBe('SSH：尚未填写主机');
  });

  it('formats workspace summaries correctly', () => {
    const workspace = { remoteWorkDir: '/path/workspace', experimentDir: '/path/project' };
    expect(formatManualWorkspaceSummary(workspace, 'zh-CN')).toBe('工作区：/path/workspace · 目标项目：/path/project');
    expect(formatManualWorkspaceSummary({ remoteWorkDir: '', experimentDir: '' }, 'en-US')).toBe('Workspace: not selected · Target: not selected');
  });

  it('formats metric parameters correctly', () => {
    const metrics = {
      metric: 'val_accuracy',
      direction: 'higher' as const,
      baselineInput: '0.85',
      maxIter: 20,
    };
    expect(formatMetricIterationsSummary(metrics, 'zh-CN')).toBe('主指标：val_accuracy (目标越大越好) · 基线：0.85 · 最大迭代 20 轮');
  });

  it('parses bash connection success outputs correctly', () => {
    const rawOutput = 'Linux\n/home/ubuntu/project\ntrue';
    const parsed = parseConnectionCheckOutput(rawOutput);
    expect(parsed.platform).toBe('Linux');
    expect(parsed.pwd).toBe('/home/ubuntu/project');
    expect(parsed.isGitRepo).toBe(true);
  });
});
