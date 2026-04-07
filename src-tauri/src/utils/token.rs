/**
 * Shared token-count estimation used by both the HTTP client and the
 * compact / context-analysis subsystems.
 *
 * Rules (mirrors how most modern tokenizers treat Unicode):
 *   • CJK, Hangul, Hiragana/Katakana, Arabic → 1 token per character
 *   • Emoji / supplementary-plane characters   → 1 token per character
 *   • Everything else (ASCII + Latin)          → ~4 chars per token (ceiling)
 */
pub fn estimate_tokens(text: &str) -> i32 {
    let mut tokens = 0i32;
    let mut ascii_run = 0i32;
    for ch in text.chars() {
        let cp = ch as u32;
        let is_cjk_or_wide =
            (0x4E00..=0x9FFF).contains(&cp)   // CJK Unified Ideographs
            || (0x3400..=0x4DBF).contains(&cp) // CJK Extension A
            || (0xF900..=0xFAFF).contains(&cp) // CJK Compatibility
            || (0x3040..=0x30FF).contains(&cp) // Hiragana + Katakana
            || (0xAC00..=0xD7AF).contains(&cp) // Hangul Syllables
            || (0x0600..=0x06FF).contains(&cp) // Arabic
            || cp > 0xFFFF;                    // Emoji / supplementary planes
        if is_cjk_or_wide {
            tokens += (ascii_run + 3) / 4;
            ascii_run = 0;
            tokens += 1;
        } else {
            ascii_run += 1;
        }
    }
    tokens + (ascii_run + 3) / 4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_ceiling_division() {
        assert_eq!(estimate_tokens("abcd"), 1);  // exactly 4 chars → 1 token
        assert_eq!(estimate_tokens("abc"),  1);  // 3 chars → ceil(3/4)=1
        assert_eq!(estimate_tokens("abcde"), 2); // 5 chars → ceil(5/4)=2
    }

    #[test]
    fn cjk_one_token_each() {
        assert_eq!(estimate_tokens("你好"), 2); // 2 CJK → 2 tokens
    }

    #[test]
    fn mixed_text() {
        // "Hi " (3 ASCII) + "你" (1 CJK) + "!" (1 ASCII)
        // ASCII run "Hi " → ceil(3/4)=1, flush before CJK: tokens=1
        // CJK 你 → tokens=2
        // ASCII run "!" → ceil(1/4)=1 → tokens=3
        assert_eq!(estimate_tokens("Hi 你!"), 3);
    }
}
