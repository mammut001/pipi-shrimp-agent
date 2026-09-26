use std::collections::HashSet;

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

When browser tools are available:
- If the user asks to browse, open a site, search the web, interact with a page, click, type, fill forms, or summarize webpage content, use browser tools.
- Do not claim you cannot access or control Chrome unless a browser tool actually fails.
- Start with `browser_navigate` for URLs or search engines.
- Use `browser_get_page` before clicking or typing so you can identify element IDs.
- Use `browser_click` and `browser_type` with element_id/backend_node_id/navigation_id from `browser_get_page`.
- After every action, observe again with `browser_get_page`, `browser_get_text`, or `browser_extract_content`.
- For search tasks, navigate to a search engine, type the query, press Enter, wait, then extract content.
- Report actual results from the page, not hypothetical instructions.
"#;

const WINDOWS_SHELL_GUIDE: &str = r#"
## Windows Shell Guidance

On Windows, use the configured shell profile. Auto uses PowerShell for Windows workspaces and WSL only for WSL/Linux workspaces. Use PowerShell for npm, Cargo, Tauri Windows builds, and Windows paths. Use WSL only when the user explicitly selected WSL, the workspace is inside WSL, or the command requires a Unix shell. Do not mix PowerShell and WSL dependency installs or build artifacts in the same workspace.
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
    base_prompt.push_str(&format!("\n\n{}", WINDOWS_SHELL_GUIDE.trim()));

    match user_prompt {
        Some(user) if !user.is_empty() => format!(
            "{}\n\n---\n\n## User-Provided Instructions\n\n{}",
            base_prompt,
            user.trim()
        ),
        _ => base_prompt,
    }
}

fn strict_paper_reference_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "source": { "type": "string" },
            "title": { "type": "string" },
            "authors": { "type": "array", "items": { "type": "string" } },
            "year": { "type": "number" },
            "venue": { "type": "string" },
            "filePath": { "type": "string" },
            "originalUrl": { "type": "string" },
            "abstract": { "type": "string" },
            "citationKey": { "type": "string" }
        },
        "required": ["source", "title"],
        "additionalProperties": false
    })
}

