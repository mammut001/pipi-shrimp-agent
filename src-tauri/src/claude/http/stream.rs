pub use super::super::stream_parser::{parse_plain_response, parse_sse_data_line, stream_response, ThinkSegmentIter};

pub fn collect_sse_data_lines(buffer: &mut Vec<u8>, chunk: &[u8]) -> Vec<String> {
    let mut lines = Vec::new();
    buffer.extend_from_slice(chunk);

    while let Some(newline_pos) = buffer.iter().position(|&byte| byte == b'\n') {
        let line_bytes = buffer.drain(..=newline_pos).collect::<Vec<u8>>();
        let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
        if let Some(data) = parse_sse_data_line(&line) {
            lines.push(data);
        }
    }

    lines
}

pub fn split_think_content(content: &str, in_think: &mut bool) -> Vec<(String, bool)> {
    super::super::stream_parser::split_think_content(content, in_think)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_complete_sse_data_lines_from_chunk_buffer() {
        let mut buffer = Vec::new();
        let first = collect_sse_data_lines(&mut buffer, b"data: first\npartial");
        assert_eq!(first, vec!["first".to_string()]);
        let second = collect_sse_data_lines(&mut buffer, b" line\ndata: second\n");
        assert_eq!(second, vec!["second".to_string()]);
    }

    #[test]
    fn routes_inline_think_tags_between_reasoning_and_text() {
        let mut in_think = false;
        assert_eq!(
            split_think_content("hello<think>secret</think>world", &mut in_think),
            vec![
                ("hello".to_string(), false),
                ("secret".to_string(), true),
                ("world".to_string(), false),
            ],
        );
    }
}
