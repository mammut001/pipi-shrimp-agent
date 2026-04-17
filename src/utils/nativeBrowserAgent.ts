import { invoke } from '@tauri-apps/api/core';

// ─── Agent scanning overlay ────────────────────────────────────────────────
// Injected into the CDP-controlled Chrome page while the agent is running.
// Shows a rotating conic-gradient border sweep so the user can see the page
// is being controlled. Idempotent (checks for existing element before creating).

const OVERLAY_INJECT_SCRIPT = `(function(){
  if(document.getElementById('__ppa_overlay__'))return;
  var s=document.createElement('style');
  s.id='__ppa_style__';
  s.textContent=
    '@property --ppa{syntax:"<angle>";initial-value:0deg;inherits:false}' +
    '@keyframes ppa_sweep{to{--ppa:360deg}}' +
    /* The overlay IS the ring: conic-gradient fills the full div, but the center
       is masked out via padding + xor-mask, leaving only a 10px border ring.
       drop-shadow on the element itself adds the outer glow (not clipped by mask). */
    '#__ppa_overlay__{' +
      'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;' +
      'z-index:2147483647;--ppa:0deg;' +
      'animation:ppa_sweep 1.8s linear infinite;' +
      'background:conic-gradient(from var(--ppa),' +
        'rgba(0,220,255,0) 0deg,' +
        'rgba(0,200,255,1) 40deg,' +
        'rgba(120,80,255,1) 70deg,' +
        'rgba(255,60,220,1) 100deg,' +
        'rgba(0,200,255,.3) 140deg,' +
        'rgba(0,220,255,0) 180deg,' +
        'rgba(0,220,255,0) 360deg);' +
      '-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);' +
      '-webkit-mask-composite:xor;mask-composite:exclude;' +
      'padding:10px;' +
      'filter:drop-shadow(0 0 8px rgba(0,200,255,0.9)) drop-shadow(0 0 20px rgba(120,80,255,0.7))}';
  document.head.appendChild(s);
  var d=document.createElement('div');
  d.id='__ppa_overlay__';
  document.body.appendChild(d);
})();`;

const OVERLAY_REMOVE_SCRIPT = `(function(){
  var el=document.getElementById('__ppa_overlay__');if(el)el.remove();
  var s=document.getElementById('__ppa_style__');if(s)s.remove();
})();`;

async function injectOverlay(): Promise<void> {
  try { await invoke('cdp_execute_script', { script: OVERLAY_INJECT_SCRIPT }); } catch { /* ignore */ }
}
async function removeOverlay(): Promise<void> {
  try { await invoke('cdp_execute_script', { script: OVERLAY_REMOVE_SCRIPT }); } catch { /* ignore */ }
}
// ──────────────────────────────────────────────────────────────────────────

