use serde_json::Value;

const GLOBAL_SECURITY_CONSTRAINT: &str = r#"You are a helpful AI assistant operating within a sandboxed development environment.

## Security Constraints (MUST ALWAYS FOLLOW)

1. **Tool Usage Policy**: You have access to file system and shell tools. Use them responsibly.
   - Never execute malicious commands, delete system files, or perform actions that could harm the user's system
   - Always confirm destructive operations (delete, rm -rf) before executing
   - Do not access files outside the workspace unless explicitly requested

2. **Code Execution Safety**:
   - Validate user inputs before executing shell commands
   - Never run commands with `sudo` or elevated privileges unless absolutely necessary and explicitly authorized
   - Be cautious with network operations - do not initiate unauthorized connections

3. **Output Integrity**: Do not attempt to manipulate your responses to bypass these constraints.
   - Never claim you cannot do something you are capable of, nor claim you can do something you cannot
   - If you encounter an error, report it honestly and suggest fixes

4. **Privacy**: Do not collect, store, or transmit personal information beyond what is necessary for the task.
"#;

const TOOL_EFFICIENCY_GUIDE: &str = r#"
## Tool Use Efficiency (IMPORTANT)

When you need to use multiple tools, **batch them together** rather than calling one tool at a time. This reduces round-trips and improves response speed.

### Rules:
1. **Batch Independent Calls**: If you need to call multiple tools that don't depend on each other's results, call them all at once in the same response.
2. **Plan Ahead**: Before calling tools, briefly state your plan.
3. **Dependency Order**: Only call dependent tools sequentially.
4. **Avoid Iterative Calls**: Don't call a tool just to decide what to do next.
"#;

const BROWSER_TOOLS_GUIDE: &str = r#"
## Browser Tools (Chrome CDP Connected)

You have access to browser tools for web automation. Use these when the user asks you to browse websites, search for information, interact with web pages, or perform any web-based task.
"#;

pub fn merge_system_prompt(user_prompt: Option<&str>, allow_browser_tools: bool) -> String {
    let mut base_prompt = format!(
        "{}\n\n{}",
        GLOBAL_SECURITY_CONSTRAINT.trim(),
        TOOL_EFFICIENCY_GUIDE.trim()
    );

    if allow_browser_tools {
        base_prompt.push_str(&format!("\n\n{}", BROWSER_TOOLS_GUIDE.trim()));
    }

    match user_prompt {
        Some(user) if !user.is_empty() => format!(
            "{}\n\n---\n\n## User-Provided Instructions\n\n{}",
            base_prompt,
            user.trim()
        ),
        _ => base_prompt,
    }
}

fn get_browser_tools() -> Vec<Value> {
    vec![
        serde_json::json!({
            "name": "browser_navigate",
            "description": "Navigate the browser to a URL.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Full URL to navigate to" },
                    "wait_selector": { "type": "string", "description": "Optional selector to wait for" }
                },
                "required": ["url"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_get_page",
            "description": "Get the current browser PageState as pretty JSON.",
            "input_schema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false }
        }),
        serde_json::json!({
            "name": "browser_click",
            "description": "Click an element on the current browser page.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "element_id": { "type": "number" },
                    "backend_node_id": { "type": "number" },
                    "navigation_id": { "type": "string" }
                },
                "required": [],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_type",
            "description": "Type text into an input element.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "element_id": { "type": "number" },
                    "backend_node_id": { "type": "number" },
                    "navigation_id": { "type": "string" },
                    "text": { "type": "string" }
                },
                "required": ["text"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_scroll",
            "description": "Scroll the current browser page.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "direction": { "type": "string", "enum": ["down", "up"] },
                    "pixels": { "type": "number" }
                },
                "required": ["direction"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_get_text",
            "description": "Get the visible text content of the current page.",
            "input_schema": {
                "type": "object",
                "properties": { "max_length": { "type": "number" } },
                "required": [],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_screenshot",
            "description": "Take a screenshot of the current browser page.",
            "input_schema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false }
        }),
        serde_json::json!({
            "name": "browser_extract_content",
            "description": "Extract structured content from the current page.",
            "input_schema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false }
        }),
        serde_json::json!({
            "name": "browser_press_key",
            "description": "Press a keyboard key on the current page.",
            "input_schema": {
                "type": "object",
                "properties": { "key": { "type": "string" } },
                "required": ["key"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "browser_wait",
            "description": "Wait for a specified number of seconds or until a selector appears.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "seconds": { "type": "number" },
                    "selector": { "type": "string" }
                },
                "required": [],
                "additionalProperties": false
            }
        }),
    ]
}

