use std::sync::Arc;

use crate::commands::file::{
    create_directory_for_tool, read_file_for_tool, resolve_path as resolve_tool_path,
    write_file_for_tool,
};
use super::{ToolHandlerOutput, ToolMetadata, ToolRegistry};

pub(super) fn register_filesystem_tools(registry: &mut ToolRegistry) {
    // --- read_file ---
    registry.register(
        "read_file",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            read_file_for_tool(path, work_dir)
                .map(|result| ToolHandlerOutput::success(result.content))
                .map_err(|error| anyhow::anyhow!(error.message))
        }),
        ToolMetadata {
            name: "read_file".to_string(),
            description: "Read the contents of a file at the given path. Returns the file content as text. Use this to examine source code, configuration files, or any text file.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file to read"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- write_file ---
    registry.register(
        "write_file",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let content = args.get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: content"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            write_file_for_tool(path, content, work_dir)
                .map(ToolHandlerOutput::success)
                .map_err(|error| anyhow::anyhow!(error.message))
        }),
        ToolMetadata {
            name: "write_file".to_string(),
            description: "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories if needed.".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file"
                    }
                },
                "required": ["path", "content"],
                "additionalProperties": false,
            }),
        },
    );

    // --- list_files ---
    registry.register(
        "list_files",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let resolved = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;

            let dir = resolved.as_path();
            if !dir.exists() {
                return Err(anyhow::anyhow!("Path does not exist: {}", resolved.display()));
            }
            if !dir.is_dir() {
                return Err(anyhow::anyhow!("Path is not a directory: {}", resolved.display()));
            }

            let mut entries: Vec<String> = Vec::new();
            for entry in std::fs::read_dir(dir)
                .map_err(|e| anyhow::anyhow!("Cannot read directory '{}': {}", path, e))?
                .flatten()
            {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.path().is_dir();
                let prefix = if is_dir { "📁 " } else { "📄 " };
                entries.push(format!("{}{}", prefix, name));
            }
            entries.sort();
            Ok(ToolHandlerOutput::success(entries.join("\n")))
        }),
        ToolMetadata {
            name: "list_files".to_string(),
            description: "List files and directories in the given path. Returns a sorted list with directory indicators. Use this to explore project structure.".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list contents of"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- create_directory ---
    registry.register(
        "create_directory",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            create_directory_for_tool(path, work_dir)
                .map(ToolHandlerOutput::success)
                .map_err(|error| anyhow::anyhow!(error.message))
        }),
        ToolMetadata {
            name: "create_directory".to_string(),
            description: "Create a new directory at the given path. Creates parent directories as needed (like mkdir -p).".to_string(),
            is_read_only: false,
            is_concurrency_safe: false,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to create"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );

    // --- path_exists ---
    registry.register(
        "path_exists",
        Arc::new(|args| {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing required parameter: path"))?;
            let work_dir = args.get("work_dir").and_then(|v| v.as_str());
            let resolved = resolve_tool_path(path, work_dir)
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            let exists = resolved.exists();
            let is_dir = resolved.is_dir();
            let is_file = resolved.is_file();
            let kind = if is_dir { "directory" } else if is_file { "file" } else { "unknown" };
            Ok(ToolHandlerOutput::success(format!("{}: {} ({})", resolved.display(), exists, kind)))
        }),
        ToolMetadata {
            name: "path_exists".to_string(),
            description: "Check if a file or directory exists at the given path. Returns existence status and type (file/directory).".to_string(),
            is_read_only: true,
            is_concurrency_safe: true,
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to check for existence"
                    }
                },
                "required": ["path"],
                "additionalProperties": false,
            }),
        },
    );


}
