import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { BlockComposer } from '../BlockComposer';
import type { ComposerBlock } from '../blocks/types';

function renderBlockComposer(props: {
  blocks: ComposerBlock[];
  onChange?: (blocks: ComposerBlock[]) => void;
  onSend?: (prompt: string) => void;
  disabled?: boolean;
  density?: 'default' | 'compact';
  defaultMode?: any;
}): string {
  return renderToStaticMarkup(
    createElement(BlockComposer, {
      blocks: props.blocks,
      onChange: props.onChange || (() => {}),
      onSend: props.onSend || (() => {}),
      disabled: props.disabled,
      density: props.density,
      defaultMode: props.defaultMode,
    }),
  );
}

describe('BlockComposer (structural)', () => {
  it('renders empty canvas text when blocks list is empty', () => {
    const html = renderBlockComposer({ blocks: [] });
    expect(html).toContain('chat.canvasEmpty');
  });

  it('renders blocks when blocks list is not empty', () => {
    const blocks: ComposerBlock[] = [
      {
        id: 'test-intent',
        type: 'intent',
        intentType: 'implement',
        detail: 'Implement feature X',
      },
    ];
    const html = renderBlockComposer({ blocks });
    expect(html).toContain('Implement feature X');
    expect(html).toContain('chat.blockLabel.intent');
  });

  it('uses single column class when density is compact', () => {
    const blocks: ComposerBlock[] = [
      {
        id: 'test-intent',
        type: 'intent',
        intentType: 'implement',
        detail: 'Test content',
      },
    ];
    const htmlDefault = renderBlockComposer({ blocks, density: 'default' });
    const htmlCompact = renderBlockComposer({ blocks, density: 'compact' });

    expect(htmlDefault).toContain('grid-cols-2');
    expect(htmlCompact).toContain('grid-cols-1');
  });

  it('disables the Use as Message and Send Task button when disabled is true', () => {
    const blocks: ComposerBlock[] = [
      {
        id: 'test-intent',
        type: 'intent',
        intentType: 'implement',
        detail: 'Test content',
      },
    ];
    const html = renderBlockComposer({ blocks, disabled: true });
    // Expect both action buttons to have disabled attributes
    const disabledCount = (html.match(/disabled/g) || []).length;
    // At least move buttons + send/use buttons are disabled
    expect(disabledCount).toBeGreaterThan(1);
  });
});
