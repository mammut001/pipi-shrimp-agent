/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BlockComposer } from '../../BlockComposer';
import type { ComposerBlock } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

describe('BlockComposer mode sync', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('updates mode block when defaultMode changes from parent', () => {
    const blocks: ComposerBlock[] = [
      { id: 'm1', type: 'mode', executionMode: 'ask' },
      { id: 'i1', type: 'intent', intentType: 'question', detail: 'help' },
    ];
    const onChange = jest.fn();

    const renderWithMode = (defaultMode: 'ask' | 'agent') => {
      act(() => {
        root.render(
          <BlockComposer
            blocks={blocks}
            onChange={onChange}
            onSend={() => {}}
            defaultMode={defaultMode}
          />,
        );
      });
    };

    renderWithMode('ask');
    expect(container.textContent).toContain('ask');

    onChange.mockClear();
    renderWithMode('agent');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('editing mode block calls onChange once per click', () => {
    const blocks: ComposerBlock[] = [
      { id: 'm1', type: 'mode', executionMode: 'ask' },
      { id: 'i1', type: 'intent', intentType: 'question', detail: 'help' },
    ];
    const onChange = jest.fn();

    act(() => {
      root.render(
        <BlockComposer
          blocks={blocks}
          onChange={onChange}
          onSend={() => {}}
          defaultMode="ask"
        />,
      );
    });

    const agentButton = Array.from(container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.trim() === 'agent');
    expect(agentButton).toBeTruthy();

    act(() => {
      agentButton!.click();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextBlocks = onChange.mock.calls[0]?.[0] as ComposerBlock[];
    const modeBlock = nextBlocks.find((block) => block.type === 'mode');
    expect(modeBlock).toMatchObject({ executionMode: 'agent' });
  });
});
