/**
 * Context Analysis - Iterative Pattern Detector
 *
 * Detects whether the conversation exhibits iterative file-editing behaviour.
 */

import type { Message } from '../../../types/chat';
import { countRepeatFileEdits, countFileEdits } from '../utils';

export interface IterativePatternResult {
  /** 0.0 – 1.0: confidence that the conversation is iterative */
  score: number;
  /** Number of files edited more than once */
  repeatEditCount: number;
  /** Total file edits */
  totalEdits: number;
}

export function detectIterativePattern(messages: Message[]): IterativePatternResult {
  const totalEdits = countFileEdits(messages);
  const repeatEdits = countRepeatFileEdits(messages);

  const score = totalEdits === 0 ? 0 : Math.min(repeatEdits / totalEdits, 1);

  return { score, repeatEditCount: repeatEdits, totalEdits };
}
