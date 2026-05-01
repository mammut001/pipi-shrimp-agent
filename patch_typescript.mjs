import fs from 'fs';

// QueryEngine.ts
let engineRaw = fs.readFileSync('src/core/QueryEngine.ts', 'utf8');

engineRaw = engineRaw.replace(/export async function\* runChatTurn\([\s\S]*?\): AsyncGenerator<EngineEvent, void, unknown> \{/, 
`export async function* runChatTurn(
  sessionId: string,
  initialMessages: any[],
  systemPrompt: string,
  projectRoot?: string,
  allowBrowserTools: boolean = false,
): AsyncGenerator<EngineEvent, void, unknown> {`);

engineRaw = engineRaw.replace(/browserConnected: useCdpStore\.getState\(\)\.status === 'connected',/, 
`allowBrowserTools: allowBrowserTools,`);

fs.writeFileSync('src/core/QueryEngine.ts', engineRaw);

// chatStore.ts
let chatStoreRaw = fs.readFileSync('src/store/chatStore.ts', 'utf8');

chatStoreRaw = chatStoreRaw.replace(/sendMessage: async \(content: string, targetSessionId\?: string\) => \{/, 
`sendMessage: async (content: string, targetSessionId?: string, options?: { allowBrowserTools?: boolean }) => {`);

chatStoreRaw = chatStoreRaw.replace(/const engine = runChatTurn\(activeSessionId, apiMessages, systemPrompt, sessionWorkDir\);/, 
`const engine = runChatTurn(activeSessionId, apiMessages, systemPrompt, sessionWorkDir, options?.allowBrowserTools || false);`);

chatStoreRaw = chatStoreRaw.replace(/browserConnected: useCdpStore\.getState\(\)\.status === 'connected',/g, 
`allowBrowserTools: true,`);

fs.writeFileSync('src/store/chatStore.ts', chatStoreRaw);

// chat.ts interface
let typesRaw = fs.readFileSync('src/types/chat.ts', 'utf8');
typesRaw = typesRaw.replace(/sendMessage: \(content: string, sessionId\?: string\) => Promise<void>;/, 
`sendMessage: (content: string, sessionId?: string, options?: { allowBrowserTools?: boolean }) => Promise<void>;`);
fs.writeFileSync('src/types/chat.ts', typesRaw);

