import fs from 'fs';
let file = fs.readFileSync('src/components/ChatInput.tsx', 'utf8');

file = file.replace(/if \(mightBeBrowser\) {[\s\S]*?return;[\s\n]*\}[\s\n]*\}/, 
`if (mightBeBrowser) {
      const handled = await handleChatBrowserWorkflow(finalMessage);
      if (handled) {
        setInput('');
        return;
      }
    }`);

fs.writeFileSync('src/components/ChatInput.tsx', file);
