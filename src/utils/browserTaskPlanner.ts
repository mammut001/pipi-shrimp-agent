/**
 * Browser Task Planner - Convert browser intent into task envelopes
 *
 * Creates structured task envelopes from user requests
 */

import type {
  BrowserTaskEnvelope,
  BrowserConnectorType,
  BrowserControlMode,
} from '../types/browser';
import {
  matchProfileByUrl,
  getAuthPolicyForProfile,
} from './browserProfiles';

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `browser-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Check if a URL or intent likely requires authentication
 */
function requiresLogin(targetUrl: string, intent: string): boolean {
  // Known auth-gated sites
  const authGatedPatterns = [
    'appstoreconnect.apple.com',
    'developer.apple.com',
    'github.com/settings',
    'mail.google.com',
    'drive.google.com',
    'web.whatsapp.com',
    'web.telegram.org',
    'slack.com',
    'console.aws.amazon.com',
    'cloud.google.com',
    'azure.microsoft.com',
  ];

  const lowerUrl = targetUrl.toLowerCase();
  const lowerIntent = intent.toLowerCase();

  // Check URL against known auth-gated patterns
  for (const pattern of authGatedPatterns) {
    if (lowerUrl.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  // Check intent for login-related keywords
  const loginKeywords = [
    'log in',
    'login',
    'sign in',
    'signin',
    'upload',
    'publish',
    'deploy',
    'settings',
    'configure',
    'account',
    'profile',
    'delete',
    'modify',
    'update',
    'create',
    'send message',
    'whatsapp',
    'telegram',
    'slack',
    'email',
  ];

  return loginKeywords.some(keyword => lowerIntent.includes(keyword));
}

/**
 * Infer connector type from URL
 */
function inferConnectorType(url: string): BrowserConnectorType {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('whatsapp')) {
    return 'im_whatsapp';
  }
  if (lowerUrl.includes('telegram')) {
    return 'im_telegram';
  }
  if (lowerUrl.includes('slack')) {
    return 'im_slack';
  }

  return 'browser_web';
}

/**
 * Determine allowed control mode based on site profile
 */
function determineControlMode(
  profileId: string,
  requiresLogin: boolean,
  intent: string
): BrowserControlMode {
  // If requires login, default to manual handoff
  if (requiresLogin) {
    return 'manual_handoff';
  }

  // Check for sensitive operations
  const sensitiveKeywords = [
    'delete',
    'remove',
    'payment',
    'purchase',
    'buy',
    'transfer',
    'money',
    'financial',
  ];

  const lowerIntent = intent.toLowerCase();
  if (sensitiveKeywords.some(keyword => lowerIntent.includes(keyword))) {
    return 'mixed_supervised';
  }

  // Default based on profile
  if (profileId === 'google' || profileId === 'app_store_connect') {
    return 'mixed_supervised';
  }

  return 'agent_controlled';
}

/**
 * Create a browser task envelope from URL and intent
 */
export function createTaskEnvelope(
  targetUrl: string,
  userIntent: string,
  executionPrompt: string
): BrowserTaskEnvelope {
  // Normalize URL
  let normalizedUrl = targetUrl.trim();
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Match to profile
  const profile = matchProfileByUrl(normalizedUrl);

  // Determine if login is required
  const loginRequired = requiresLogin(normalizedUrl, userIntent);

  // Get auth policy
  const authPolicy = loginRequired
    ? 'manual_login_required'
    : getAuthPolicyForProfile(profile.id);

  // Determine control mode
  const controlMode = determineControlMode(profile.id, loginRequired, userIntent);

  // Determine connector type
  const connectorType = profile.connectorType !== 'generic_web'
    ? profile.connectorType
    : inferConnectorType(normalizedUrl);

  return {
    id: generateTaskId(),
    connectorType,
    siteProfileId: profile.id,
    targetUrl: normalizedUrl,
    userIntent,
    executionPrompt,
    requiresLogin: loginRequired,
    authPolicy,
    allowedControlMode: controlMode,
    metadata: {
      createdAt: Date.now(),
      profileLabel: profile.label,
    },
  };
}

/**
 * Validate if a task can be executed in current state
 */
export function validateTaskForExecution(
  envelope: BrowserTaskEnvelope,
  isAuthenticated: boolean,
  isReadyForAgent: boolean
): { valid: boolean; reason?: string } {
  // Check if login is required but user is not authenticated
  if (envelope.requiresLogin && !isAuthenticated && envelope.authPolicy === 'manual_login_required') {
    return {
      valid: false,
      reason: '此任务需要登录。请先在浏览器中完成登录。',
    };
  }

  // Check if ready for agent
  if (!isReadyForAgent) {
    return {
      valid: false,
      reason: '浏览器尚未准备好执行任务。请检查页面状态。',
    };
  }

  // Check control mode
  if (envelope.allowedControlMode === 'manual_handoff') {
    return {
      valid: false,
      reason: '此任务需要手动控制模式。请切换到手动模式后重试。',
    };
  }

  return { valid: true };
}

/**
 * Create a task envelope from chat message intent
 */
export function createTaskFromChatIntent(
  message: string,
  existingUrl?: string
): BrowserTaskEnvelope | null {
  // Simple intent detection for browser tasks
  const browserKeywords = [
    '打开',
    'open',
    '访问',
    'visit',
    '浏览',
    'browse',
    '搜索',
    'search',
    '上传',
    'upload',
    '下载',
    'download',
    '登录',
    'login',
    'whatsapp',
    'telegram',
    'slack',
    'github',
    'google',
  ];

  const lowerMessage = message.toLowerCase();

  // Check if this is a browser task
  if (!browserKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()))) {
    return null;
  }

  // Try to extract URL from message
  let targetUrl = existingUrl || '';

  // Simple URL extraction (handles common patterns)
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const urlMatch = message.match(urlPattern);
  if (urlMatch) {
    targetUrl = urlMatch[0];
  }

  // Default to Google if no URL found but seems like a browser task
  if (!targetUrl) {
    // Use intent to determine default site
    if (lowerMessage.includes('whatsapp')) {
      targetUrl = 'https://web.whatsapp.com';
    } else if (lowerMessage.includes('telegram')) {
      targetUrl = 'https://web.telegram.org';
    } else if (lowerMessage.includes('github')) {
      targetUrl = 'https://github.com';
    } else if (lowerMessage.includes('mail') || lowerMessage.includes('邮箱')) {
      targetUrl = 'https://mail.google.com';
    }
  }

  if (!targetUrl) {
    return null;
  }

  return createTaskEnvelope(targetUrl, message, message);
}

/**
 * Estimate task complexity for UI feedback
 */
export function estimateTaskComplexity(envelope: BrowserTaskEnvelope): 'simple' | 'medium' | 'complex' {
  const promptLength = envelope.executionPrompt.length;

  // Check for complex operations
  const complexPatterns = [
    'upload multiple',
    'batch',
    'loop',
    'iterate',
    'fill form',
    'multi-step',
    '流程',
    '多个',
    '批量',
  ];

  const lowerPrompt = envelope.executionPrompt.toLowerCase();

  if (complexPatterns.some(p => lowerPrompt.includes(p)) || promptLength > 200) {
    return 'complex';
  }

  if (promptLength > 100 || envelope.requiresLogin) {
    return 'medium';
  }

  return 'simple';
}

/**
 * Get suggested next steps based on task envelope
 */
export function getSuggestedNextSteps(envelope: BrowserTaskEnvelope): string[] {
  const steps: string[] = [];

  if (envelope.requiresLogin && envelope.authPolicy === 'manual_login_required') {
    steps.push('在浏览器窗口中完成登录');
    steps.push('点击"我已登录"按钮');
  }

  if (envelope.allowedControlMode === 'mixed_supervised') {
    steps.push('Agent 会在敏感操作前请求确认');
  }

  steps.push('Agent 将开始执行任务');

  if (envelope.siteProfileId === 'app_store_connect') {
    steps.push('如果页面重定向到登录，任务会自动暂停');
  }

  return steps;
}
