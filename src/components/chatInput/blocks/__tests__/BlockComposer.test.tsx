import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { BlockComposer } from '../../BlockComposer';
import {
  PRESET_ASK_QUESTION,
  PRESET_FAST_TRUSTED_EDIT,
  type ComposerBlock,
} from '../types';

function renderBlockComposer(props: {
  blocks: ComposerBlock[];
  onChange?: (blocks: ComposerBlock[]) => void;
  onClose?: () => void;
  onUseAsMessage?: (prompt: string) => void;
  onSend?: (prompt: string) => void;
  context?: { projectFolder?: string; pipiOutputDir?: string };
}) {
  return renderToStaticMarkup(
    createElement(BlockComposer, {
      blocks: props.blocks,
      onChange: props.onChange || (() => {}),
      onClose: props.onClose || (() => {}),
      onUseAsMessage: props.onUseAsMessage || (() => {}),
      onSend: props.onSend || (() => {}),
      context: props.context,
    })
  );
}

describe('BlockComposer (structural)', () => {
  it('renders canvas instruction when blocks list is empty', () => {
    const html = renderBlockComposer({ blocks: [] });
    expect(html).toContain('Canvas is empty');
    expect(html).toContain('⚡'); // Load preset indicator
  });

  it('renders presets option list', () => {
    const html = renderBlockComposer({ blocks: [] });
    expect(html).toContain('value="ask-question"');
    expect(html).toContain('value="make-plan"');
    expect(html).toContain('value="debug-bug"');
    expect(html).toContain('value="implement-feature"');
    expect(html).toContain('value="fast-trusted-edit"');
    expect(html).toContain('value="autoresearch-smoke"');
  });

  it('renders add block buttons for toolbar', () => {
    const html = renderBlockComposer({ blocks: [] });
    expect(html).toContain('+ Intent');
    expect(html).toContain('+ Context');
    expect(html).toContain('+ Mode');
    expect(html).toContain('+ Constraints');
    expect(html).toContain('+ Output');
    expect(html).toContain('+ Verification');
    expect(html).toContain('+ Safety');
  });

  it('renders Intent, Mode, and Output cards from Ask Question preset', () => {
    const html = renderBlockComposer({ blocks: PRESET_ASK_QUESTION });
    expect(html).toContain('🎯 Intent');
    expect(html).toContain('⚙️ Mode');
    expect(html).toContain('📄 Output');
    expect(html).toContain('Use as message');
    expect(html).toContain('Send task');
  });

  it('renders Safety card with forbidden action details', () => {
    const html = renderBlockComposer({ blocks: PRESET_FAST_TRUSTED_EDIT });
    expect(html).toContain('🛡️ Safety');
    expect(html).toContain('Do not run large script migrations');
  });
});
