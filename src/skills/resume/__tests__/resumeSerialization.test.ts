import { describe, expect, it } from '@jest/globals';
import {
  escapeTypstContent,
  escapeTypstString,
  normalizeResumeUrl,
  toTomlArray,
  toTomlString,
} from '../resumeSerialization';

describe('resume serialization helpers', () => {
  it('escapes typst strings for email, quotes, backslashes, multiline content, and Chinese text', () => {
    expect(escapeTypstString('user@example.com')).toBe('user\\@example.com');
    expect(escapeTypstString('Jane "JJ" Doe')).toBe('Jane \\"JJ\\" Doe');
    expect(escapeTypstString('C:\\Users\\resume')).toBe('C:\\\\Users\\\\resume');
    expect(escapeTypstString('第一行\n第二行')).toBe('第一行\\n第二行');
    expect(escapeTypstString('中文内容')).toBe('中文内容');
  });

  it('escapes typst content control characters without stripping user-visible text', () => {
    expect(escapeTypstContent('#[AI]*_ roadmap')).toBe('\\#\\[AI\\]\\*\\_ roadmap');
    expect(escapeTypstContent('https://example.com/path')).toBe('https://example.com/path');
    expect(escapeTypstContent('联系邮箱 user@example.com')).toBe('联系邮箱 user\\@example.com');
  });

  it('serializes toml strings and arrays deterministically', () => {
    expect(toTomlString('user@example.com')).toBe('"user@example.com"');
    expect(toTomlString('Jane "JJ" Doe')).toBe('"Jane \\"JJ\\" Doe"');
    expect(toTomlString('第一行\n第二行')).toBe('"第一行\\n第二行"');
    expect(toTomlArray(['Python', 'React', '中文'])).toBe('["Python", "React", "中文"]');
  });

  it('normalizes common resume URLs while leaving explicit schemes intact', () => {
    expect(normalizeResumeUrl('github.com/octocat')).toBe('https://github.com/octocat');
    expect(normalizeResumeUrl('linkedin.com/in/example')).toBe('https://linkedin.com/in/example');
    expect(normalizeResumeUrl('https://example.com/portfolio')).toBe('https://example.com/portfolio');
    expect(normalizeResumeUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
  });
});