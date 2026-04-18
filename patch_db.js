const fs = require('fs');

// 1. Update database.rs
let dbContents = fs.readFileSync('src-tauri/src/database.rs', 'utf8');

// Add to DbMessage struct
dbContents = dbContents.replace(
    /pub tool_calls: Option<String>, \/\/ JSON-serialized Vec<ToolCall>\n    pub created_at: i64,/g,
    'pub tool_calls: Option<String>, // JSON-serialized Vec<ToolCall>\n    pub token_usage: Option<String>,\n    pub created_at: i64,'
);

// Add to row_to_message
dbContents = dbContents.replace(
    /tool_calls: row\.get\(6\)\?,\n        created_at: row\.get\(7\)\?,/g,
    'tool_calls: row.get(6)?,\n        token_usage: row.get(7)?,\n        created_at: row.get(8)?,'
);

// Add migration
dbContents = dbContents.replace(
    /LATEST_VERSION: i64 = (\d+);/g,
    'LATEST_VERSION: i64 = 4;'
);

dbContents = dbContents.replace(
    /conn\.execute\(\n                "INSERT INTO schema_version \(version, applied_at\) VALUES \(3, strftime\('%s','now'\)\)",\n                \[\],\n            \)\?;\n        }/g,
    `conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now'))",
                [],
            )?;
        }
        4 => {
            let _ = conn.execute(
                "ALTER TABLE messages ADD COLUMN token_usage TEXT",
                [],
            );
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (4, strftime('%s','now'))",
                [],
            )?;
        }`
);

// Add to save_message
dbContents = dbContents.replace(
    /"INSERT OR REPLACE INTO messages \(id, session_id, role, content, reasoning, artifacts, tool_calls, created_at\)\n             VALUES \(\?1, \?2, \?3, \?4, \?5, \?6, \?7, \?8\)",/g,
    '"INSERT OR REPLACE INTO messages (id, session_id, role, content, reasoning, artifacts, tool_calls, token_usage, created_at)\n             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",'
);

dbContents = dbContents.replace(
    /message\.tool_calls,\n                message\.created_at/g,
    'message.tool_calls,\n                message.token_usage,\n                message.created_at'
);

// Add to get_messages_for_session
dbContents = dbContents.replace(
    /SELECT id, session_id, role, content, reasoning, artifacts, tool_calls, created_at/g,
    'SELECT id, session_id, role, content, reasoning, artifacts, tool_calls, token_usage, created_at'
);

fs.writeFileSync('src-tauri/src/database.rs', dbContents);

// 2. Update chat.rs
let chatContents = fs.readFileSync('src-tauri/src/commands/chat.rs', 'utf8');

chatContents = chatContents.replace(
    /pub tool_calls: Option<String>,\n    pub tool_call_id: Option<String>,/g,
    'pub tool_calls: Option<String>,\n    pub token_usage: Option<String>,\n    pub tool_call_id: Option<String>,'
);

chatContents = chatContents.replace(
    /tool_calls: m\.tool_calls,\n            tool_call_id: None,/g,
    'tool_calls: m.tool_calls,\n            token_usage: m.token_usage,\n            tool_call_id: None,'
);

chatContents = chatContents.replace(
    /tool_calls: None,\n        created_at: timestamp,/g,
    'tool_calls: None,\n        token_usage: None,\n        created_at: timestamp,'
);

chatContents = chatContents.replace(
    /tool_calls: Option<String>,\n\) -> AppResult<String> \{(?:.|\n)*?tool_calls,\n        created_at: timestamp,/g,
    (match) => {
        return match.replace(/tool_calls: Option<String>,/, 'tool_calls: Option<String>,\n    token_usage: Option<String>,')
                    .replace(/tool_calls,\n        created_at: timestamp,/, 'tool_calls,\n        token_usage,\n        created_at: timestamp,');
    }
);

fs.writeFileSync('src-tauri/src/commands/chat.rs', chatContents);

// 3. Update chatStore.ts
let storeContents = fs.readFileSync('src/store/chatStore.ts', 'utf8');

storeContents = storeContents.replace(
    /tool_calls: string \| null;\n  created_at: number;/g,
    'tool_calls: string | null;\n  token_usage: string | null;\n  created_at: number;'
);

storeContents = storeContents.replace(
    /artifacts: safeJsonParse\(m\.artifacts, undefined\),\n    tool_calls: safeJsonParse\(m\.tool_calls, undefined\),\n  \}\)\),/g,
    'artifacts: safeJsonParse(m.artifacts, undefined),\n    tool_calls: safeJsonParse(m.tool_calls, undefined),\n    token_usage: safeJsonParse(m.token_usage, undefined),\n  })),'
);

storeContents = storeContents.replace(
    /artifacts: message\.artifacts \? JSON\.stringify\(message\.artifacts\) : null,\n  tool_calls: message\.tool_calls \? JSON\.stringify\(message\.tool_calls\) : null,\n  created_at: message\.timestamp,/g,
    'artifacts: message.artifacts ? JSON.stringify(message.artifacts) : null,\n  tool_calls: message.tool_calls ? JSON.stringify(message.tool_calls) : null,\n  token_usage: message.token_usage ? JSON.stringify(message.token_usage) : null,\n  created_at: message.timestamp,'
);

fs.writeFileSync('src/store/chatStore.ts', storeContents);

console.log('Patch complete.');
