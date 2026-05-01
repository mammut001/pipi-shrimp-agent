import fs from 'fs';
let file = fs.readFileSync('src/store/chatStore.ts', 'utf8');

file = file.replace(/const allResults: \{ id: string; content: string \}\[\] = \[\];/, 
`const allResults: { id: string; content: string; toolName?: string; toolArgs?: string }[] = [];`);

// concurrent tool push
file = file.replace(/allResults\.push\(\{ id: result\.id, content: result\.content \}\);/,
`allResults.push({ id: result.id, content: result.content, toolName: req?.name, toolArgs: normalizedToolArgsById.get(result.id) ?? '{}' });`);

// concurrent error push
file = file.replace(/allResults\.push\(\{ id: req\.id, content: (.*?) \}\);/, 
`allResults.push({ id: req.id, content: $1, toolName: req.name, toolArgs: normalizedToolArgsById.get(req.id) ?? '{}' });`);

// AskUserQuestion push
file = file.replace(/allResults\.push\(\{ id: tool\.id, content: toolResultContent \}\);/,
`allResults.push({ id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: normalizedToolArgs });`);

// agent_tool arguments format error push
file = file.replace(/uiStore\.addNotification\('error', 'Invalid agent tool arguments', activeSessionId\);\n([\s]*)allResults\.push\(\{ id: tool\.id, content: toolResultContent \}\);/g, 
`uiStore.addNotification('error', 'Invalid agent tool arguments', activeSessionId);\n$1allResults.push({ id: tool.id, content: toolResultContent, toolName: tool.name });`);

// final push at the end of tool loop
file = file.replace(/allResults\.push\(\{ id: tool\.id, content: toolResultContent \}\);/,
`allResults.push({ id: tool.id, content: toolResultContent, toolName: tool.name, toolArgs: effectiveArgs });`);

// replace detectAndRegisterArtifacts call
file = file.replace(/detectAndRegisterArtifacts\(assistantMessage\.id, result\.content\);/,
`detectAndRegisterArtifacts({
                  messageId: assistantMessage.id,
                  toolName: result.toolName || '',
                  toolArgs: result.toolArgs || '',
                  toolResultText: result.content,
                  workDir: workDir || undefined,
                });`);

// we need to keep _resolveAll working, it might just ignore extra fields, or we can map it back
file = file.replace(/chunk\._resolveAll\(allResults\);/, 
`chunk._resolveAll(allResults.map(({id, content}) => ({id, content})));`);


fs.writeFileSync('src/store/chatStore.ts', file);
