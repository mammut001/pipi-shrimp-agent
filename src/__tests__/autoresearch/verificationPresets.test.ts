import { describe, expect, it } from '@jest/globals';
import {
  VERIFICATION_PRESETS,
  DEFAULT_VERIFICATION_PRESET,
  resolveVerificationPresetId,
  resolveVerificationCommands,
} from '@/services/autoresearch/defaultConfig';

describe('verification presets', () => {
  it('defines fast, standard, full, and custom presets', () => {
    const ids = VERIFICATION_PRESETS.map((p) => p.id);
    expect(ids).toContain('fast');
    expect(ids).toContain('standard');
    expect(ids).toContain('full');
    expect(ids).toContain('custom');
  });

  it('defaults to standard preset', () => {
    expect(DEFAULT_VERIFICATION_PRESET).toBe('standard');
  });

  it('standard preset includes build, test, and typecheck', () => {
    const standard = VERIFICATION_PRESETS.find((p) => p.id === 'standard');
    expect(standard?.commands).toEqual([
      'pnpm run build',
      'pnpm test',
      'node_modules/.bin/tsc --noEmit',
    ]);
  });

  it('fast preset includes only build', () => {
    const fast = VERIFICATION_PRESETS.find((p) => p.id === 'fast');
    expect(fast?.commands).toEqual(['pnpm run build']);
  });

  it('custom preset has empty commands', () => {
    const custom = VERIFICATION_PRESETS.find((p) => p.id === 'custom');
    expect(custom?.commands).toEqual([]);
  });

  describe('resolveVerificationPresetId', () => {
    it('resolves standard commands to standard preset', () => {
      expect(resolveVerificationPresetId([
        'pnpm run build',
        'pnpm test',
        'node_modules/.bin/tsc --noEmit',
      ])).toBe('standard');
    });

    it('resolves fast commands to fast preset', () => {
      expect(resolveVerificationPresetId(['pnpm run build'])).toBe('fast');
    });

    it('resolves custom commands to custom preset', () => {
      expect(resolveVerificationPresetId(['npm run check', 'npm run validate'])).toBe('custom');
    });

    it('resolves empty array to custom preset', () => {
      expect(resolveVerificationPresetId([])).toBe('custom');
    });

    it('resolves full preset commands to full', () => {
      const full = VERIFICATION_PRESETS.find((p) => p.id === 'full');
      expect(resolveVerificationPresetId(full!.commands)).toBe('full');
    });
  });

  describe('resolveVerificationCommands', () => {
    it('returns standard commands for standard preset', () => {
      expect(resolveVerificationCommands('standard')).toEqual([
        'pnpm run build',
        'pnpm test',
        'node_modules/.bin/tsc --noEmit',
      ]);
    });

    it('returns fast commands for fast preset', () => {
      expect(resolveVerificationCommands('fast')).toEqual(['pnpm run build']);
    });

    it('returns custom commands when custom preset is selected', () => {
      expect(resolveVerificationCommands('custom', ['npm run check'])).toEqual(['npm run check']);
    });

    it('filters empty strings from custom commands', () => {
      expect(resolveVerificationCommands('custom', ['npm run check', '', '  ', 'npm test'])).toEqual([
        'npm run check',
        'npm test',
      ]);
    });

    it('returns default preset commands for unknown preset id', () => {
      // @ts-expect-error testing invalid input
      expect(resolveVerificationCommands('unknown')).toEqual([
        'pnpm run build',
        'pnpm test',
        'node_modules/.bin/tsc --noEmit',
      ]);
    });
  });
});
