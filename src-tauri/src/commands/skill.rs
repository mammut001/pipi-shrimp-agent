use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/**
 * Skill execution commands.
 *
 * Skills are real SKILL.md packages. The frontend never maintains a shadow
 * catalog: it asks this module what is actually available and reads the same
 * file that execution uses.
 */

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SkillResult {
    pub success: bool,
    pub status: Option<String>,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SkillFrontmatter {
    name: String,
    description: String,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    official: Option<bool>,
}

fn candidate_skill_bases() -> Vec<PathBuf> {
    let mut bases = vec![
        // Development from repository root.
        PathBuf::from("src/skills"),
        PathBuf::from("src-tauri/skills"),
        // Development when CWD is src-tauri/ or a nested harness directory.
        PathBuf::from("../src/skills"),
        PathBuf::from("../src-tauri/skills"),
        // Bundled production resources.
        PathBuf::from("skills"),
        PathBuf::from("../skills"),
    ];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            bases.push(exe_dir.join("skills"));
            bases.push(exe_dir.join("../skills"));
            bases.push(exe_dir.join("../../src/skills"));
            bases.push(exe_dir.join("../../../src/skills"));
            bases.push(exe_dir.join("../../src-tauri/skills"));
            bases.push(exe_dir.join("../../../src-tauri/skills"));
        }
    }

    bases
}

fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

fn trim_frontmatter_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

fn parse_skill_summary(directory_name: &str, content: &str, source: &Path) -> SkillSummary {
    let mut name = directory_name.to_string();
    let mut description = String::new();

    let mut lines = content.lines();
    if matches!(lines.next().map(str::trim), Some("---")) {
        for line in lines {
            let trimmed = line.trim();
            if trimmed == "---" {
                break;
            }
            if let Some(value) = trimmed.strip_prefix("name:") {
                let parsed = trim_frontmatter_value(value);
                if !parsed.is_empty() {
                    name = parsed;
                }
            } else if let Some(value) = trimmed.strip_prefix("description:") {
                description = trim_frontmatter_value(value);
            }
        }
    }

    if description.is_empty() {
        description = content
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with('#') && *line != "---")
            .unwrap_or("Reusable runtime skill")
            .chars()
            .take(180)
            .collect();
    }

    SkillSummary {
        name,
        description,
        source: source.display().to_string(),
    }
}

async fn find_skill_file(skill_name: &str) -> Option<PathBuf> {
    let name_variants = [skill_name.to_string(), skill_name.replace('-', "_")];
    for base in candidate_skill_bases() {
        for variant in &name_variants {
            let path = base.join(variant).join("SKILL.md");
            if tokio::fs::metadata(&path).await.is_ok() {
                return Some(path);
            }
        }
    }
    None
}

/**
 * Return the catalog that is actually executable on this installation.
 * Duplicate skill folders are collapsed by directory name; the first
 * candidate base wins, matching execute_skill's lookup precedence.
 */
#[tauri::command]
pub async fn list_skills() -> Result<Vec<SkillSummary>, String> {
    let mut found: BTreeMap<String, SkillSummary> = BTreeMap::new();

    for base in candidate_skill_bases() {
        let mut entries = match tokio::fs::read_dir(&base).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("Failed to scan skills in {}: {error}", base.display()))?
        {
            let file_type = match entry.file_type().await {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if !file_type.is_dir() {
                continue;
            }

            let directory_name = entry.file_name().to_string_lossy().to_string();
            if !is_valid_skill_name(&directory_name) || found.contains_key(&directory_name) {
                continue;
            }

            let skill_file = entry.path().join("SKILL.md");
            let content = match tokio::fs::read_to_string(&skill_file).await {
                Ok(content) => content,
                Err(_) => continue,
            };

            found.insert(
                directory_name.clone(),
                parse_skill_summary(&directory_name, &content, &skill_file),
            );
        }
    }

    Ok(found.into_values().collect())
}

/**
 * Load a real skill and optionally bind a concrete runtime task to it.
 *
 * No write/delete capability is exposed here: Skill execution remains a
 * read-only load of SKILL.md. Any side effects happen later through the
 * chat execution mode/tool policy where approvals and Danger harness rules
 * are enforced.
 */
#[tauri::command]
#[allow(non_snake_case)]
pub async fn execute_skill(
    skillName: String,
    args: Option<String>,
    workDir: Option<String>,
) -> Result<SkillResult, String> {
    if !is_valid_skill_name(&skillName) {
        return Ok(SkillResult {
            success: false,
            error: Some(format!("Invalid skill name: {skillName}")),
            ..Default::default()
        });
    }

    let Some(path) = find_skill_file(&skillName).await else {
        return Ok(SkillResult {
            success: false,
            error: Some(format!(
                "Skill '{}' not found. Searched executable skill directories.",
                skillName
            )),
            ..Default::default()
        });
    };

    let mut content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;

    if let Some(work_dir) = workDir.filter(|value| !value.trim().is_empty()) {
        content.push_str("\n\n# Runtime context\nWorking directory: `");
        content.push_str(work_dir.trim());
        content.push_str("`");
    }

    if let Some(task) = args.filter(|value| !value.trim().is_empty()) {
        content.push_str("\n\n# Runtime task\n");
        content.push_str(task.trim());
    }

    Ok(SkillResult {
        success: true,
        status: Some("inline".to_string()),
        output: Some(content),
        ..Default::default()
    })
}