fn strict_bootstrap_finalize_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "researchGoal": { "type": "string" },
            "successCriteria": { "type": "string" },
            "primaryMetric": { "type": "string" },
            "secondaryMetrics": { "type": "array", "items": { "type": "string" } },
            "papers": {
                "type": "array",
                "items": strict_paper_reference_schema()
            },
            "baselines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "paper": strict_paper_reference_schema(),
                        "task": { "type": "string" },
                        "dataset": { "type": "string" },
                        "reportedMetrics": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "value": { "type": "number" },
                                    "unit": { "type": "string" }
                                },
                                "required": ["name", "value"],
                                "additionalProperties": false
                            }
                        },
                        "method": {
                            "type": "object",
                            "properties": {
                                "summary": { "type": "string" },
                                "keyHyperparams": {
                                    "type": "string",
                                    "description": "Optional JSON object string of hyperparameters"
                                }
                            },
                            "required": ["summary"],
                            "additionalProperties": false
                        },
                        "reproducibility": {
                            "type": "object",
                            "properties": {
                                "hasOfficialCode": { "type": "boolean" },
                                "repoUrl": { "type": "string" },
                                "notes": { "type": "string" }
                            },
                            "required": ["hasOfficialCode"],
                            "additionalProperties": false
                        }
                    },
                    "required": ["name", "task", "dataset", "reportedMetrics", "method", "reproducibility"],
                    "additionalProperties": false
                }
            },
            "scaffold": {
                "type": "object",
                "properties": {
                    "templateId": { "type": "string", "enum": ["python-ml-baseline", "node-eval-harness"] },
                    "workDir": { "type": "string" },
                    "language": { "type": "string" },
                    "entryCommand": { "type": "string" },
                    "vars": {
                        "type": "object",
                        "properties": {
                            "project_name": { "type": "string" },
                            "research_goal": { "type": "string" },
                            "success_criteria": { "type": "string" },
                            "primary_metric": { "type": "string" },
                            "baseline_name": { "type": "string" },
                            "dataset_name": { "type": "string" },
                            "train_command": { "type": "string" },
                            "eval_command": { "type": "string" },
                            "requirements_extra": { "type": "string" },
                            "node_eval_command": { "type": "string" }
                        },
                        "additionalProperties": false
                    },
                    "files": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string" },
                                "purpose": { "type": "string" }
                            },
                            "required": ["path", "purpose"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["templateId", "workDir", "language", "entryCommand", "vars", "files"],
                "additionalProperties": false
            },
            "gitInitialized": { "type": "boolean" },
            "initialCommitSha": { "type": "string" },
            "conversationalTemplateId": { "type": "string", "enum": ["reproduce-paper", "beat-baseline", "ablation", "from-scratch"] }
        },
        "required": ["researchGoal", "successCriteria", "primaryMetric", "papers", "baselines", "scaffold", "gitInitialized", "conversationalTemplateId"],
        "additionalProperties": false
    })
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
            "description": "Execute a shell command in the terminal. On Windows, Auto uses PowerShell for Windows workspaces and WSL only for WSL/Linux workspaces. Use PowerShell for npm, Cargo, and Tauri Windows builds, and do not mix PowerShell and WSL build artifacts in the same workspace.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "cwd": { "type": "string" },
                    "windowsShellProfile": {
                        "type": "string",
                        "enum": ["auto", "powershell", "wsl"]
                    }
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
            "description": "Upload a local file or inline content to the target. Provide exactly one of localPath or content (not both). In local mode this becomes a direct local copy; in ssh mode it uses SCP semantics.",
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
            "name": "pdf_read",
            "description": "Read and extract plain text from a local PDF file path.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "paper_extract_meta",
            "description": "Extract structured paper metadata from grounded source text. Return JSON-only metadata.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" }
                },
                "required": ["text"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "baseline_extract",
            "description": "Extract baseline methods and reported metrics from grounded paper text. Return JSON-only baselines.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" }
                },
                "required": ["text"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "arxiv_search",
            "description": "Search arXiv and return a small list of relevant paper metadata.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "number" }
                },
                "required": ["query"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "scaffold_generate",
            "description": "Generate a deterministic AutoResearch scaffold into the requested workDir using a known template.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "templateId": { "type": "string", "enum": ["python-ml-baseline", "node-eval-harness"] },
                    "workDir": { "type": "string" },
                    "researchGoal": { "type": "string" },
                    "successCriteria": { "type": "string" },
                    "primaryMetric": { "type": "string" },
                    "baselineName": { "type": "string" },
                    "datasetName": { "type": "string" },
                    "projectName": { "type": "string" }
                },
                "required": ["templateId", "workDir", "researchGoal", "successCriteria", "primaryMetric"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "git_init_workdir",
            "description": "Initialize a Git repository in the specified workDir and create the initial commit.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "workDir": { "type": "string" }
                },
                "required": ["workDir"],
                "additionalProperties": false
            }
        }),
        serde_json::json!({
            "name": "bootstrap_finalize",
            "description": "Validate and persist the final AutoResearch bootstrap plan. Returns a structured bootstrap result.",
            "input_schema": strict_bootstrap_finalize_schema()
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
        serde_json::json!({
            "name": "test_barrier_tool",
            "description": "Harness tool (Manual D / live soak): block until release_test_barrier(barrier_id) or cancel_tool_execution(executionId). Not for production agent use.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "barrier_id": {
                        "type": "string",
                        "description": "Barrier identifier shared with release_test_barrier."
                    },
                    "barrierId": {
                        "type": "string",
                        "description": "CamelCase alias for barrier_id."
                    }
                },
                "required": ["barrier_id"],
                "additionalProperties": false
            }
        }),
    ];

    if allow_browser_tools {
        tools.extend(get_browser_tools());
    }

    tools
}

pub fn filter_tools_by_allowed_names(
    tools: &[Value],
    allowed_tools: Option<&[String]>,
) -> Vec<Value> {
    let Some(allowed_tools) = allowed_tools else {
        return tools.to_vec();
    };

    let allowed: HashSet<&str> = allowed_tools.iter().map(String::as_str).collect();
    tools
        .iter()
        .filter(|tool| {
            tool.get("name")
                .and_then(|value| value.as_str())
                .or_else(|| {
                    tool.get("function")
                        .and_then(|value| value.get("name"))
                        .and_then(|value| value.as_str())
                })
                .map(|name| allowed.contains(name))
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

pub fn apply_allowed_tools_to_body(body: &mut Value, allowed_tools: Option<&[String]>) {
    let Some(existing_tools) = body.get("tools").and_then(|value| value.as_array()) else {
        return;
    };

    body["tools"] = Value::Array(filter_tools_by_allowed_names(existing_tools, allowed_tools));
}

pub fn convert_tools_to_openai_format(tools: &[Value], strict: bool) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            let mut function_val = serde_json::json!({
                "name": tool["name"].clone(),
                "description": tool["description"].clone(),
                "parameters": tool.get("input_schema").cloned().unwrap_or_else(|| serde_json::json!({"type":"object","properties":{}})),
            });
            if strict {
                if let Some(obj) = function_val.as_object_mut() {
                    obj.insert("strict".to_string(), Value::Bool(true));
                }
            }
            serde_json::json!({
                "type": "function",
                "function": function_val,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
