/**
 * Chat Browser Bridge - Connect chat messages to browser workflows
 *
 * This bridge detects browser intents in chat messages and routes them
 * to the browser orchestration layer.
 */

import { detectBrowserIntent, mightBeBrowserIntent } from './browserIntentDetector';
import { createTaskEnvelope, estimateTaskComplexity } from './browserTaskPlanner';
import type { BrowserTaskEnvelope, BrowserSessionStatus } from '../types/browser';
import { createMessage, type Message } from '../types/chat';
import { useBrowserAgentStore } from '../store/browserAgentStore';
import { useUIStore } from '../store/uiStore';
import { useChatStore } from '../store/chatStore';

// Track browser workflow listener lifecycle between tasks
let unsubscribeBrowserState: (() => void) | null = null;
let lastBrowserAuthState: string | null = null;
let lastBrowserAuthPromptKey: string | null = null;

// Active browser progress bubble tracking (for consolidation)
let activeBrowserMessageId: string | null = null;
let browserSteps: Array<{ status: string; label: string; done: boolean }> = [];

/**
 * Status to step label mapping
 */
const STATUS_LABELS: Record<string, string> = {
  opening: '打开浏览器',
  inspecting: '检查页面状态',
  needs_login: '等待登录',
  waiting_user_resume: '等待用户操作',
  ready_for_agent: '页面就绪',
  running: '执行任务',
  completed: '任务完成',
  error: '任务出错',
  blocked_auth: '认证被阻止',
  blocked_captcha: '遇到验证码',
  blocked_manual_step: '需要手动操作',
};

/**
 * States that should trigger a chat progress update
 */
const PROGRESS_TRIGGER_STATES: BrowserSessionStatus[] = [
  'opening',
  'inspecting',
  'needs_login',
  'waiting_user_resume',
  'ready_for_agent',
  'running',
  'blocked_auth',
  'blocked_captcha',
  'blocked_manual_step',
  'completed',
  'error',
];

/**
 * Result of browser intent detection from chat
 */
export interface ChatBrowserIntent {
  /** Whether a browser workflow should be triggered */
  shouldUseBrowser: boolean;
  /** The type of browser workflow */
  kind: 'browser_open_only' | 'browser_task' | 'browser_task_login_gated' | 'browser_im_task' | 'none';
  /** Site profile ID (if detected) */
  siteProfileId?: string;
  /** Target URL */
  targetUrl?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Human-readable reason for detection */
  reason: string;
}

/**
 * Additional site mappings beyond browserIntentDetector
 * These are auth-gated sites that require special handling
 */
const AUTH_GATED_SITES: Record<string, string> = {
  'app store connect': 'https://appstoreconnect.apple.com',
  'appstoreconnect': 'https://appstoreconnect.apple.com',
  'apple developer': 'https://developer.apple.com',
  'gmail': 'https://mail.google.com',
  'google mail': 'https://mail.google.com',
  'outlook': 'https://outlook.live.com/mail',
  'hotmail': 'https://outlook.live.com/mail',
  'qq邮箱': 'https://mail.qq.com',
  'qq mail': 'https://mail.qq.com',
  '163邮箱': 'https://mail.163.com',
  '163 mail': 'https://mail.163.com',
  '邮箱': 'https://mail.google.com',
  '邮件': 'https://mail.google.com',
  '开发者': 'https://developer.apple.com',
  '阿里云': 'https://aliyun.com',
  'aliyun': 'https://aliyun.com',
  'aws': 'https://console.aws.amazon.com',
  'azure': 'https://azure.microsoft.com',
  'gcp': 'https://console.cloud.google.com',
  'cloudflare': 'https://cloudflare.com',
  'vercel': 'https://vercel.com',
  'netlify': 'https://netlify.com',
};

/**
 * Detect if a chat message should trigger a browser workflow
 */
