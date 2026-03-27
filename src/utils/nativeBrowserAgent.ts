import { invoke } from '@tauri-apps/api/core';

export async function executeNativeBrowserTask(
  task: string,
  apiKey: string,
  model: string,
  options: { baseUrl?: string; onLog?: (level: 'info' | 'success' | 'error' | 'warning', msg: string) => void }
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
4. {"action": {"done": {"text": "Found 12k downloads", "success": true}}} - End task successfully.
5. {"action": {"ask_user": {"question": "I need MFA code"}}} - Stop and ask human.

GUIDANCE FOR DYNAMIC DASHBOARDS:
- If the tree appears empty and you just started, do NOT immediately fail. Return \`wait_for_selector\` or \`wait\`.
- Use the semantic 'id' directly for clicking.`;

  const messages: any[] = [];
  let isDone = false;
  let finalResult = '';

  log('info', `[NativeAgent] Starting task loop for: ${task}`);

  // 10 max steps to avoid infinite loop
  for (let step = 0; step < 10 && !isDone; step++) {
    // Navigate if it's the first step
    if (step === 0) {
      log('info', `[NativeAgent] Navigating to target: ${task.match(/https?:\/\/[^\s]+/)?.[0] || 'appstoreconnect.apple.com'}`);
      try {
        const urlMatch = task.match(/https?:\/\/[^\s]+/);
        const targetUrl = urlMatch ? urlMatch[0] : 'https://appstoreconnect.apple.com';
        await invoke('navigate_and_wait', { url: targetUrl });
        log('success', `[NativeAgent] Navigated to ${targetUrl}`);
      } catch (e) {
        log('warning', `[NativeAgent] Initial navigation attempted but might have failed: ${e}`);
      }
    }

    log('info', `[NativeAgent] Step ${step + 1}: Fetching Semantic Tree...`);
    let semanticTree = '[]';
    try {
      semanticTree = await invoke('get_semantic_tree');
      if (semanticTree === '[]' || !semanticTree) {
        log('warning', '[NativeAgent] Received empty semantic tree. Page might still be loading.');
      }
    } catch (e) {
      log('warning', `[NativeAgent] Failed to compute tree: ${e}`);
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
        messages.push({ role: 'user', content: 'You did not output valid JSON! Return ONLY valid JSON containing the "action" block. Ensure you close the JSON properly.' });
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
        log('success', `[NativeAgent] Finished task: ${finalResult}`);
      } else if (actionName === 'wait') {
        const secs = actionPayload.seconds || 3;
        log('info', `[NativeAgent] Sleeping for ${secs}s...`);
        await new Promise((resolve) => setTimeout(resolve, secs * 1000));
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
        log('info', `[NativeAgent] Attempting to click Element ID ${actionPayload.id}...`);
        // We need to implement click_element in Rust to make this real
        await new Promise((resolve) => setTimeout(resolve, 1000));
        log('info', `[NativeAgent] Mock Clicked ${actionPayload.id}`);
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
    throw new Error('NativeAgent exhausted all allowed steps without encountering "done".');
  }

  return finalResult;
}
