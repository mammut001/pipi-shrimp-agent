import { describe, expect, it } from '@jest/globals';

import { normalizeQuestionnaireFields } from '../questionnaireNormalize';

describe('normalizeQuestionnaireFields', () => {
  it('coerces structured select options into strings', () => {
    const fields = normalizeQuestionnaireFields([
      {
        id: 'language',
        label: { label: 'Language', description: 'Pick one' },
        type: 'select',
        required: true,
        options: [
          { label: 'English', description: 'EN' },
          { label: '中文', description: 'ZH' },
        ],
      },
    ]);

    expect(fields[0]?.label).toBe('Language');
    expect(fields[0]?.options).toEqual(['English', '中文']);
  });
});