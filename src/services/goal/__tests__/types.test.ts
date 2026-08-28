import { describe, expect, it } from '@jest/globals';

import {
  formatSuccessCriteria,
  normalizeSuccessCriteria,
} from '@/services/goal/types';

describe('Goal Core success criteria adapters', () => {
  it('normalizes legacy Workflow text into canonical string[] criteria', () => {
    expect(normalizeSuccessCriteria('- first\n• second\n\n third ')).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('keeps canonical arrays canonical and removes accidental bullet prefixes', () => {
    expect(normalizeSuccessCriteria([' first ', '- second', '• third', ''])).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('round-trips canonical criteria through the display boundary', () => {
    const criteria = ['first', 'second', 'third'];
    expect(normalizeSuccessCriteria(formatSuccessCriteria(criteria))).toEqual(criteria);
  });

  it('renders criteria only at UI/prompt boundaries', () => {
    expect(formatSuccessCriteria(['first', 'second'])).toBe('- first\n- second');
  });

  it('normalizes nullish input to an empty array', () => {
    expect(normalizeSuccessCriteria(undefined)).toEqual([]);
    expect(normalizeSuccessCriteria(null)).toEqual([]);
  });
});
