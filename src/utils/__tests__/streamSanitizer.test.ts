import { describe, expect, it } from '@jest/globals';

import { stripProviderStreamArtifacts } from '../streamSanitizer';

describe('stripProviderStreamArtifacts', () => {
  it('removes MiniMax control tokens from streamed text', () => {
    const input = ']<]minimax[>[ ]<]minimax[>[]<]minimax[>[]<]minimax[>[ ]<]minimax[>[\n\nHello';
    expect(stripProviderStreamArtifacts(input)).toBe('[ [][][ [\n\nHello');
  });
});