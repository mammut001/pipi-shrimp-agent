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

  const systemPrompt = `You are a native browser automation agent navigating dynamic dashboards like App Store Connect.
You CANNOT use the traditional JS injected PageAgent commands. Instead, evaluate the "semantic tree" provided by the user.

CRITICAL OUTPUT FORMAT — You MUST respond with valid JSON only. NO conversational text outside JSON.
{
  "action": {
    "action_name": { "param": "value" }
  }
}

VALID ACTIONS:
1. {"action": {"wait": {"seconds": 3}}} - Brief standard wait.
2. {"action": {"wait_for_selector": {"selector": ".chart-container or [aria-label='Sales Data']"}}} - Precise wait for an element.
3. {"action": {"click_element": {"id": 12}}} - Click an element by its ID from the semantic tree.
4. {"action": {"input_text": {"id": 5, "text": "hello world"}}} - Type text into an input element.
5. {"action": {"scroll": {"direction": "down", "pixels": 600}}} - Scroll the page (direction: down/up/left/right).
6. {"action": {"navigate": {"url": "https://example.com"}}} - Navigate to a URL.
7. {"action": {"done": {"text": "Found 12k downloads", "success": true}}} - End task successfully.
8. {"action": {"ask_user": {"question": "I need MFA code"}}} - Stop and ask human.

GUIDANCE FOR DYNAMIC DASHBOARDS:
- If the tree appears empty and you just started, do NOT immediately fail. Return \`wait_for_selector\` or \`wait\`.
- Use the semantic 'id' directly for clicking.
- Use input_text for typing into search boxes, text fields, etc.
- Use scroll when you need to reveal more content on the page.
- Use navigate to go to a specific URL.`;

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
    return '';
  };

  log('info', `[NativeAgent] Starting task loop for: ${task}`);

  // 25 max steps to avoid infinite loop
  for (let step = 0; step < 25 && !isDone; step++) {
    // Navigate if it's the first step
    if (step === 0) {
      const startUrl = resolveStartUrl();
      if (startUrl) {
        log('info', `[NativeAgent] Navigating to target: ${startUrl}`);
        try {
          await invoke('navigate_and_wait', { url: startUrl });
          log('success', `[NativeAgent] Navigated to ${startUrl}`);
        } catch (e) {
          log('warning', `[NativeAgent] Initial navigation attempted but might have failed: ${e}`);
        }
      } else {
        log('warning', '[NativeAgent] No target URL found — starting from current page');
      }
      // Give JS-heavy pages (React/GitHub) time to render after navigation
      await new Promise((resolve) => setTimeout(resolve, 1500));
      // Inject scanning overlay so user can see the page is being controlled
      await injectOverlay();
    }

    log('info', `[NativeAgent] Step ${step + 1}: Fetching Semantic Tree...`);
    let semanticTree = '[]';
    try {
      semanticTree = await invoke('get_semantic_tree');
      if (semanticTree === '[]' || !semanticTree) {
        log('warning', '[NativeAgent] Received empty semantic tree. Page might still be loading.');
      }
    } catch (e: any) {
      const errStr = String(e);
      log('warning', `[NativeAgent] Failed to compute tree: ${e}`);
      // If page receiver is gone (navigation happened), try to re-sync the page reference
      if (errStr.includes('receiver is gone') || errStr.includes('send failed') || errStr.includes('No page')) {
        log('info', '[NativeAgent] Attempting page re-sync after navigation...');
        try {
          await invoke('resync_page');
          log('success', '[NativeAgent] Page re-synced, retrying tree fetch...');
          try {
            semanticTree = await invoke('get_semantic_tree');
          } catch (_retryErr) {
            log('warning', '[NativeAgent] Retry also failed, using empty tree');
          }
        } catch (resyncErr) {
          log('warning', `[NativeAgent] Re-sync failed: ${resyncErr}`);
        }
      }
    }

    const promptText = `TASK: ${task}\n\nCURRENT VISIBLE ELEMENTS (Simplified Semantic Tree):\n${semanticTree}\n\nWhat is your next JSON action? Respond ONLY with a JSON object. If you want to think, put it inside a <think> tag before the JSON.`;
    log('info', '[NativeAgent] Prompting LLM for next action...');
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
      log('info', `[NativeAgent] Raw LLM Response length: ${responseText.length}`);
      messages.push({ role: 'assistant', content: responseText });

      let parsed: any;
      try {
        // Find the LAST JSON block in the response (after thinking)
        const jsonBlocks = responseText.match(/\{[\s\S]*\}/g);
        if (!jsonBlocks) throw new Error('No JSON block found');
        const lastJson = jsonBlocks[jsonBlocks.length - 1];
        parsed = JSON.parse(lastJson);
      } catch (e) {
        log('error', `[NativeAgent] JSON Parse Error: ${e}. Raw snippet: ${responseText.substring(0, 500)}...`);
        messages.push({ role: 'user', content: 'CRITICAL: You MUST output a JSON object. Your last response had no JSON. Output ONLY this exact format (nothing else, no markdown, no text):\n{"action": {"wait": {"seconds": 2}}}\nOr use navigate/done/click_element etc. You MUST output JSON NOW.' });
        continue;
      }

      if (!parsed.action) {
        log('error', '[NativeAgent] JSON missing "action" payload.');
        messages.push({ role: 'user', content: 'You forgot the "action" property in your JSON. Format properly.' });
        continue;
      }

      const actionName = Object.keys(parsed.action)[0];
      const actionPayload = parsed.action[actionName];

      log('success', `[NativeAgent] AI chose action: ${actionName} ${JSON.stringify(actionPayload)}`);

      // Execute action
      if (actionName === 'done') {
        isDone = true;
        finalResult = actionPayload.text || 'Success';
        await removeOverlay();
        log('success', `[NativeAgent] Finished task: ${finalResult}`);
      } else if (actionName === 'wait') {
        const secs = actionPayload.seconds || 3;
        log('info', `[NativeAgent] Sleeping for ${secs}s...`);
        await new Promise((resolve) => setTimeout(resolve, secs * 1000));
      } else if (actionName === 'navigate') {
        const navUrl = actionPayload.url || '';
        log('info', `[NativeAgent] Navigating to: ${navUrl}`);
        if (navUrl) {
          try {
            await invoke('navigate_and_wait', { url: navUrl });
            log('success', `[NativeAgent] Navigated to ${navUrl}`);
            await injectOverlay();
          } catch (e) {
            log('warning', `[NativeAgent] Navigation error: ${e}`);
            messages.push({ role: 'user', content: `导航失败: ${e}` });
          }
        } else {
          log('warning', '[NativeAgent] navigate action missing url parameter');
        }
      } else if (actionName === 'wait_for_selector') {
        log('info', `[NativeAgent] Waiting for selector: ${actionPayload.selector}...`);
        try {
          // Use the rust backend tool for polling
          await invoke('navigate_and_wait', { url: '', waitSelector: actionPayload.selector });
          log('success', `[NativeAgent] Selector wait completed.`);
        } catch (e) {
          log('warning', `[NativeAgent] Selector wait error or timeout: ${e}`);
        }
      } else if (actionName === 'click_element') {
        log('info', `[NativeAgent] Clicking element ID ${actionPayload.id}...`);
        try {
          const result: string = await invoke('cdp_click', { elementId: actionPayload.id });
          log('success', `[NativeAgent] ${result}`);
          // Wait for potential navigation/animation after click
          // Wait for navigation/new-tab to settle, then always resync
          await new Promise((resolve) => setTimeout(resolve, 1500));
          log('info', '[NativeAgent] Post-click page resync...');
          try {
            await invoke('resync_page');
            log('success', '[NativeAgent] Page resynced after click');
          } catch (_) {
            // resync failed — not fatal, will retry at next step
          }
        } catch (e) {
          log('error', `[NativeAgent] Click failed: ${e}`);
          messages.push({ role: 'user', content: `点击失败: ${e}。请尝试其他元素或等待后重试。` });
        }
      } else if (actionName === 'input_text') {
        log('info', `[NativeAgent] Typing into element ID ${actionPayload.id}: "${actionPayload.text}"`);
        try {
          const result: string = await invoke('cdp_type', {
            elementId: actionPayload.id,
            text: actionPayload.text,
          });
          log('success', `[NativeAgent] ${result}`);
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (e) {
          log('error', `[NativeAgent] Input failed: ${e}`);
          messages.push({ role: 'user', content: `输入失败: ${e}` });
        }
      } else if (actionName === 'scroll') {
        const direction = actionPayload.direction || 'down';
        const pixels = actionPayload.pixels || 600;
        log('info', `[NativeAgent] Scrolling ${direction} ${pixels}px...`);
        try {
          await invoke('cdp_scroll', { direction, pixels });
          await new Promise((resolve) => setTimeout(resolve, 500));
          log('success', `[NativeAgent] Scroll completed`);
        } catch (e) {
          log('warning', `[NativeAgent] Scroll failed: ${e}`);
        }
      } else {
        log('warning', `[NativeAgent] Unknown action: ${actionName}`);
        messages.push({ role: 'user', content: `Error: The action ${actionName} is not recognized or not implemented yet.` });
      }
    } catch (error: any) {
      log('error', `[NativeAgent] LLM API Error: ${error}`);
      throw error;
    }
  }

  if (!isDone) {
    await removeOverlay();
    throw new Error('NativeAgent exhausted all allowed steps without encountering "done".');
  }

  return finalResult;
}
