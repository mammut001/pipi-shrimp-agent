import { describe, expect, it } from '@jest/globals';

import {
  parseSuccessCriteria,
  serializeSuccessCriteria,
} from '@/services/goal/types';

describe('Goal Core success criteria adapters', () => {
  it('normalizes Workflow legacy text into canonical string[] criteria', () => {
    expect(parseSuccessCriteria('- first\n• second\n\n third ')).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('round-trips canonical criteria through Workflow legacy storage', () => {
    const criteria = ['first', 'second', 'third'];
    expect(parseSuccessCriteria(serializeSuccessCriteria(criteria))).toEqual(criteria);
  });

  it('drops blank criteria when serializing', () => {
    expect(serializeSuccessCriteria(['first', ' ', '', 'second'])).toBe('- first\n- second');
  });
});
