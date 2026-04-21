import { invoke } from '@tauri-apps/api/core';
import {
  clickBrowserElement,
  executeBrowserScript,
  pressBrowserKey,
  scrollBrowser,
  typeIntoBrowserElement,
  waitForBrowser,
} from './browserActionClient';
import { getCurrentBrowserUrl, getBrowserPageState, getBrowserSemanticTree, getBrowserText } from './browserPageStateClient';
import {
  describeBrowserActionTarget,
  formatBrowserPageStateForPrompt,
  resolveBrowserActionTarget,
} from './browserPageStateModel';
import { connectBrowserSession, navigateBrowserPage, resyncBrowserPage } from './browserSessionClient';
import { isBrowserActionsV2Enabled, isBrowserPageStateV2Enabled } from './browserFeatureFlags';
import type { BrowserPageState } from '@/types/browserPageState';

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
  try { await executeBrowserScript(OVERLAY_INJECT_SCRIPT); } catch { /* ignore */ }
}
async function removeOverlay(): Promise<void> {
  try { await executeBrowserScript(OVERLAY_REMOVE_SCRIPT); } catch { /* ignore */ }
}
// ──────────────────────────────────────────────────────────────────────────

type AgentLogLevel = 'info' | 'success' | 'error' | 'warning';
type AgentLogger = (level: AgentLogLevel, message: string) => void;

const PAGE_REFERENCE_ERROR_MARKERS = ['receiver is gone', 'send failed', 'No page'];

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isPageReferenceError = (error: unknown): boolean => {
  const message = String(error);
  return PAGE_REFERENCE_ERROR_MARKERS.some((marker) => message.includes(marker));
};

async function loadBrowserPageState(log: AgentLogger): Promise<BrowserPageState | null> {
  try {
    return await getBrowserPageState();
  } catch (error) {
    log('warning', `[NativeAgent] PageState fetch failed: ${error}`);
    if (!isPageReferenceError(error)) {
      return null;
    }

    log('info', '[NativeAgent] Re-syncing page reference...');
    try {
      await resyncBrowserPage();
      return await getBrowserPageState();
    } catch (resyncError) {
      log('warning', `[NativeAgent] Re-sync failed: ${resyncError}`);
      return null;
    }
  }
}

async function loadSemanticTree(log: AgentLogger): Promise<string> {
  try {
    return await getBrowserSemanticTree();
  } catch (error) {
    log('warning', `[NativeAgent] Tree fetch failed: ${error}`);
    if (!isPageReferenceError(error)) {
      return '[]';
    }

    log('info', '[NativeAgent] Re-syncing page reference...');
    try {
      await resyncBrowserPage();
      return await getBrowserSemanticTree();
    } catch (resyncError) {
      log('warning', `[NativeAgent] Re-sync failed: ${resyncError}`);
      return '[]';
    }
  }
}

