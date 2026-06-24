import { describe, expect, it } from '@jest/globals';
import { isAllowedImageSrc } from '../ChatImage';

describe('ChatImage src scheme allowlist (R7-09)', () => {
  describe('isAllowedImageSrc', () => {
    it('rejects javascript: URLs', () => {
      expect(isAllowedImageSrc('javascript:alert(1)')).toBe(false);
    });

    it('rejects vbscript: URLs', () => {
      expect(isAllowedImageSrc('vbscript:msgbox(1)')).toBe(false);
    });

    it('rejects file: URLs', () => {
      expect(isAllowedImageSrc('file:///etc/passwd')).toBe(false);
    });

    it('rejects data:text/html smuggling SVG payloads', () => {
      expect(isAllowedImageSrc('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('rejects data: URLs without image MIME', () => {
      expect(isAllowedImageSrc('data:application/octet-stream;base64,XYZ')).toBe(false);
    });

    it('allows http: URLs', () => {
      expect(isAllowedImageSrc('http://example.com/img.png')).toBe(true);
    });

    it('allows https: URLs', () => {
      expect(isAllowedImageSrc('https://example.com/img.png')).toBe(true);
    });

    it('allows data:image/* URLs', () => {
      expect(isAllowedImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
      expect(isAllowedImageSrc('data:image/svg+xml;charset=utf-8,<svg/>')).toBe(true);
    });

    it('allows tauri: asset URLs', () => {
      expect(isAllowedImageSrc('tauri://localhost/some.png')).toBe(true);
    });

    it('allows blob: URLs', () => {
      expect(isAllowedImageSrc('blob:https://example.com/abc-uuid')).toBe(true);
    });

    it('allows relative paths', () => {
      expect(isAllowedImageSrc('/img/foo.png')).toBe(true);
      expect(isAllowedImageSrc('./foo.png')).toBe(true);
    });

    it('allows bare URLs without scheme', () => {
      expect(isAllowedImageSrc('foo.png')).toBe(true);
    });

    it('rejects empty / whitespace-only', () => {
      expect(isAllowedImageSrc('')).toBe(false);
      expect(isAllowedImageSrc('   ')).toBe(false);
    });

    it('case-insensitive scheme matching', () => {
      expect(isAllowedImageSrc('JAVASCRIPT:alert(1)')).toBe(false);
      expect(isAllowedImageSrc('JaVaScRiPt:alert(1)')).toBe(false);
      expect(isAllowedImageSrc('HTTPS://example.com/x.png')).toBe(true);
    });
  });
});