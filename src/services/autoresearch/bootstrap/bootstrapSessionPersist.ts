import type { AutoResearchBootstrapResult, BootstrapStep } from './types';
import type { Recipe } from '@/components/autoresearch/bootstrapRecipePrompt';

export const AUTORESEARCH_BOOTSTRAP_SESSION_STORAGE_KEY = 'pipi-shrimp-autoresearch-bootstrap-session-v1';
const MAX_PERSISTED_LOG_CHARS = 80_000;

export interface PersistedBootstrapSession {
  version: 1;
  recipe: Recipe;
  recipeDirty: boolean;
  selectedTemplateId: string | null;
  templatesExpanded: boolean;
  hasStarted: boolean;
  readyResult: AutoResearchBootstrapResult | null;
  currentStep: BootstrapStep;
  observedTools: string[];
  warnings: string[];
  iterations: number;
  agentLogs: string;
  handoffSummary: string | null;
  lastCompiledPrompt: string | null;
  missingFinalize: boolean;
  error: string | null;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function capLogs(value: string): string {
  if (value.length <= MAX_PERSISTED_LOG_CHARS) {
    return value;
  }
  return value.slice(value.length - MAX_PERSISTED_LOG_CHARS);
}

export function persistBootstrapSession(session: PersistedBootstrapSession): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const payload: PersistedBootstrapSession = {
      ...session,
      agentLogs: capLogs(session.agentLogs || ''),
      version: 1,
    };
    storage.setItem(AUTORESEARCH_BOOTSTRAP_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to persist AutoResearch bootstrap session:', error);
  }
}

export function loadPersistedBootstrapSession(): PersistedBootstrapSession | null {
  const storage = safeLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(AUTORESEARCH_BOOTSTRAP_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedBootstrapSession>;
    if (parsed.version !== 1 || !parsed.recipe || typeof parsed.recipe !== 'object') {
      return null;
    }
    return {
      version: 1,
      recipe: parsed.recipe,
      recipeDirty: Boolean(parsed.recipeDirty),
      selectedTemplateId: typeof parsed.selectedTemplateId === 'string' ? parsed.selectedTemplateId : null,
      templatesExpanded: parsed.templatesExpanded !== false,
      hasStarted: Boolean(parsed.hasStarted),
      readyResult: parsed.readyResult && parsed.readyResult.status ? parsed.readyResult : null,
      currentStep: parsed.currentStep || 'goal',
      observedTools: Array.isArray(parsed.observedTools) ? parsed.observedTools : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      iterations: typeof parsed.iterations === 'number' && Number.isFinite(parsed.iterations)
        ? Math.max(1, Math.round(parsed.iterations))
        : 5,
      agentLogs: typeof parsed.agentLogs === 'string' ? parsed.agentLogs : '',
      handoffSummary: typeof parsed.handoffSummary === 'string' ? parsed.handoffSummary : null,
      lastCompiledPrompt: typeof parsed.lastCompiledPrompt === 'string' ? parsed.lastCompiledPrompt : null,
      missingFinalize: Boolean(parsed.missingFinalize),
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
  } catch {
    return null;
  }
}

export function clearPersistedBootstrapSession(): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(AUTORESEARCH_BOOTSTRAP_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
