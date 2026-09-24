import {
  persistAutoResearchHistory,
  setHistoryPersistListener,
  type AutoResearchRunEvent,
  type AutoResearchRunRecord,
} from '@/services/autoresearch/history';
import {
  persistAutoResearchLastUsedConfig,
  type AutoResearchDefaultConfig,
} from '@/services/autoresearch/defaultConfig';

type AutoResearchPersistableState = {
  runHistory: AutoResearchRunRecord[];
  selectedRunId: string | null;
  lastUsedConfig: AutoResearchDefaultConfig | null;
  addRunEvent: (
    input: Omit<AutoResearchRunEvent, 'id' | 'runId' | 'timestamp'> & { timestamp?: string },
  ) => void;
};

type AutoResearchPersistenceStore = {
  getState: () => AutoResearchPersistableState;
  subscribe: (listener: (state: AutoResearchPersistableState) => void) => () => void;
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let getLatestState: (() => AutoResearchPersistableState) | null = null;
let connected = false;
const PERSIST_DEBOUNCE_MS = 500;

const schedulePersist = (_state: AutoResearchPersistableState): void => {
  if (typeof window === 'undefined') return;
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const latest = getLatestState?.();
    if (!latest) return;
    persistAutoResearchHistory(latest.runHistory, latest.selectedRunId);
    persistAutoResearchLastUsedConfig(latest.lastUsedConfig);
  }, PERSIST_DEBOUNCE_MS);
};

export function flushAutoResearchPersistOnClose(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    const state = getLatestState?.();
    if (!state) return;
    persistAutoResearchHistory(state.runHistory, state.selectedRunId);
    persistAutoResearchLastUsedConfig(state.lastUsedConfig);
  } catch (flushError) {
    console.error('Failed to flush AutoResearch history on close:', flushError);
  }
}

export function connectAutoResearchPersistence(store: AutoResearchPersistenceStore): void {
  if (connected) return;
  connected = true;
  getLatestState = store.getState;
  store.subscribe((state) => {
    schedulePersist(state);
  });

  if (typeof window === 'undefined') return;

  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().onCloseRequested(async (event) => {
        flushAutoResearchPersistOnClose();
        void event;
      });
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.debug('Tauri onCloseRequested unavailable, using beforeunload fallback:', error);
      }
    }
  })();

  window.addEventListener('beforeunload', () => {
    flushAutoResearchPersistOnClose();
  });

  setHistoryPersistListener((message) => {
    const state = getLatestState?.();
    if (!state) return;
    state.addRunEvent({
      level: 'error',
      phase: 'system',
      message,
      summary: message,
    });
  });
}