export function detectChatBrowserIntent(message: string): ChatBrowserIntent {
  const lowerMessage = message.toLowerCase();

  // Fast-path: explicit domain requests such as "打开 github.com，用浏览器"
  const directDomainMatch = message.match(/((?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s，。！？,!?]*)?)/i);
  const hasExplicitBrowserAction =
    lowerMessage.includes('打开') ||
    lowerMessage.includes('访问') ||
    lowerMessage.includes('浏览器') ||
    lowerMessage.includes('用浏览器') ||
    lowerMessage.includes('open ') ||
    lowerMessage.includes('visit ') ||
    lowerMessage.includes('browser') ||
    lowerMessage.includes('帮我去') ||
    lowerMessage.includes('去这个') ||
    lowerMessage.includes('去看看') ||
    lowerMessage.includes('帮我看看') ||
    lowerMessage.includes('去查查') ||
    lowerMessage.includes('看一下') ||
    lowerMessage.includes('查一下') ||
    lowerMessage.includes('去一下') ||
    lowerMessage.includes('帮我查');

  if (directDomainMatch && hasExplicitBrowserAction) {
    const rawTarget = directDomainMatch[1].trim();
    const targetUrl = rawTarget.startsWith('http://') || rawTarget.startsWith('https://')
      ? rawTarget
      : `https://${rawTarget}`;

    return {
      shouldUseBrowser: true,
      kind: isAuthGatedSite(targetUrl) ? 'browser_task_login_gated' : 'browser_task',
      targetUrl,
      confidence: 0.95,
      reason: `Detected direct domain browser request: ${rawTarget}`,
    };
  }

  // First, try the existing browser intent detector
  const intent = detectBrowserIntent(message);

  if (intent.detected && intent.url) {
    // Check for auth-gated sites
    let targetUrl = intent.url;
    for (const [key, url] of Object.entries(AUTH_GATED_SITES)) {
      if (lowerMessage.includes(key)) {
        targetUrl = url;
        break;
      }
    }

    // Determine the kind of browser workflow
    let kind: ChatBrowserIntent['kind'] = 'browser_task';
    const requiresLogin = isAuthGatedSite(targetUrl);

    if (requiresLogin) {
      kind = 'browser_task_login_gated';
    } else if (targetUrl.includes('whatsapp') || targetUrl.includes('telegram') || targetUrl.includes('slack')) {
      kind = 'browser_im_task';
    } else if (intent.task === '浏览网页内容' || intent.task === 'browse') {
      kind = 'browser_open_only';
    }

    return {
      shouldUseBrowser: true,
      kind,
      siteProfileId: undefined, // Will be determined when creating envelope
      targetUrl,
      confidence: intent.confidence,
      reason: `Detected browser intent for: ${intent.website || targetUrl}`,
    };
  }

  // Check for auth-gated keywords even without specific URL
  const authGatedKeywords = [
    '上传 build',
    '上传 app',
    '上传新 build',
    '上传到 app store',
    '发布 app',
    '上传ipa',
    '发布到 app store',
    '管理 app store',
    '开发者后台',
    'aws',
    '阿里云',
    'cloudflare',
    'vercel',
    'netlify',
    '邮箱',
    '邮件',
    'gmail',
    'outlook',
    'hotmail',
    'qq邮箱',
    'qq mail',
    '163邮箱',
    '163 mail',
    'inbox',
    '收件箱',
  ];

  for (const keyword of authGatedKeywords) {
    if (lowerMessage.includes(keyword.toLowerCase())) {
      // Determine target URL based on keyword
      let targetUrl = 'https://www.google.com';
      if (keyword.toLowerCase().includes('app store') || keyword.toLowerCase().includes('build')) {
        targetUrl = 'https://appstoreconnect.apple.com';
      } else if (keyword.toLowerCase().includes('gmail') || keyword === '邮箱' || keyword === '邮件' || keyword === 'inbox' || keyword === '收件箱') {
        targetUrl = 'https://mail.google.com';
      } else if (keyword.toLowerCase().includes('outlook') || keyword.toLowerCase().includes('hotmail')) {
        targetUrl = 'https://outlook.live.com/mail';
      } else if (keyword.toLowerCase().includes('qq')) {
        targetUrl = 'https://mail.qq.com';
      } else if (keyword.toLowerCase().includes('163')) {
        targetUrl = 'https://mail.163.com';
      } else if (keyword.toLowerCase().includes('aws')) {
        targetUrl = 'https://console.aws.amazon.com';
      } else if (keyword.toLowerCase().includes('阿里云') || keyword.toLowerCase().includes('aliyun')) {
        targetUrl = 'https://aliyun.com';
      } else if (keyword.toLowerCase().includes('vercel')) {
        targetUrl = 'https://vercel.com';
      } else if (keyword.toLowerCase().includes('netlify')) {
        targetUrl = 'https://netlify.com';
      }

      return {
        shouldUseBrowser: true,
        kind: 'browser_task_login_gated',
        targetUrl,
        confidence: 0.8,
        reason: `Detected auth-gated action: ${keyword}`,
      };
    }
  }

  // No browser intent detected
  return {
    shouldUseBrowser: false,
    kind: 'none',
    confidence: 0,
    reason: 'No browser workflow detected in message',
  };
}

