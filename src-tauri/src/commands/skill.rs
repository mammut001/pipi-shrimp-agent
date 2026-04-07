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

    // Build path to SKILL.md - skillName maps to subdirectory under src/skills/
    let mut skill_path = PathBuf::from("src/skills");
    skill_path.push(&skillName);
    skill_path.push("SKILL.md");

    // Read the skill file
    match tokio::fs::read_to_string(&skill_path).await {
        Ok(content) => {
            // Return the skill content for frontend to process
            // Frontend will handle actual skill execution logic
            Ok(SkillResult {
                success: true,
                status: Some("inline".to_string()),
                output: Some(content),
                ..Default::default()
            })
        }
        Err(e) => {
            // Try common variations
            let skill_path_with_underscore = PathBuf::from("src/skills")
                .join(&skillName.replace('-', "_"))
                .join("SKILL.md");

            if let Ok(content) = tokio::fs::read_to_string(&skill_path_with_underscore).await {
                return Ok(SkillResult {
                    success: true,
                    status: Some("inline".to_string()),
                    output: Some(content),
                    ..Default::default()
                });
            }

            Ok(SkillResult {
                success: false,
                error: Some(format!("Skill '{}' not found at {:?}: {}", skillName, skill_path, e)),
                ..Default::default()
            })
        }
    }
}
