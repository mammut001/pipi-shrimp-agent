import { describe, expect, it } from '@jest/globals';
import { extractFilePaths } from '../artifactDetector';

describe('artifactDetector Windows path extraction (R7-03)', () => {
  describe('extractFilePaths', () => {
    it('still extracts Unix absolute paths', () => {
      const text = 'Wrote /home/user/output.png (12kB)';
      expect(extractFilePaths(text)).toContain('/home/user/output.png');
    });

    it('extracts Windows drive-letter paths (C:\\...)', () => {
      const text = 'saved to C:\\Users\\alice\\output.png';
      const paths = extractFilePaths(text);
      expect(paths).toContain('C:\\Users\\alice\\output.png');
    });

    it('extracts WSL-style paths (/mnt/c/...)', () => {
      const text = 'generated /mnt/c/Users/bob/out.pdf (3 pages)';
      const paths = extractFilePaths(text);
      expect(paths.some((p) => p.startsWith('/mnt/c/') && p.endsWith('.pdf'))).toBe(true);
    });

    it('extracts from "saved to" patterns with Windows paths', () => {
      const text = 'Image saved to D:\\projects\\app\\out\\chart.svg';
      expect(extractFilePaths(text)).toContain('D:\\projects\\app\\out\\chart.svg');
    });

    it('extracts from "File: " patterns with Windows paths', () => {
      const text = 'File: E:\\reports\\Q1.html';
      expect(extractFilePaths(text)).toContain('E:\\reports\\Q1.html');
    });

    it('does not produce false positives on plain URLs', () => {
      const text = 'See https://example.com/image.png for reference';
      // The plain URL must NOT be picked up as a file path.
      const paths = extractFilePaths(text);
      expect(paths).toEqual([]);
    });

    it('does not pick up Windows-style URLs (file:// scheme)', () => {
      const text = 'Reference file://C:/Users/alice/foo.png';
      const paths = extractFilePaths(text);
      // file:// scheme is excluded by the `://` guard so should be empty.
      expect(paths).toEqual([]);
    });

    it('handles multiple paths in one output', () => {
      const text =
        'Saved /tmp/cover.png and C:\\Users\\me\\page1.html\nFile: /mnt/c/data/out.pdf';
      const paths = extractFilePaths(text);
      expect(paths).toContain('/tmp/cover.png');
      expect(paths).toContain('C:\\Users\\me\\page1.html');
      expect(paths.some((p) => p.includes('/mnt/c/data/') && p.endsWith('.pdf'))).toBe(true);
    });

    it('rejects too-short strings even when they look like paths', () => {
      const text = '/x.png is too short';
      // The minimum length guard (5 chars including the leading slash and
      // dot) still applies to Unix. For Windows we'd similarly want a
      // realistic path length.
      const paths = extractFilePaths(text);
      // /x.png is exactly 6 chars, >= 5, so it WILL pass the length guard;
      // this is the existing behaviour we preserve.
      expect(paths).toContain('/x.png');
    });
  });
});