/**
 * Check if a site typically requires authentication
 */
function isAuthGatedSite(url: string): boolean {
  const authGatedDomains = [
    'appstoreconnect.apple.com',
    'developer.apple.com',
    'github.com',
    'mail.google.com',
    'outlook.live.com',
    'mail.qq.com',
    'mail.163.com',
    'drive.google.com',
    'web.whatsapp.com',
    'web.telegram.org',
    'slack.com',
    'console.aws.amazon.com',
    'cloud.google.com',
    'azure.microsoft.com',
    'aliyun.com',
    'cloudflare.com',
    'vercel.com',
    'netlify.com',
  ];

  const lowerUrl = url.toLowerCase();
  return authGatedDomains.some(domain => lowerUrl.includes(domain));
}

/**
 * Create a task envelope from chat message
 */
export function createTaskEnvelopeFromChat(
  message: string,
  _targetUrl?: string
): BrowserTaskEnvelope | null {
  const intent = detectChatBrowserIntent(message);

  if (!intent.shouldUseBrowser || !intent.targetUrl) {
    return null;
  }

  // Extract task description from message
  let taskDescription = message;
  // Remove common prefixes
  const prefixesToRemove = [
    '帮我',
    '帮我去',
    '去',
    '请',
    '帮我看看',
    '帮我查查',
    '帮我找找',
    '看看',
    '查查',
    '找找',
  ];

  for (const prefix of prefixesToRemove) {
    if (taskDescription.toLowerCase().startsWith(prefix.toLowerCase())) {
      taskDescription = taskDescription.slice(prefix.length).trim();
      break;
    }
  }

  // Clean up common suffixes
  taskDescription = taskDescription
    .replace(/一下$/, '')
    .replace(/呗$/, '')
    .replace(/吗$/, '')
    .replace(/嘛$/, '')
    .trim();

  // Default task if nothing meaningful remains
  if (!taskDescription) {
    taskDescription = intent.kind === 'browser_open_only' ? '浏览网页内容' : '执行浏览器任务';
  }

  // Add context for login-gated tasks
  if (intent.kind === 'browser_task_login_gated') {
    taskDescription = `${taskDescription}。如果需要登录、MFA或人工审核，请停止并提示用户手动继续。`;
  }

  return createTaskEnvelope(
    intent.targetUrl,
    message,
    taskDescription
  );
}

/**
 * Switch the UI to browser panel and set dock mode
 */
export function switchToBrowserPanel(): void {
  const uiStore = useUIStore.getState();

  // Ensure right panel is visible
  if (!uiStore.rightPanelVisible) {
    uiStore.toggleRightPanel();
  }

  // Set right panel tab to browser
  uiStore.setAgentPanelTab('browser');

  // Set dock mode to panel (shows mini preview in right panel)
  uiStore.setBrowserDockMode('panel');
}

/**
 * Generate a simple unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Add a progress message to chat and return the message ID.
 * Returns null if no current session.
 */
