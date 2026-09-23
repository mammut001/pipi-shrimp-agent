import { describe, expect, it } from '@jest/globals';
import type { ExtractedBaseline } from '@/services/autoresearch/bootstrap/types';
import type { SshConfig } from '@/store/autoresearchStore';
import {
  BOOTSTRAP_MISSING_FINALIZE_MESSAGE,
  createDefaultRecipe,
  resolveBaselineValue,
  resolveBootstrapMetricDirection,
  resolveBootstrapRemoteWorkDir,
} from '../bootstrapChatHelpers';

function ssh(partial: Partial<SshConfig> = {}): SshConfig {
  return {
    mode: 'ssh',
    host: 'gpu.example',
    user: 'root',
    keyPath: '',
    port: 22,
    remoteWorkDir: '~/autoresearch',
    authMode: 'agent',
    password: '',
    ...partial,
  };
}

describe('bootstrapChatHelpers', () => {
  describe('resolveBootstrapMetricDirection (R5-08)', () => {
    it('prefers explicit plan direction over recipe and guess', () => {
      expect(resolveBootstrapMetricDirection({
        planDirection: 'lower',
        recipeDirection: 'higher',
        primaryMetric: 'accuracy',
      })).toBe('lower');
      expect(resolveBootstrapMetricDirection({
        planDirection: 'higher',
        recipeDirection: 'lower',
        primaryMetric: 'val_loss',
      })).toBe('higher');
    });

    it('falls back to recipe when plan omits direction', () => {
      expect(resolveBootstrapMetricDirection({
        planDirection: undefined,
        recipeDirection: 'lower',
        primaryMetric: 'accuracy',
      })).toBe('lower');
    });

    it('guesses only when both plan and recipe omit direction', () => {
      expect(resolveBootstrapMetricDirection({
        primaryMetric: 'val_loss',
      })).toBe('lower');
      expect(resolveBootstrapMetricDirection({
        planDirection: 'sideways',
        recipeDirection: '',
        primaryMetric: 'top1_acc',
      })).toBe('higher');
    });
  });

  describe('resolveBaselineValue', () => {
    const baselines: ExtractedBaseline[] = [
      {
        name: 'baseline-a',
        task: 'classification',
        dataset: 'cifar10',
        reportedMetrics: [
          { name: 'Accuracy', value: 0.91 },
          { name: 'val_loss', value: 0.42 },
        ],
        method: { summary: 'resnet' },
        reproducibility: { hasOfficialCode: false },
      },
      {
        name: 'baseline-b',
        task: 'classification',
        dataset: 'cifar10',
        reportedMetrics: [{ name: 'f1', value: 0.77 }],
        method: { summary: 'vit' },
        reproducibility: { hasOfficialCode: false },
      },
    ];

    it('matches primary metric case-insensitively', () => {
      expect(resolveBaselineValue(baselines, 'accuracy')).toBe(0.91);
      expect(resolveBaselineValue(baselines, ' VAL_LOSS ')).toBe(0.42);
    });

    it('falls back to first reported metric when no name match', () => {
      expect(resolveBaselineValue(baselines, 'missing')).toBe(0.91);
    });

    it('returns null for empty baselines', () => {
      expect(resolveBaselineValue([], 'accuracy')).toBeNull();
    });
  });

  describe('resolveBootstrapRemoteWorkDir', () => {
    it('keeps workDir when already under remote root', () => {
      expect(resolveBootstrapRemoteWorkDir(ssh(), '~/autoresearch/exp-a')).toBe('~/autoresearch/exp-a');
      expect(resolveBootstrapRemoteWorkDir(ssh(), '~/autoresearch')).toBe('~/autoresearch');
    });

    it('uses remote root for empty / generic temp workDirs', () => {
      expect(resolveBootstrapRemoteWorkDir(ssh(), '')).toBe('~/autoresearch');
      expect(resolveBootstrapRemoteWorkDir(ssh(), '/tmp/autoresearch-123')).toBe('~/autoresearch');
      expect(resolveBootstrapRemoteWorkDir(ssh(), '/var/tmp')).toBe('~/autoresearch');
    });

    it('appends project folder under default remote root', () => {
      expect(resolveBootstrapRemoteWorkDir(ssh(), '/Users/me/projects/my-paper')).toBe('~/autoresearch/my-paper');
    });

    it('collapses to custom remote root when not default', () => {
      expect(resolveBootstrapRemoteWorkDir(
        ssh({ remoteWorkDir: '/data/runs' }),
        '/Users/me/projects/my-paper',
      )).toBe('/data/runs');
    });
  });

  describe('createDefaultRecipe', () => {
    it('seeds SSH workDir from sshConfig.remoteWorkDir', () => {
      const recipe = createDefaultRecipe(ssh({ remoteWorkDir: '~/gpu-lab' }));
      expect(recipe.workspace.workDir).toBe('~/gpu-lab');
      expect(recipe.baselineAndMetric.direction).toBe('higher');
    });

    it('leaves local workDir empty', () => {
      const recipe = createDefaultRecipe(ssh({ mode: 'local', remoteWorkDir: '/local' }));
      expect(recipe.workspace.workDir).toBe('');
    });
  });

  it('exports stable missing-finalize copy', () => {
    expect(BOOTSTRAP_MISSING_FINALIZE_MESSAGE).toMatch(/bootstrap_finalize/);
  });
});
