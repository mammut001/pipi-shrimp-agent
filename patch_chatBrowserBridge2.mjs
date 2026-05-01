import fs from 'fs';
let file = fs.readFileSync('src/utils/chatBrowserBridge.ts', 'utf8');

file = file.replace(/const hasDomain = .*/, "const hasDomain = /(?:https?:\\/\\/)?(?:www\\.)?[a-zA-Z0-9-]+\\.[a-zA-Z]{2,}(?:\\/[^\\s，。！？,!?]*)?/i.test(msg);");

fs.writeFileSync('src/utils/chatBrowserBridge.ts', file);