export function addChatProgressMessage(
  message: string,
  metadata?: {
    browserTaskId?: string;
    browserStatus?: string;
    siteProfileId?: string;
  }
): string | null {
  const chatStore = useChatStore.getState();
  const currentSessionId = chatStore.currentSessionId;

  if (!currentSessionId) {
    console.warn('[chatBrowserBridge] No current session to add progress message');
    return null;
  }

  // Create assistant message with metadata (add required fields)
  const newMessage: Message = {
    id: generateId(),
    role: 'assistant',
    content: message,
    timestamp: Date.now(),
    metadata: {
      type: 'browser_progress',
      ...metadata,
    },
  };

  chatStore.addMessage(newMessage);
  return newMessage.id;
}

/**
 * Get browser status message for chat
 */
export function getBrowserStatusMessage(
  status: string,
  _siteProfileId?: string
): string {
  switch (status) {
    case 'opening':
      return '我正在打开浏览器并准备目标网站...';

    case 'inspecting':
      return '正在检查页面状态...';

    case 'needs_login':
      return '我已经打开目标网站。请先完成登录，登录后点击"我已登录"，我会继续。';

    case 'waiting_user_resume':
      return '等待您完成登录。登录后请点击"我已登录"按钮。';

    case 'ready_for_agent':
      return '页面已就绪，我可以继续执行浏览器任务。';

    case 'running':
      return '我正在浏览器中执行这个任务...';

    case 'blocked_auth':
      return '会话已失效或页面重新要求登录。请先完成登录后继续。';

    case 'blocked_captcha':
      return '遇到了验证码或人工验证步骤。请先在浏览器中完成验证。';

    case 'blocked_manual_step':
      return '这个步骤需要您手动确认。请在浏览器中完成操作后继续。';

    case 'completed':
      return '浏览器任务已完成。';

    case 'error':
      return '浏览器任务执行出错。请检查浏览器窗口状态。';

    default:
      return '正在处理浏览器任务...';
  }
}

/**
 * Build the progress content string from the steps array.
 * Renders a consolidated progress bubble with checkmarks for completed steps.
 */
function buildProgressContent(steps: Array<{ status: string; label: string; done: boolean }>, isFinal: boolean): string {
  const allDone = isFinal || steps.every(s => s.done);
  const header = allDone
    ? '🌐 **浏览器任务** · ✅ 已完成'
    : '🌐 **浏览器任务** · ⏳ 进行中';

  const lastStep = steps[steps.length - 1];
  const hasInProgressStep = !allDone && lastStep && !lastStep.done;

  const completedSteps = hasInProgressStep ? steps.slice(0, -1) : steps;
  const inProgressStep = hasInProgressStep ? lastStep : null;

  const completedLines = completedSteps.map(s => `✅ ${s.label}`).join('\n');
  const inProgressLine = inProgressStep ? `\n\n⏳ ${inProgressStep.label}...` : '';

  return `${header}\n\n${completedLines}${inProgressLine}`;
}

/**
 * Start listening to browser state changes and update chat progress.
 * Consolidates all progress updates into a SINGLE dynamic bubble instead of creating new ones.
 * Call this when a browser workflow begins.
 */
