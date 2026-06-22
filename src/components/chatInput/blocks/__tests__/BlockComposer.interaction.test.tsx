/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BlockComposer } from '../../BlockComposer';
import { PRESET_ASK_QUESTION, type ComposerBlock } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
}));

function renderComposer(props: {
  blocks: ComposerBlock[];
  onChange?: (blocks: ComposerBlock[]) => void;
  onClose?: () => void;
  onUseAsMessage?: (prompt: string) => void;
  onSend?: (prompt: string) => void;
  disabled?: boolean;
  defaultMode?: 'ask' | 'agent' | 'plan' | 'bypass';
}) {
  const onChange = props.onChange ?? jest.fn();
  const onSend = props.onSend ?? jest.fn();
  const onUseAsMessage = props.onUseAsMessage ?? jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <BlockComposer
        blocks={props.blocks}
        onChange={onChange}
        onClose={props.onClose}
        onUseAsMessage={onUseAsMessage}
        onSend={onSend}
        disabled={props.disabled}
        defaultMode={props.defaultMode}
      />,
    );
  });

  return {
    container,
    root,
    onChange: onChange as jest.Mock,
    onSend: onSend as jest.Mock,
    onUseAsMessage: onUseAsMessage as jest.Mock,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

describe('BlockComposer (interaction)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not show Send task when composer has no meaningful blocks', () => {
    const view = renderComposer({ blocks: [] });
    expect(view.container.querySelector('button')?.textContent).not.toContain('chat.sendTask');
    view.cleanup();
  });

  it('does not show Send task for mode-only blocks', () => {
    const view = renderComposer({
      blocks: [{ id: 'm1', type: 'mode', executionMode: 'ask' }],
    });
    expect(view.container.textContent).not.toContain('chat.sendTask');
    view.cleanup();
  });

  it('adds intent block via toolbar', () => {
    const onChange = jest.fn();
    const view = renderComposer({ blocks: [], onChange });
    const intentButton = Array.from(view.container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('chat.blockLabel.intent'));
    expect(intentButton).toBeTruthy();
    act(() => {
      intentButton!.click();
    });
    expect(onChange).toHaveBeenCalled();
    const nextBlocks = onChange.mock.calls[0]?.[0] as ComposerBlock[];
    expect(nextBlocks).toHaveLength(1);
    expect(nextBlocks[0]?.type).toBe('intent');
    view.cleanup();
  });

  it('adds mode block defaulting to current execution mode', () => {
    const onChange = jest.fn();
    const view = renderComposer({ blocks: [], onChange, defaultMode: 'ask' });
    const modeButton = Array.from(view.container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('chat.blockLabel.mode'));
    act(() => {
      modeButton!.click();
    });
    const nextBlocks = onChange.mock.calls[0]?.[0] as ComposerBlock[];
    const modeBlock = nextBlocks.find((block) => block.type === 'mode');
    expect(modeBlock).toMatchObject({ type: 'mode', executionMode: 'ask' });
    view.cleanup();
  });

  it('loads preset blocks', () => {
    const onChange = jest.fn();
    const view = renderComposer({ blocks: [], onChange });
    const select = view.container.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'ask-question';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const nextBlocks = onChange.mock.calls[0]?.[0] as ComposerBlock[];
    expect(nextBlocks.length).toBeGreaterThan(0);
    view.cleanup();
  });

  it('calls onUseAsMessage with compiled prompt from preset', () => {
    const view = renderComposer({ blocks: PRESET_ASK_QUESTION });
    const useAsMessageButton = Array.from(view.container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('chat.useAsMessage'));
    expect(useAsMessageButton).toBeTruthy();
    act(() => {
      useAsMessageButton!.click();
    });
    expect(view.onUseAsMessage).toHaveBeenCalled();
    expect(view.onUseAsMessage.mock.calls[0]?.[0]).toContain('# TASK SPECIFICATION');
    view.cleanup();
  });

  it('calls onSend with compiled prompt and respects disabled while streaming', () => {
    const view = renderComposer({ blocks: PRESET_ASK_QUESTION, disabled: true });
    const sendButton = Array.from(view.container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('chat.sendTask'));
    expect(sendButton).toBeTruthy();
    expect(sendButton).toHaveProperty('disabled', true);
    view.cleanup();

    const activeView = renderComposer({ blocks: PRESET_ASK_QUESTION, disabled: false });
    const activeSend = Array.from(activeView.container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('chat.sendTask'));
    act(() => {
      activeSend!.click();
    });
    expect(activeView.onSend).toHaveBeenCalled();
    expect(activeView.onSend.mock.calls[0]?.[0]).toContain('# TASK SPECIFICATION');
    activeView.cleanup();
  });

  it('removes block via aria-labeled remove button', () => {
    const onChange = jest.fn();
    const view = renderComposer({ blocks: PRESET_ASK_QUESTION, onChange });
    const removeButtons = view.container.querySelectorAll('[aria-label="chat.removeBlock"]');
    expect(removeButtons.length).toBeGreaterThan(0);
    act(() => {
      (removeButtons[0] as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalled();
    view.cleanup();
  });

  it('moves block down via aria-labeled control', () => {
    const onChange = jest.fn();
    const view = renderComposer({ blocks: PRESET_ASK_QUESTION, onChange });
    const moveDownButtons = view.container.querySelectorAll('[aria-label="chat.moveDown"]');
    act(() => {
      (moveDownButtons[0] as HTMLButtonElement).click();
    });
    expect(onChange).toHaveBeenCalled();
    view.cleanup();
  });

  it('exposes aria-label on close button', () => {
    const onClose = jest.fn();
    const view = renderComposer({ blocks: [], onClose });
    const closeButton = view.container.querySelector('[aria-label="common.close"]');
    expect(closeButton).toBeTruthy();
    act(() => {
      (closeButton as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalled();
    view.cleanup();
  });

  it('closes preview on Escape', () => {
    const view = renderComposer({ blocks: PRESET_ASK_QUESTION });
    const previewToggle = Array.from(view.container.querySelectorAll('button'))
      .find((btn) => btn.textContent?.includes('Show Compiled Prompt Preview'));
    act(() => {
      previewToggle!.click();
    });
    expect(view.container.textContent).toContain('Hide Compiled Prompt Preview');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(view.container.textContent).toContain('Show Compiled Prompt Preview');
    view.cleanup();
  });
});