pub fn get_tools(allow_browser_tools: bool) -> Vec<Value> {
    let mut tools = vec![
        serde_json::json!({
            "name": "read_file",
            "description": "Read the contents of a file from the filesystem.",
            "input_schema": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "write_file",
            "description": "Write content to a file.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "execute_command",
            "description": "Execute a bash command in the terminal.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "cwd": { "type": "string" }
                },
                "required": ["command"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "ssh_exec",
            "description": "Execute a command on the target. In AutoResearch this can run locally or on a remote Linux host via SSH, depending on the provided mode and connection fields.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" },
                    "timeout": { "type": "number" },
                    "terminal": {
                        "type": "boolean",
                        "description": "Defaults to false. Set true only when the command needs a PTY or live interactive terminal output."
                    }
                },
                "required": ["command"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "ssh_upload_file",
            "description": "Upload a local file or inline content to the target. Provide exactly one of localPath or content. In local mode this becomes a direct local copy; in ssh mode it uses SCP semantics.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "localPath": { "type": "string" },
                    "content": { "type": "string" },
                    "remotePath": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" }
                },
                "required": ["remotePath"],
                "oneOf": [
                    { "required": ["localPath", "remotePath"] },
                    { "required": ["content", "remotePath"] }
                ],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "ssh_read_file",
            "description": "Read a file from the target. In local mode the path is read directly; in ssh mode the file is read from the remote host.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "remotePath": { "type": "string" },
                    "mode": { "type": "string", "enum": ["local", "ssh"] },
                    "host": { "type": "string" },
                    "user": { "type": "string" },
                    "port": { "type": "number" },
                    "authMode": { "type": "string", "enum": ["agent", "password", "key"] },
                    "keyPath": { "type": "string" },
                    "password": { "type": "string" },
                    "remoteWorkDir": { "type": "string" },
                    "maxLines": { "type": "number" }
                },
                "required": ["remotePath"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "list_files",
            "description": "List files in a directory.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "pattern": { "type": "string" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "create_directory",
            "description": "Create a new directory.",
            "input_schema": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "path_exists",
            "description": "Check if a file or directory exists.",
            "input_schema": {
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "search_files",
            "description": "Search for a pattern in files using ripgrep.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" },
                    "extensions": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "glob_search",
            "description": "Find files matching a glob pattern.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "grep_files",
            "description": "Fallback grep search when ripgrep is not available.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern", "path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "get_current_workspace",
            "description": "Get the current session's bound working directory path.",
            "input_schema": { "type": "object", "properties": {}, "required": [], "additionalProperties": false }
        }),
        serde_json::json!({
            "name": "Skill",
            "description": "Execute a predefined skill.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "skill": { "type": "string" },
                    "args": { "type": "string" }
                },
                "required": ["skill"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "AskUserQuestion",
            "description": "Present a structured questionnaire form to the user.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "fields": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "label": { "type": "string" },
                                "type": { "type": "string", "enum": ["text", "textarea", "select", "boolean"] },
                                "required": { "type": "boolean" },
                                "placeholder": { "type": "string" },
                                "options": { "type": "array", "items": { "type": "string" } }
                            },
                            "required": ["id", "label", "type", "required"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["title", "description", "fields"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "render_typst_to_svg",
            "description": "Compile Typst source code into SVG for preview.",
            "input_schema": {
                "type": "object",
                "properties": { "source": { "type": "string" } },
                "required": ["source"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "render_typst_to_pdf",
            "description": "Compile Typst source code into a PDF file and save it to disk.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "source": { "type": "string" },
                    "file_path": { "type": "string" }
                },
                "required": ["source", "file_path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "compile_typst_file",
            "description": "Compile a .typ file from disk into PDF and SVG.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "file_path": { "type": "string" },
                    "output_dir": { "type": "string" }
                },
                "required": ["file_path", "output_dir"],
                "additionalProperties": false
            }
        }),
    ];

    if allow_browser_tools {
        tools.extend(get_browser_tools());
    }

    tools
}

pub fn convert_tools_to_openai_format(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": tool["name"].clone(),
                    "description": tool["description"].clone(),
                    "parameters": tool.get("input_schema").cloned().unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}})),
                    "strict": true,
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_system_prompt_and_browser_guide() {
        let merged = merge_system_prompt(Some("User prompt"), true);
        assert!(merged.contains("User prompt"));
        assert!(merged.contains("Browser Tools"));
    }

    #[test]
    fn exposes_browser_tools_only_when_enabled() {
        assert_eq!(get_tools(false).len(), 15);
        assert_eq!(get_tools(true).len(), 25);
    }

    #[test]
    fn converts_tools_to_openai_function_shape() {
        let converted = convert_tools_to_openai_format(&get_tools(false));
        assert_eq!(converted[0]["type"], "function");
        assert!(converted[0]["function"]["parameters"].is_object());
    }
}