function startBrowserStateListener() {
  // Clean up any existing listener and reset state
  stopBrowserStateListener();
  activeBrowserMessageId = null;
  browserSteps = [];

  const store = useBrowserAgentStore;
  let lastStatus = store.getState().status;
  lastBrowserAuthState = store.getState().authState;
  lastBrowserAuthPromptKey = null;

  const unsubscribe = store.subscribe((currentState) => {
    const currentStatus = currentState.status;

    // Handle completion — finalize bubble and hand result to AI
    if (currentStatus === 'completed') {
      stopBrowserStateListener();
      const taskResult = currentState.lastTaskResult;
      const chatStore = useChatStore.getState();

      // Finalize the progress bubble
      if (activeBrowserMessageId) {
        const finalSteps = browserSteps.map(s => ({ ...s, done: true }));
        const finalContent = buildProgressContent(finalSteps, true);
        chatStore.updateMessageContent(activeBrowserMessageId, finalContent, {
          type: 'browser_progress',
          browserStatus: 'completed',
          siteProfileId: currentState.siteProfileId || undefined,
        });
        activeBrowserMessageId = null;
      }

      // Find the original user question
      const allMessages = chatStore.currentMessages();
      const originalMsg = [...allMessages]
        .reverse()
        .find(m => m.role === 'user' && m.metadata?.type !== 'browser_result_context');
      const originalQuery = originalMsg?.content || '';

      if (taskResult) {
        chatStore.generateBrowserResultResponse(taskResult, originalQuery);
      }
      return;
    }

    // Handle error — update bubble with error state
    if (currentStatus === 'error') {
      stopBrowserStateListener();
      const errorStep = STATUS_LABELS['error'] || '任务出错';
      browserSteps.push({ status: 'error', label: errorStep, done: false });

      if (activeBrowserMessageId) {
        const chatStore = useChatStore.getState();
        const content = buildProgressContent(browserSteps, false);
        chatStore.updateMessageContent(activeBrowserMessageId, content, {
          type: 'browser_progress',
          browserStatus: 'error',
          siteProfileId: currentState.siteProfileId || undefined,
        });
      }
      return;
    }

    // Handle auth-gated states — add auth step without creating new bubble
    const authState = currentState.authState;
    const authPromptKey = `${currentState.pendingTask?.id || 'no-task'}:${currentStatus}:${authState}`;
    if (
      authState !== lastBrowserAuthState &&
      (authState === 'auth_required' || authState === 'mfa_required' || authState === 'captcha_required')
    ) {
      lastBrowserAuthState = authState;
      if (authPromptKey !== lastBrowserAuthPromptKey) {
        lastBrowserAuthPromptKey = authPromptKey;
        // Auth steps are shown as a separate inline message below the progress bubble
        // (they interrupt the flow and need user action)
      }
    } else if (authState !== lastBrowserAuthState) {
      lastBrowserAuthState = authState;
      if (authState === 'authenticated' || authState === 'unknown' || authState === 'unauthenticated') {
        lastBrowserAuthPromptKey = null;
      }
    }

    // Handle normal progress states — consolidate into single bubble
    if (currentStatus !== lastStatus && PROGRESS_TRIGGER_STATES.includes(currentStatus)) {
      lastStatus = currentStatus;

      const label = STATUS_LABELS[currentStatus] || getBrowserStatusMessage(currentStatus);
      const isDone = currentStatus !== 'running';

      // Add/update step in the steps array
      const existingIdx = browserSteps.findIndex(s => s.status === currentStatus);
      if (existingIdx === -1) {
        browserSteps.push({ status: currentStatus, label, done: isDone });
      } else {
        browserSteps[existingIdx] = { status: currentStatus, label, done: isDone };
      }

      const content = buildProgressContent(browserSteps, false);
      const metadata = {
        type: 'browser_progress',
        browserStatus: currentStatus,
        siteProfileId: currentState.siteProfileId || undefined,
      };

      const chatStore = useChatStore.getState();

      if (activeBrowserMessageId === null) {
        // First state change — create the bubble and store its ID
        activeBrowserMessageId = addChatProgressMessage(content, metadata);
      } else {
        // Subsequent changes — update the existing bubble
        chatStore.updateMessageContent(activeBrowserMessageId, content, metadata);
      }
    }
  });

  unsubscribeBrowserState = () => {
    unsubscribe();
    unsubscribeBrowserState = null;
    lastBrowserAuthState = null;
    lastBrowserAuthPromptKey = null;
    activeBrowserMessageId = null;
    browserSteps = [];
  };
}

/**
 * Stop listening to browser state changes
 */
function stopBrowserStateListener() {
  if (unsubscribeBrowserState) {
    unsubscribeBrowserState();
    unsubscribeBrowserState = null;
  }
  lastBrowserAuthState = null;
  lastBrowserAuthPromptKey = null;
}

/**
 * Main entry point: handle chat message and route to browser if needed
 * Returns true if browser workflow was triggered
 */
