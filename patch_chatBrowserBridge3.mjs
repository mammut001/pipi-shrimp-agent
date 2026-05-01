import fs from 'fs';
let file = fs.readFileSync('src/utils/chatBrowserBridge.ts', 'utf8');

// Replace the `hasExplicitBrowserAction` block in `detectChatBrowserIntent`

file = file.replace(/const hasExplicitBrowserAction =[\s\S]*?;\n/, 
`const hasExplicitBrowserAction =
    lowerMessage.includes('打开') ||
    lowerMessage.includes('访问') ||
    lowerMessage.includes('浏览器') ||
    lowerMessage.includes('用浏览器') ||
    lowerMessage.includes('open ') ||
    lowerMessage.includes('visit ') ||
    lowerMessage.includes('browser');
`);

fs.writeFileSync('src/utils/chatBrowserBridge.ts', file);
