import { describe, expect, it } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QuestionnaireCard } from '../QuestionnaireCard';

describe('QuestionnaireCard render safety', () => {
  it('renders structured select options without throwing', () => {
    const html = renderToStaticMarkup(
      createElement(QuestionnaireCard, {
        data: {
          toolCallId: 'tool-1',
          title: 'Need input',
          description: 'Please answer',
          fields: [
            {
              id: 'language',
              label: 'Language',
              type: 'select',
              required: true,
              options: [
                { label: 'English', description: 'EN' },
                { label: '中文', description: 'ZH' },
              ],
            },
          ],
        },
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );

    expect(html).toContain('English');
    expect(html).toContain('中文');
    expect(html).not.toContain('object with keys');
  });
});