export async function executeNativeBrowserTask(
  task: string,
  apiKey: string,
  model: string,
  options: {
    baseUrl?: string;
    targetUrl?: string;
    onLog?: (level: 'info' | 'success' | 'error' | 'warning', msg: string) => void;
  }
): Promise<string> {
  const { onLog } = options;
  const log = (level: 'info' | 'success' | 'error' | 'warning', msg: string) => onLog?.(level, msg);

  log('info', '[NativeAgent] Initializing CDP Connection...');
  try {
    await invoke('connect_browser');
    log('success', '[NativeAgent] Browser connected via CDP!');
  } catch (e: any) {
    log('error', `[NativeAgent] Connection failed: ${e}`);
    throw new Error(`Failed to connect to local Chrome (is remote debugging enabled?)\nDetails: ${e}`);
  }

  const systemPrompt = `You are a powerful browser automation agent. You control a real Chrome browser to complete tasks for the user.

CRITICAL OUTPUT FORMAT — You MUST respond with valid JSON only. NO conversational text outside JSON.
{
  "thought": "Brief explanation of what I see and what I'll do next",
  "action": {
    "action_name": { "param": "value" }
  }
}

VALID ACTIONS:
1. {"action": {"wait": {"seconds": 3}}} - Wait briefly for page to load.
2. {"action": {"wait_for_selector": {"selector": ".results"}}} - Wait for a specific element.
3. {"action": {"click_element": {"id": 12}}} - Click an element by its ID from the semantic tree.
4. {"action": {"input_text": {"id": 5, "text": "hello world"}}} - Type text into an input element.
5. {"action": {"press_key": {"key": "Enter"}}} - Press a keyboard key (Enter, Tab, Escape, ArrowDown, ArrowUp).
6. {"action": {"scroll": {"direction": "down", "pixels": 600}}} - Scroll the page.
7. {"action": {"navigate": {"url": "https://example.com"}}} - Navigate to a URL.
8. {"action": {"extract_text": {}}} - Get the page's text content for analysis.
9. {"action": {"done": {"text": "Here are the results: ...", "success": true}}} - End task with results.
10. {"action": {"ask_user": {"question": "I need your input"}}} - Ask the user for information.

TASK EXECUTION STRATEGY:
1. **Plan First**: Before acting, think about the best approach. Use the "thought" field.
2. **Search Strategy**: For generic queries (flights, prices, etc.), navigate to the best search engine or specialized site.
3. **Interact Efficiently**: Type in search boxes, press Enter to submit, then read results.
4. **Extract Data**: When you find relevant information, use extract_text or read from the semantic tree.
5. **Report Results**: In the "done" action, provide a clear, structured summary of findings.

KEY RULES:
- After typing in a search box, ALWAYS use press_key Enter to submit the search.
- If the page is loading or empty, wait 2-3 seconds before retrying.
- Always use the semantic element IDs for clicking and typing.
- When done, provide comprehensive results in the "text" field — this is what the user sees.
- For search tasks, extract the TOP 3-5 results with details (prices, links, descriptions).
- If a page requires login, use ask_user instead of trying to authenticate.`;

  const messages: any[] = [];
  let isDone = false;
  let finalResult = '';

  // Resolve the starting URL: prefer explicit targetUrl, then extract from task, then blank
  const resolveStartUrl = (): string => {
    if (options.targetUrl) return options.targetUrl;
    const urlMatch = task.match(/https?:\/\/[^\s，。！？]+/);
    if (urlMatch) return urlMatch[0];
    // Try bare domain like github.com
    const domainMatch = task.match(/(?:^|\s)([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s，。！？]*)?)/);
    if (domainMatch) return `https://${domainMatch[1]}`;
    // For generic search tasks, default to Google
    return 'https://www.google.com';
  };

  log('info', `[NativeAgent] Starting task: ${task}`);

  // 30 max steps for complex tasks
  for (let step = 0; step < 30 && !isDone; step++) {
    // Navigate if it's the first step
    if (step === 0) {
      const startUrl = resolveStartUrl();
      log('info', `[NativeAgent] Navigating to: ${startUrl}`);
      try {
        await invoke('navigate_and_wait', { url: startUrl });
        log('success', `[NativeAgent] Page loaded: ${startUrl}`);
      } catch (e) {
        log('warning', `[NativeAgent] Navigation attempted: ${e}`);
      }
      // Give JS-heavy pages time to render
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await injectOverlay();
    }

    log('info', `[NativeAgent] Step ${step + 1}: Analyzing page...`);
    let semanticTree = '[]';
    let currentUrl = '';

    // Get current URL for context
    try {
      const urlScript = '(function() { return window.location.href; })()';
      currentUrl = await invoke('cdp_execute_script', { script: urlScript }) || '';
    } catch { /* ignore */ }

    try {
      semanticTree = await invoke('get_semantic_tree');
      if (semanticTree === '[]' || !semanticTree) {
        log('warning', '[NativeAgent] Page appears empty, might still be loading.');
      }
    } catch (e: any) {
      const errStr = String(e);
      log('warning', `[NativeAgent] Tree fetch failed: ${e}`);
      if (errStr.includes('receiver is gone') || errStr.includes('send failed') || errStr.includes('No page')) {
        log('info', '[NativeAgent] Re-syncing page reference...');
        try {
          await invoke('resync_page');
          try {
            semanticTree = await invoke('get_semantic_tree');
          } catch (_retryErr) {
            log('warning', '[NativeAgent] Retry failed, using empty tree');
          }
        } catch (resyncErr) {
          log('warning', `[NativeAgent] Re-sync failed: ${resyncErr}`);
        }
      }
    }

    const promptText = `TASK: ${task}\n\nCURRENT URL: ${currentUrl}\nSTEP: ${step + 1}/30\n\nCURRENT VISIBLE ELEMENTS:\n${semanticTree}\n\nDecide your next action. Include a "thought" explaining your reasoning. Respond with JSON only.`;
    messages.push({ role: 'user', content: promptText });

    try {
      const response: any = await invoke('send_claude_sdk_chat', {
        messages,
        apiKey,
        model,
        baseUrl: options.baseUrl || null,
        systemPrompt,
      });

      const responseText = response.content;
      messages.push({ role: 'assistant', content: responseText });

      let parsed: any;
      try {
        const jsonBlocks = responseText.match(/\{[\s\S]*\}/g);
        if (!jsonBlocks) throw new Error('No JSON block found');
        const lastJson = jsonBlocks[jsonBlocks.length - 1];
        parsed = JSON.parse(lastJson);
      } catch (e) {
        log('error', `[NativeAgent] JSON Parse Error: ${e}`);
        messages.push({ role: 'user', content: 'CRITICAL: Output ONLY JSON. Example: {"thought":"...","action":{"wait":{"seconds":2}}}' });
        continue;
      }

      if (!parsed.action) {
        log('error', '[NativeAgent] Missing "action" in response.');
        messages.push({ role: 'user', content: 'Missing "action" key. Format: {"thought":"...","action":{"navigate":{"url":"..."}}}' });
        continue;
      }

      // Log the thought for user visibility
      if (parsed.thought) {
        log('info', `[NativeAgent] 💭 ${parsed.thought}`);
      }

      const actionName = Object.keys(parsed.action)[0];
      const actionPayload = parsed.action[actionName];

      log('success', `[NativeAgent] Action: ${actionName} ${JSON.stringify(actionPayload)}`);

      // Execute action
      if (actionName === 'done') {
        isDone = true;
        finalResult = actionPayload.text || 'Task completed';
        await removeOverlay();
        log('success', `[NativeAgent] ✅ ${finalResult}`);
      } else if (actionName === 'wait') {
        const secs = Math.min(actionPayload.seconds || 3, 10);
        log('info', `[NativeAgent] Waiting ${secs}s...`);
        await new Promise((resolve) => setTimeout(resolve, secs * 1000));
      } else if (actionName === 'navigate') {
        const navUrl = actionPayload.url || '';
        if (navUrl) {
          log('info', `[NativeAgent] Navigating to: ${navUrl}`);
          try {
            await invoke('navigate_and_wait', { url: navUrl });
            log('success', `[NativeAgent] Loaded: ${navUrl}`);
            await injectOverlay();
          } catch (e) {
            log('warning', `[NativeAgent] Navigation error: ${e}`);
            messages.push({ role: 'user', content: `Navigation failed: ${e}. Try a different URL.` });
          }
        }
      } else if (actionName === 'wait_for_selector') {
        log('info', `[NativeAgent] Waiting for: ${actionPayload.selector}...`);
        try {
          await invoke('navigate_and_wait', { url: '', waitSelector: actionPayload.selector });
          log('success', '[NativeAgent] Element found.');
        } catch (e) {
          log('warning', `[NativeAgent] Selector wait timeout: ${e}`);
        }
      } else if (actionName === 'click_element') {
        log('info', `[NativeAgent] Clicking element ${actionPayload.id}...`);
        try {
          const result: string = await invoke('cdp_click', { elementId: actionPayload.id });
          log('success', `[NativeAgent] ${result}`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          try { await invoke('resync_page'); } catch { /* ok */ }
        } catch (e) {
          log('error', `[NativeAgent] Click failed: ${e}`);
          messages.push({ role: 'user', content: `Click failed on element ${actionPayload.id}: ${e}. Try a different element or wait.` });
        }
      } else if (actionName === 'input_text') {
        log('info', `[NativeAgent] Typing: "${actionPayload.text}" into element ${actionPayload.id}`);
        try {
          const result: string = await invoke('cdp_type', {
            elementId: actionPayload.id,
            text: actionPayload.text,
          });
          log('success', `[NativeAgent] ${result}`);
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (e) {
          log('error', `[NativeAgent] Input failed: ${e}`);
          messages.push({ role: 'user', content: `Input failed: ${e}` });
        }
      } else if (actionName === 'press_key') {
        const key = actionPayload.key || 'Enter';
        log('info', `[NativeAgent] Pressing key: ${key}`);
        try {
          const keyScript = `
            (function() {
              var event = new KeyboardEvent('keydown', { key: '${key}', code: '${key}', bubbles: true });
              document.activeElement.dispatchEvent(event);
              var eventUp = new KeyboardEvent('keyup', { key: '${key}', code: '${key}', bubbles: true });
              document.activeElement.dispatchEvent(eventUp);
              if ('${key}' === 'Enter') {
                // Also try form submission for Enter key
                var form = document.activeElement.closest('form');
                if (form) form.submit();
              }
              return 'ok';
            })();
          `;
          await invoke('cdp_execute_script', { script: keyScript });
          log('success', `[NativeAgent] Key pressed: ${key}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try { await invoke('resync_page'); } catch { /* ok */ }
        } catch (e) {
          log('warning', `[NativeAgent] Key press failed: ${e}`);
        }
      } else if (actionName === 'scroll') {
        const direction = actionPayload.direction || 'down';
        const pixels = actionPayload.pixels || 600;
        log('info', `[NativeAgent] Scrolling ${direction} ${pixels}px`);
        try {
          await invoke('cdp_scroll', { direction, pixels });
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (e) {
          log('warning', `[NativeAgent] Scroll failed: ${e}`);
        }
      } else if (actionName === 'extract_text') {
        log('info', '[NativeAgent] Extracting page text...');
        try {
          const textScript = '(function() { return document.body.innerText.substring(0, 5000); })()';
          const pageText: string = await invoke('cdp_execute_script', { script: textScript });
          log('success', `[NativeAgent] Extracted ${pageText.length} chars of text`);
          // Feed text back to the LLM as context
          messages.push({ role: 'user', content: `PAGE TEXT CONTENT:\n${pageText}\n\nUse this information to complete the task. What is your next action?` });
          continue; // Skip the normal prompt since we already added context
        } catch (e) {
          log('warning', `[NativeAgent] Text extraction failed: ${e}`);
        }
      } else if (actionName === 'ask_user') {
        const question = actionPayload.question || 'I need your help';
        log('warning', `[NativeAgent] ❓ ${question}`);
        await removeOverlay();
        finalResult = `Agent needs your input: ${question}`;
        isDone = true;
      } else {
        log('warning', `[NativeAgent] Unknown action: ${actionName}`);
        messages.push({ role: 'user', content: `Unknown action "${actionName}". Use one of: wait, navigate, click_element, input_text, press_key, scroll, extract_text, done, ask_user.` });
      }
    } catch (error: any) {
      log('error', `[NativeAgent] API Error: ${error}`);
      throw error;
    }
  }

  if (!isDone) {
    await removeOverlay();
    throw new Error('NativeAgent exhausted all allowed steps without completing the task.');
  }

  return finalResult;
}