export async function handleChatBrowserWorkflow(message: string): Promise<boolean> {
  // Detect if this is a browser workflow
  const intent = detectChatBrowserIntent(message);

  if (!intent.shouldUseBrowser) {
    return false;
  }

  console.log('[chatBrowserBridge] Detected browser intent:', intent);

  const chatStore = useChatStore.getState();
  if (!chatStore.currentSessionId) {
    await chatStore.startSession();
  }

  // CRITICAL: Add the user's message FIRST so it appears in the chat history.
  // Without this, the user's input is lost and only assistant bubbles are shown.
  const chatStoreAfterSession = useChatStore.getState();
  await chatStoreAfterSession.addMessage(createMessage('user', message));

  // Create task envelope
  const envelope = createTaskEnvelopeFromChat(message);

  if (!envelope) {
    console.error('[chatBrowserBridge] Failed to create task envelope');
    return false;
  }

  console.log('[chatBrowserBridge] Created task envelope:', envelope);

  // Get complexity for user feedback
  const complexity = estimateTaskComplexity(envelope);

  // Add initial progress message to chat (this is tracked by the listener for consolidation)
  const complexityText: Record<string, string> = {
    simple: '简单任务',
    medium: '中等复杂度任务',
    complex: '复杂任务',
  };

  const initialMessage = `我将打开 ${envelope.metadata?.profileLabel || envelope.siteProfileId} ${complexityText[complexity] || '任务'}。`;

  // Start listening to browser state changes BEFORE adding the initial message
  // so the listener can track/consolidate all bubbles from the start
  startBrowserStateListener();

  // Now add the initial message — it will be the first bubble tracked by the listener
  const initialMsgId = addChatProgressMessage(initialMessage, {
    browserTaskId: envelope.id,
    browserStatus: 'opening',
    siteProfileId: envelope.siteProfileId,
  });

  // If the browser store hasn't emitted the first state change yet,
  // track the initial bubble ID so the listener updates it instead of creating a duplicate
  if (initialMsgId && useBrowserAgentStore.getState().status === 'idle') {
    activeBrowserMessageId = initialMsgId;
    // Add 'opening' to steps as done so the bubble starts with context
    browserSteps.push({ status: 'opening', label: STATUS_LABELS['opening'] || '打开浏览器', done: true });
  }

  // Switch to browser panel
  switchToBrowserPanel();

  // Execute the task envelope
  const browserStore = useBrowserAgentStore.getState();
  await browserStore.executeTaskEnvelope(envelope);

  return true;
}

/**
 * Quick check if message might be a browser intent
 * (lighter check for use in input handlers)
 */
export function quickCheckBrowserIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  const hasDomain = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s，。！？,!?]*)?/i.test(message);
  const hasExplicitBrowserAction =
    lowerMessage.includes('打开') ||
    lowerMessage.includes('访问') ||
    lowerMessage.includes('浏览器') ||
    lowerMessage.includes('用浏览器') ||
    lowerMessage.includes('open ') ||
    lowerMessage.includes('visit ') ||
    lowerMessage.includes('browser') ||
    lowerMessage.includes('帮我去') ||
    lowerMessage.includes('去这个') ||
    lowerMessage.includes('去看看') ||
    lowerMessage.includes('帮我看看') ||
    lowerMessage.includes('去查查') ||
    lowerMessage.includes('看一下') ||
    lowerMessage.includes('查一下') ||
    lowerMessage.includes('去一下') ||
    lowerMessage.includes('帮我查');

  if (hasDomain && hasExplicitBrowserAction) {
    return true;
  }

  // First try the simple keyword check
  if (!mightBeBrowserIntent(message)) {
    // Check for auth-gated keywords
    const authGatedKeywords = [
      '上传 build',
      '上传 app',
      '上传新 build',
      'app store',
      '邮箱',
      '邮件',
      'gmail',
      'outlook',
      'hotmail',
      'qq邮箱',
      '163邮箱',
      'inbox',
      '收件箱',
      'aws',
      '阿里云',
      'vercel',
      'netlify',
    ];

    return authGatedKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
  }

  return true;
}
