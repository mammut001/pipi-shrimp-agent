/**
 * Browser agent action schema tests.
 *
 * Cover the Phase 3 acceptance criteria:
 *   - valid actions parse
 *   - invalid actions are rejected with helpful errors
 *   - malformed JSON triggers a retry on first attempt
 *   - malformed JSON becomes fatal after the configured retry budget
 *   - fenced JSON is accepted
 */

import {
  parseBrowserActionEnvelope,
  parseBrowserActionEnvelopeWithRetry,
  SUPPORTED_ACTION_NAMES,
} from '@/utils/browserAgentActionSchema';

describe('browserAgentActionSchema', () => {
  describe('parseBrowserActionEnvelope', () => {
    it('parses a click_element with backend_node_id', () => {
      const result = parseBrowserActionEnvelope(JSON.stringify({
        thought: 'click the button',
        action: { click_element: { backend_node_id: 42 } },
      }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.actionName).toBe('click_element');
        expect(result.envelope.payload.backend_node_id).toBe(42);
        expect(result.envelope.thought).toBe('click the button');
      }
    });

    it('parses a fenced JSON response', () => {
      const fenced = '```json\n{"action":{"done":{"text":"all done","success":true}}}\n```';
      const result = parseBrowserActionEnvelope(fenced);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.actionName).toBe('done');
        expect(result.envelope.payload.text).toBe('all done');
      }
    });

    it('parses JSON embedded inside prose', () => {
      const prose = 'Here you go: {"action":{"navigate":{"url":"https://example.com"}}} cheers';
      const result = parseBrowserActionEnvelope(prose);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.actionName).toBe('navigate');
      }
    });

    it('rejects responses with no action object', () => {
      const result = parseBrowserActionEnvelope('{"thought":"thinking"}');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('action');
      }
    });

    it('rejects responses with multiple action keys', () => {
      const result = parseBrowserActionEnvelope('{"action":{"click_element":{"id":1},"done":{"text":"x","success":true}}}');
      expect(result.ok).toBe(false);
    });

    it('rejects unknown action names', () => {
      const result = parseBrowserActionEnvelope('{"action":{"teleport":{"x":1}}}');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unsupported action');
      }
    });

    it('rejects click_element without a target', () => {
      const result = parseBrowserActionEnvelope('{"action":{"click_element":{}}}');
      expect(result.ok).toBe(false);
    });

    it('rejects non-object payloads', () => {
      const result = parseBrowserActionEnvelope('{"action":{"wait":"soon"}}');
      expect(result.ok).toBe(false);
    });

    it('rejects non-object responses', () => {
      const result = parseBrowserActionEnvelope('"just a string"');
      expect(result.ok).toBe(false);
    });

    it('rejects arrays as the top-level response', () => {
      const result = parseBrowserActionEnvelope('[]');
      expect(result.ok).toBe(false);
    });

    it('rejects wait without any timing field', () => {
      const result = parseBrowserActionEnvelope('{"action":{"wait":{}}}');
      expect(result.ok).toBe(false);
    });

    it('accepts all supported action names with a minimal valid payload', () => {
      const validPayloads: Record<string, Record<string, unknown>> = {
        wait: { milliseconds: 500 },
        wait_for_selector: { selector: 'body' },
        click_element: { id: 1 },
        input_text: { id: 1, text: 'hi' },
        press_key: { key: 'Enter' },
        scroll: { direction: 'down' },
        navigate: { url: 'https://example.com' },
        extract_text: {},
        done: { text: 'ok', success: true },
        ask_user: { question: 'q?' },
        refresh_page_state: {},
        screenshot_observe: {},
      };
      for (const actionName of SUPPORTED_ACTION_NAMES) {
        const payload = validPayloads[actionName];
        const result = parseBrowserActionEnvelope(JSON.stringify({ action: { [actionName]: payload } }));
        expect(result.ok).toBe(true);
      }
    });

    it('rejects click_element with negative ids', () => {
      const result = parseBrowserActionEnvelope('{"action":{"click_element":{"id":-1}}}');
      expect(result.ok).toBe(false);
    });

    it('rejects input_text without any target identifier', () => {
      const result = parseBrowserActionEnvelope(
        JSON.stringify({ action: { input_text: { text: 'hello' } } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('input_text');
      }
    });

    it('accepts input_text with a selector target', () => {
      const result = parseBrowserActionEnvelope(
        JSON.stringify({ action: { input_text: { text: 'hello', selector: '#search' } } }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.payload.text).toBe('hello');
        expect(result.envelope.payload.selector).toBe('#search');
      }
    });

    it('accepts input_text with backend_node_id target', () => {
      const result = parseBrowserActionEnvelope(
        JSON.stringify({ action: { input_text: { text: 'world', backend_node_id: 42 } } }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.payload.backend_node_id).toBe(42);
      }
    });
  });

  describe('parseBrowserActionEnvelopeWithRetry', () => {
    it('returns the same result for a successful parse', () => {
      const result = parseBrowserActionEnvelopeWithRetry(
        JSON.stringify({ action: { done: { text: 'ok', success: true } } }),
        0,
      );
      expect(result.ok).toBe(true);
    });

    it('marks the first malformed response as non-fatal', () => {
      const result = parseBrowserActionEnvelopeWithRetry('not json', 0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fatal).toBe(false);
      }
    });

    it('marks the second malformed response as fatal', () => {
      const result = parseBrowserActionEnvelopeWithRetry('still not json', 1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fatal).toBe(true);
      }
    });

    it('honours a custom fatalAfter threshold', () => {
      const result = parseBrowserActionEnvelopeWithRetry(
        'still not json',
        0,
        { malformedSoFar: 0, fatalAfter: 5 },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fatal).toBe(false);
      }
    });
  });
});
