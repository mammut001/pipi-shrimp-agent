/**
 * @jest-environment jsdom
 */

import { describe, it, expect } from '@jest/globals';
import type { ComposerBlock } from '../blocks/types';
import {
  syncComposerModeFromExecutionMode,
  decideComposerBlocksChange,
  applyConfirmBypass,
  applyCancelBypass,
} from '../blockComposerWiring';

const askMode: ComposerBlock = { id: 'm1', type: 'mode', executionMode: 'ask' };
const agentMode: ComposerBlock = { id: 'm1', type: 'mode', executionMode: 'agent' };
const dangerMode: ComposerBlock = { id: 'm1', type: 'mode', executionMode: 'danger' };
const intent: ComposerBlock = {
  id: 'i1',
  type: 'intent',
  intentType: 'question',
  detail: 'help',
};

describe('blockComposerWiring pure helpers', () => {
  describe('syncComposerModeFromExecutionMode', () => {
    it('returns same array when no mode block exists', () => {
      const blocks = [intent];
      expect(syncComposerModeFromExecutionMode(blocks, 'agent')).toBe(blocks);
    });

    it('returns same array when mode already matches', () => {
      const blocks = [askMode, intent];
      expect(syncComposerModeFromExecutionMode(blocks, 'ask')).toBe(blocks);
    });

    it('updates mode block when selected mode differs', () => {
      const blocks = [askMode, intent];
      const next = syncComposerModeFromExecutionMode(blocks, 'agent');
      expect(next).not.toBe(blocks);
      expect(next[0]).toEqual({ ...askMode, executionMode: 'agent' });
      expect(next[1]).toBe(intent);
    });

    it('no-ops when selectedExecutionModeId is missing', () => {
      const blocks = [askMode];
      expect(syncComposerModeFromExecutionMode(blocks, null)).toBe(blocks);
      expect(syncComposerModeFromExecutionMode(blocks, undefined)).toBe(blocks);
    });
  });

  describe('decideComposerBlocksChange', () => {
    it('applies non-danger mode changes immediately', () => {
      const decision = decideComposerBlocksChange({
        newBlocks: [agentMode, intent],
        selectedExecutionModeId: 'ask',
      });
      expect(decision).toEqual({ type: 'apply', blocks: [agentMode, intent] });
    });

    it('gates danger mode when store is not already danger', () => {
      const decision = decideComposerBlocksChange({
        newBlocks: [dangerMode, intent],
        selectedExecutionModeId: 'ask',
      });
      expect(decision).toEqual({ type: 'pending-bypass', blocks: [dangerMode, intent] });
    });

    it('applies danger when store is already danger', () => {
      const decision = decideComposerBlocksChange({
        newBlocks: [dangerMode, intent],
        selectedExecutionModeId: 'danger',
      });
      expect(decision).toEqual({ type: 'apply', blocks: [dangerMode, intent] });
    });

    it('gates bypass the same as danger', () => {
      const bypassMode: ComposerBlock = { id: 'm1', type: 'mode', executionMode: 'bypass' };
      const decision = decideComposerBlocksChange({
        newBlocks: [bypassMode],
        selectedExecutionModeId: 'agent',
      });
      expect(decision.type).toBe('pending-bypass');
    });
  });

  describe('applyConfirmBypass / applyCancelBypass', () => {
    it('confirm keeps pending blocks', () => {
      const pending = [dangerMode, intent];
      expect(applyConfirmBypass(pending)).toBe(pending);
    });

    it('cancel reverts mode blocks to selected store mode', () => {
      const pending = [dangerMode, intent];
      const next = applyCancelBypass(pending, 'ask');
      expect(next[0]).toEqual({ ...dangerMode, executionMode: 'ask' });
      expect(next[1]).toEqual(intent);
    });
  });
});
