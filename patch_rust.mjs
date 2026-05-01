import fs from 'fs';

// patch adapter.rs
let file = fs.readFileSync('src-tauri/src/claude/adapter.rs', 'utf8');
file = file.replace(/browser_connected/g, "allow_browser_tools");
fs.writeFileSync('src-tauri/src/claude/adapter.rs', file);

// patch lib.rs - it's where the Tauri command takes args
file = fs.readFileSync('src-tauri/src/lib.rs', 'utf8');
file = file.replace(/browserConnected/g, "allowBrowserTools");
file = file.replace(/browser_connected/g, "allow_browser_tools");
fs.writeFileSync('src-tauri/src/lib.rs', file);
