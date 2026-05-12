import { describe, expect, it } from '@jest/globals';
import {
  normalizePersistedAgentSettings,
  normalizePersistedCurrentView,
} from '../storageMigrations';

describe('storageMigrations', () => {
  it('redirects the deprecated browser view to chat', () => {
    expect(normalizePersistedCurrentView('browser')).toEqual({
      currentView: 'chat',
      migratedFromBrowser: true,
    });
  });

  it('keeps supported persisted views unchanged', () => {
    expect(normalizePersistedCurrentView('workflow')).toEqual({
      currentView: 'workflow',
      migratedFromBrowser: false,
    });
  });

  it('falls back to chat for unknown persisted views', () => {
    expect(normalizePersistedCurrentView('settings')).toEqual({
      currentView: 'chat',
      migratedFromBrowser: false,
    });
  });

  it('bumps the old agent tool-round default to the current default', () => {
    expect(normalizePersistedAgentSettings(JSON.stringify({ maxToolRounds: 10 }))).toEqual({
      agentSettings: { maxToolRounds: 17 },
      migrated: true,
    });
  });

  it('clamps invalid agent tool-round values', () => {
    expect(normalizePersistedAgentSettings(JSON.stringify({ maxToolRounds: 250 }))).toEqual({
      agentSettings: { maxToolRounds: 100 },
      migrated: true,
    });
    expect(normalizePersistedAgentSettings(JSON.stringify({ maxToolRounds: 0 }))).toEqual({
      agentSettings: { maxToolRounds: 17 },
      migrated: true,
    });
  });

  it('handles malformed agent settings storage safely', () => {
    expect(normalizePersistedAgentSettings('{bad json')).toEqual({
      agentSettings: { maxToolRounds: 17 },
      migrated: true,
    });
  });
});
