import { describe, expect, it } from '@jest/globals';

import {
  browserSurfaceUrlsMatch,
  evaluateCdpSurfaceMatch,
  normalizeBrowserSurfaceUrl,
} from '../browserAgentStartGate';

describe('browser surface URL matching (R3-04)', () => {
  it('normalization_allows_trailing_slash_difference', () => {
    expect(normalizeBrowserSurfaceUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(browserSurfaceUrlsMatch('https://example.com/path', 'https://example.com/path/')).toBe(true);
  });

  it('normalization_allows_hash_difference', () => {
    expect(browserSurfaceUrlsMatch(
      'https://example.com/path#section-a',
      'https://example.com/path#section-b',
    )).toBe(true);
  });

  it('different_origin_blocks', () => {
    expect(browserSurfaceUrlsMatch(
      'https://a.example.com/page',
      'https://b.example.com/page',
    )).toBe(false);
  });

  it('different_path_blocks', () => {
    expect(browserSurfaceUrlsMatch(
      'https://example.com/a',
      'https://example.com/b',
    )).toBe(false);
  });

  it('different_query_blocks', () => {
    expect(browserSurfaceUrlsMatch(
      'https://example.com/page?token=secret-a',
      'https://example.com/page?token=secret-b',
    )).toBe(false);
  });

  it('unknown_cdp_url_blocks', () => {
    const gate = evaluateCdpSurfaceMatch('https://example.com/page', '');
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toBe('surface_unknown');
    }
  });

  it('unknown_preview_url_blocks', () => {
    const gate = evaluateCdpSurfaceMatch(null, 'https://example.com/page');
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toBe('surface_unknown');
    }
  });

  it('mismatch_sets_safe_user_message_without_secret_leak', () => {
    const gate = evaluateCdpSurfaceMatch(
      'https://example.com/page?token=super-secret',
      'https://other.example.com/page?token=super-secret',
    );
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.messageKey).toBe('browser.surfaceMismatchBeforeAgent');
      expect(JSON.stringify(gate)).not.toContain('super-secret');
    }
  });

  it('matching_url_allows_surface_gate', () => {
    const gate = evaluateCdpSurfaceMatch(
      'https://example.com/dashboard',
      'https://example.com/dashboard/',
    );
    expect(gate).toEqual({ allowed: true });
  });
});