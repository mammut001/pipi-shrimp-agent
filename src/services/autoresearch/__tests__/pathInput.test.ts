import { describe, expect, it } from '@jest/globals';
import {
  isHorizontalArrowKey,
  resolveAutoResearchLaunchPaths,
  resolveInitialExperimentDir,
  sanitizePathInput,
} from '../pathInput';

describe('pathInput helpers', () => {
  it('sanitizes loaded experiment paths without rewriting them to session.md', () => {
    expect(resolveInitialExperimentDir(
      '/Users/yuhan\u0000song/Documents/tiny-autoresearch-digits\uFFFD',
      '/fallback/workdir',
    )).toBe('/Users/yuhansong/Documents/tiny-autoresearch-digits');

    expect(resolveInitialExperimentDir('', '/Users/yuhansong/Documents/tiny-autoresearch-digits')).toBe(
      '/Users/yuhansong/Documents/tiny-autoresearch-digits',
    );
  });

  it('keeps experimentDir separate from the internal session file path at launch', () => {
    expect(resolveAutoResearchLaunchPaths({
      experimentDir: '/Users/yuhansong/Documents/tiny-autoresearch-digits',
      workDir: '~/autoresearch\u0000',
      sessionId: 'autoresearch-123',
    })).toEqual({
      experimentDir: '/Users/yuhansong/Documents/tiny-autoresearch-digits',
      workDir: '~/autoresearch',
      sessionFilePath: '~/autoresearch/session.md',
      livingDocPath: '~/autoresearch/runs/autoresearch-123/autoresearch.md',
    });
  });

  it('treats ArrowRight as navigation-only input handling', () => {
    const experimentDir = '/Users/yuhansong/Documents/tiny-autoresearch-digits';

    expect(isHorizontalArrowKey('ArrowRight')).toBe(true);
    expect(isHorizontalArrowKey('ArrowLeft')).toBe(true);
    expect(isHorizontalArrowKey('Enter')).toBe(false);
    expect(sanitizePathInput(experimentDir)).toBe(experimentDir);
  });
});