const readActionPayload = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const readString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
};

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
  const usePageStateFlow = isBrowserPageStateV2Enabled() && isBrowserActionsV2Enabled();

  log('info', '[NativeAgent] Initializing CDP Connection...');
  try {
    await connectBrowserSession();
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

TARGETING RULES:
- For click_element and input_text, you may send either {"id": 12} or {"backend_node_id": 45678}.
- When CURRENT PAGE STATE includes backend_node_id, prefer backend_node_id because it is more stable on dynamic pages.
- If both are available, include both.

TASK EXECUTION STRATEGY:
1. **Plan First**: Before acting, think about the best approach. Use the "thought" field.
2. **Search Strategy**: For generic queries (flights, prices, etc.), navigate to the best search engine or specialized site.
3. **Interact Efficiently**: Type in search boxes, press Enter to submit, then read results.
4. **Extract Data**: When you find relevant information, use extract_text or read from the semantic tree.
5. **Report Results**: In the "done" action, provide a clear, structured summary of findings.

KEY RULES:
- After typing in a search box, ALWAYS use press_key Enter to submit the search.
- If the page is loading or empty, wait 2-3 seconds before retrying.
- Use the CURRENT PAGE STATE element ids or backend_node_id values for clicking and typing.
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
        await navigateBrowserPage(startUrl);
        log('success', `[NativeAgent] Page loaded: ${startUrl}`);
      } catch (e) {
        log('warning', `[NativeAgent] Navigation attempted: ${e}`);
      }
      // Give JS-heavy pages time to render
      await delay(1500);
      await injectOverlay();
    }

    log('info', `[NativeAgent] Step ${step + 1}: Analyzing page...`);
    let pageState: BrowserPageState | null = null;
    let pageContextLabel = 'CURRENT PAGE STATE';
    let pageContextBody = 'PageState unavailable.';
    let currentUrl = '';

    if (usePageStateFlow) {
      pageState = await loadBrowserPageState(log);
      if (pageState) {
        currentUrl = pageState.url;
        pageContextBody = formatBrowserPageStateForPrompt(pageState);
        if (pageState.elements.length === 0) {
          log('warning', '[NativeAgent] PageState returned no interactive elements, page might still be loading.');
        }
      }
    }

    if (!currentUrl) {
      try {
        currentUrl = (await getCurrentBrowserUrl()) || '';
      } catch {
        currentUrl = '';
      }
    }

    if (!pageState) {
      pageContextLabel = 'CURRENT VISIBLE ELEMENTS';
      pageContextBody = await loadSemanticTree(log);
      if (pageContextBody === '[]' || !pageContextBody) {
        log('warning', '[NativeAgent] Page appears empty, might still be loading.');
      }
    }

    const promptText = `TASK: ${task}\n\nCURRENT URL: ${currentUrl}\nSTEP: ${step + 1}/30\n\n${pageContextLabel}:\n${pageContextBody}\n\nDecide your next action. Include a "thought" explaining your reasoning. Respond with JSON only.`;
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
  const actionPayload = readActionPayload(parsed.action[actionName]);

      log('success', `[NativeAgent] Action: ${actionName} ${JSON.stringify(actionPayload)}`);

      // Execute action
      if (actionName === 'done') {
        isDone = true;
        finalResult = readString(actionPayload.text, 'Task completed');
        await removeOverlay();
        log('success', `[NativeAgent] ✅ ${finalResult}`);
      } else if (actionName === 'wait') {
        const secs = Math.min(Number(actionPayload.seconds) || 3, 10);
        log('info', `[NativeAgent] Waiting ${secs}s...`);
        await waitForBrowser({ seconds: secs });
      } else if (actionName === 'navigate') {
        const navUrl = readString(actionPayload.url);
        if (navUrl) {
          log('info', `[NativeAgent] Navigating to: ${navUrl}`);
          try {
            await navigateBrowserPage(navUrl);
            log('success', `[NativeAgent] Loaded: ${navUrl}`);
            await injectOverlay();
          } catch (e) {
            log('warning', `[NativeAgent] Navigation error: ${e}`);
            messages.push({ role: 'user', content: `Navigation failed: ${e}. Try a different URL.` });
          }
        }
      } else if (actionName === 'wait_for_selector') {
        const selector = readString(actionPayload.selector);
        log('info', `[NativeAgent] Waiting for: ${selector}...`);
        try {
          await waitForBrowser({ selector });
          log('success', '[NativeAgent] Element found.');
        } catch (e) {
          log('warning', `[NativeAgent] Selector wait timeout: ${e}`);
        }
      } else if (actionName === 'click_element') {
        const target = resolveBrowserActionTarget(pageState, actionPayload);
        if (!target) {
          log('warning', '[NativeAgent] Click payload missing id/backend_node_id.');
          messages.push({ role: 'user', content: 'Click payload must include id or backend_node_id. Re-read CURRENT PAGE STATE and choose a valid target.' });
          continue;
        }

        const targetLabel = describeBrowserActionTarget(target);
        log('info', `[NativeAgent] Clicking ${targetLabel}...`);
        try {
          const result = await clickBrowserElement(target);
          log('success', `[NativeAgent] ${result}`);
          await delay(1500);
          try { await resyncBrowserPage(); } catch { /* ok */ }
        } catch (e) {
          log('error', `[NativeAgent] Click failed: ${e}`);
          messages.push({ role: 'user', content: `Click failed on ${targetLabel}: ${e}. Try a different target or wait.` });
        }
      } else if (actionName === 'input_text') {
        const target = resolveBrowserActionTarget(pageState, actionPayload);
        const text = readString(actionPayload.text);
        if (!target || !text) {
          log('warning', '[NativeAgent] Input payload missing target or text.');
          messages.push({ role: 'user', content: 'input_text must include text plus id or backend_node_id. Re-read CURRENT PAGE STATE and try again.' });
          continue;
        }

        const targetLabel = describeBrowserActionTarget(target);
        log('info', `[NativeAgent] Typing: "${text}" into ${targetLabel}`);
        try {
          const result = await typeIntoBrowserElement(target, text);
          log('success', `[NativeAgent] ${result}`);
          await delay(300);
        } catch (e) {
          log('error', `[NativeAgent] Input failed: ${e}`);
          messages.push({ role: 'user', content: `Input failed: ${e}` });
        }
      } else if (actionName === 'press_key') {
        const key = readString(actionPayload.key, 'Enter');
        log('info', `[NativeAgent] Pressing key: ${key}`);
        try {
          await pressBrowserKey(key);
          log('success', `[NativeAgent] Key pressed: ${key}`);
          await delay(1000);
          try { await resyncBrowserPage(); } catch { /* ok */ }
        } catch (e) {
          log('warning', `[NativeAgent] Key press failed: ${e}`);
        }
      } else if (actionName === 'scroll') {
        const direction = readString(actionPayload.direction, 'down');
        const pixels = Number(actionPayload.pixels) || 600;
        log('info', `[NativeAgent] Scrolling ${direction} ${pixels}px`);
        try {
          await scrollBrowser(direction, pixels);
          await delay(500);
        } catch (e) {
          log('warning', `[NativeAgent] Scroll failed: ${e}`);
        }
      } else if (actionName === 'extract_text') {
        log('info', '[NativeAgent] Extracting page text...');
        try {
          const pageText = await getBrowserText(5000);
          log('success', `[NativeAgent] Extracted ${pageText.length} chars of text`);
          // Feed text back to the LLM as context
          messages.push({ role: 'user', content: `PAGE TEXT CONTENT:\n${pageText}\n\nUse this information to complete the task. What is your next action?` });
          continue; // Skip the normal prompt since we already added context
        } catch (e) {
          log('warning', `[NativeAgent] Text extraction failed: ${e}`);
        }
      } else if (actionName === 'ask_user') {
        const question = readString(actionPayload.question, 'I need your help');
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
