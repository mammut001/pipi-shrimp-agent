import fs from 'fs';

let file = fs.readFileSync('src-tauri/src/claude/http_client.rs', 'utf8');

file = file.replace(/pub fn merge_system_prompt\(user_prompt: Option<&str>, browser_connected: bool\)/g, "pub fn merge_system_prompt(user_prompt: Option<&str>, allow_browser_tools: bool)");
file = file.replace(/if browser_connected \{/g, "if allow_browser_tools {");

file = file.replace(/pub fn get_tools\(browser_connected: bool\)/g, "pub fn get_tools(allow_browser_tools: bool)");

file = file.replace(/browser_connected: bool/g, "allow_browser_tools: bool");
file = file.replace(/browser_connected/g, "allow_browser_tools");

fs.writeFileSync('src-tauri/src/claude/http_client.rs', file);
