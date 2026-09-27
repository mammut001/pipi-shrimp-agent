import { describe, expect, it } from '@jest/globals';
import { deriveSessionTitle, isDefaultSessionTitle } from '../sessionTitle';

describe('session titles', () => {
  it('only treats app-assigned titles as replaceable', () => {
    expect(isDefaultSessionTitle('Chat 1')).toBe(true);
    expect(isDefaultSessionTitle('Chat 12')).toBe(true);
    expect(isDefaultSessionTitle('')).toBe(true);
    expect(isDefaultSessionTitle('Chat about Rust')).toBe(false);
    expect(isDefaultSessionTitle('我的项目')).toBe(false);
  });

  it('uses the first meaningful line without markdown noise', () => {
    expect(deriveSessionTitle('  帮我看看 **Cargo.toml**  依赖\n第二行')).toBe('帮我看看 Cargo.toml 依赖');
    expect(deriveSessionTitle('```rust\nfn main() {}\n```\n## Fix the build')).toBe('Fix the build');
    expect(deriveSessionTitle('- list item')).toBe('list item');
    expect(deriveSessionTitle('   \n\n')).toBeNull();
  });

  it('shortens long openers by characters, not bytes', () => {
    expect(deriveSessionTitle('一'.repeat(40))).toBe(`${'一'.repeat(30)}…`);
    expect(deriveSessionTitle('a'.repeat(30))).toBe('a'.repeat(30));
  });
});
