use once_cell::sync::Lazy;
use regex::Regex;

use crate::claude::message::Artifact;

static ARTIFACT_CODE_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"```(\w+)?\n([\s\S]*?)\n```").unwrap());
static ARTIFACT_HTML_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<html[\s\S]*?</html>").unwrap());
static ARTIFACT_MERMAID_REGEX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"```mermaid\n([\s\S]*?)\n```").unwrap());

pub fn detect_artifacts(content: &str) -> Vec<Artifact> {
    let mut artifacts = Vec::new();

    for captures in ARTIFACT_CODE_REGEX.captures_iter(content) {
        let language = captures.get(1).map_or("plaintext", |value| value.as_str());
        let code = captures.get(2).map_or("", |value| value.as_str());
        if code.len() > 200 {
            artifacts.push(Artifact {
                artifact_type: "code".to_string(),
                content: code.to_string(),
                title: Some(format!("{} code", language)),
                language: Some(language.to_string()),
            });
        }
    }

    if content.contains("<!DOCTYPE") || content.contains("<html") {
        if let Some(html_match) = ARTIFACT_HTML_REGEX.find(content) {
            artifacts.push(Artifact {
                artifact_type: "html".to_string(),
                content: html_match.as_str().to_string(),
                title: Some("HTML Document".to_string()),
                language: None,
            });
        }
    }

    for captures in ARTIFACT_MERMAID_REGEX.captures_iter(content) {
        if let Some(diagram) = captures.get(1) {
            artifacts.push(Artifact {
                artifact_type: "mermaid".to_string(),
                content: diagram.as_str().to_string(),
                title: Some("Diagram".to_string()),
                language: None,
            });
        }
    }

    artifacts
}
