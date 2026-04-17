/**
 * Skill execution commands
 *
 * Executes skills from src/skills/{category}/SKILL.md
 */

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Result type for skill execution
#[derive(Debug, Serialize, Deserialize)]
pub struct SkillResult {
    pub success: bool,
    #[serde(rename = "status")]
    pub status: Option<String>,
    #[serde(rename = "output")]
    pub output: Option<String>,
    #[serde(rename = "error")]
    pub error: Option<String>,
}

/// Frontmatter of a SKILL.md file
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: String,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    official: Option<bool>,
}

impl Default for SkillResult {
    fn default() -> Self {
        Self {
            success: false,
            status: None,
            output: None,
            error: None,
        }
    }
}

/**
 * Execute a skill by reading its SKILL.md file.
 *
 * Returns the skill content and metadata for the frontend to process.
 */
#[tauri::command]
#[allow(unused_variables)]
pub async fn execute_skill(
    #[allow(non_snake_case)] skillName: String,
    #[allow(non_snake_case)] workDir: Option<String>,
) -> Result<SkillResult, String> {
    // Validate skill name - only alphanumeric, dash, underscore allowed
    if !skillName.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Ok(SkillResult {
            success: false,
            error: Some(format!("Invalid skill name: {}", skillName)),
            ..Default::default()
        });
    }

    // Try multiple candidate base directories to handle different CWDs
    // (dev mode binary CWD varies: project root vs src-tauri vs app bundle)
    let candidate_bases: Vec<PathBuf> = {
        let mut bases = vec![
            // Relative: works if CWD is project root
            PathBuf::from("src/skills"),
            // Relative: works if CWD is src-tauri/
            PathBuf::from("../src/skills"),
            // Tauri-bundled skills dir (production bundle and dev src-tauri/)
            PathBuf::from("skills"),
            PathBuf::from("../skills"),
        ];
        // Also try relative to the binary location
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                bases.push(exe_dir.join("skills"));
                bases.push(exe_dir.join("../skills"));
                bases.push(exe_dir.join("../../src/skills"));
                bases.push(exe_dir.join("../../../src/skills"));
            }
        }
        bases
    };

    let name_variants = vec![
        skillName.clone(),
        skillName.replace('-', "_"),
    ];

    for base in &candidate_bases {
        for variant in &name_variants {
            let path = base.join(variant).join("SKILL.md");
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                return Ok(SkillResult {
                    success: true,
                    status: Some("inline".to_string()),
                    output: Some(content),
                    ..Default::default()
                });
            }
        }
    }

    Ok(SkillResult {
        success: false,
        error: Some(format!(
            "Skill '{}' not found. Searched in: {}",
            skillName,
            candidate_bases.iter()
                .map(|b| b.join(&skillName).join("SKILL.md").display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )),
        ..Default::default()
    })
}
