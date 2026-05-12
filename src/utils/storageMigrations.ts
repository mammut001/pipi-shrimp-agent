export type PersistedCurrentView = 'chat' | 'workflow' | 'skill' | 'diagnostics';

export interface PersistedAgentSettings {
  maxToolRounds: number;
}

export interface CurrentViewMigrationResult {
  currentView: PersistedCurrentView;
  migratedFromBrowser: boolean;
}

export function normalizePersistedCurrentView(value: string | null): CurrentViewMigrationResult {
  if (value === 'browser') {
    return {
      currentView: 'chat',
      migratedFromBrowser: true,
    };
  }

  if (value === 'chat' || value === 'workflow' || value === 'skill' || value === 'diagnostics') {
    return {
      currentView: value,
      migratedFromBrowser: false,
    };
  }

  return {
    currentView: 'chat',
    migratedFromBrowser: false,
  };
}

export interface AgentSettingsMigrationResult {
  agentSettings: PersistedAgentSettings;
  migrated: boolean;
}

const DEFAULT_AGENT_SETTINGS: PersistedAgentSettings = {
  maxToolRounds: 17,
};

const MIN_TOOL_ROUNDS = 1;
const MAX_TOOL_ROUNDS = 100;

export function normalizePersistedAgentSettings(value: string | null): AgentSettingsMigrationResult {
  if (!value) {
    return {
      agentSettings: DEFAULT_AGENT_SETTINGS,
      migrated: false,
    };
  }

  try {
    const parsed = JSON.parse(value) as Partial<PersistedAgentSettings>;
    const rawMaxToolRounds = Number(parsed.maxToolRounds);
    let maxToolRounds = Number.isFinite(rawMaxToolRounds)
      ? Math.trunc(rawMaxToolRounds)
      : DEFAULT_AGENT_SETTINGS.maxToolRounds;
    let migrated = maxToolRounds !== parsed.maxToolRounds;

    if (maxToolRounds === 10) {
      maxToolRounds = DEFAULT_AGENT_SETTINGS.maxToolRounds;
      migrated = true;
    }

    if (maxToolRounds < MIN_TOOL_ROUNDS) {
      maxToolRounds = DEFAULT_AGENT_SETTINGS.maxToolRounds;
      migrated = true;
    } else if (maxToolRounds > MAX_TOOL_ROUNDS) {
      maxToolRounds = MAX_TOOL_ROUNDS;
      migrated = true;
    }

    return {
      agentSettings: {
        ...DEFAULT_AGENT_SETTINGS,
        ...parsed,
        maxToolRounds,
      },
      migrated,
    };
  } catch {
    return {
      agentSettings: DEFAULT_AGENT_SETTINGS,
      migrated: true,
    };
  }
}