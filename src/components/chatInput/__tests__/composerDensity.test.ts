import { describe, it, expect } from '@jest/globals';
import { resolveComposerDensityStyles } from '../composerDensity';

describe('resolveComposerDensityStyles', () => {
  it('returns compact sizing for compact density', () => {
    const styles = resolveComposerDensityStyles('compact');
    expect(styles.isCompact).toBe(true);
    expect(styles.textareaMaxHeight).toBe(96);
    expect(styles.textareaMinHeight).toBe('36px');
    expect(styles.rootClassName).toBe('bg-white');
    expect(styles.actionIconClassName).toBe('h-4 w-4');
  });

  it('returns default sizing for default density', () => {
    const styles = resolveComposerDensityStyles('default');
    expect(styles.isCompact).toBe(false);
    expect(styles.textareaMaxHeight).toBe(200);
    expect(styles.textareaMinHeight).toBe('48px');
    expect(styles.rootClassName).toContain('border-t');
    expect(styles.actionIconClassName).toBe('h-5 w-5');
  });
});
