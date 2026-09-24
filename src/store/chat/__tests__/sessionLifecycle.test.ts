import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

jest.mock('../../../utils/chatHelpers', () => ({
  sessionToDb: jest.fn(),
}));

jest.mock('../../../utils/safeInvoke', () => ({
  safeInvoke: jest.fn(),
}));

jest.mock('../../../utils/sessionFolders', () => ({
  getSessionPipiOutputDir: jest.fn(),
}));

jest.mock('../../../utils/safeStorage', () => ({
  safeSetItem: jest.fn(),
  safeRemoveItem: jest.fn(),
}));

jest.mock('../../uiStore', () => {
  const state = {
    clearQuestionnaire: jest.fn(),
    clearPermissionsForSession: jest.fn(),
    clearAllPermissions: jest.fn(),
    clearArtifactId: jest.fn(),
    clearTaskProgress: jest.fn(),
    setActiveSkill: jest.fn(),
    setAgentPanelTab: jest.fn(),
  };
  return { useUIStore: { getState: jest.fn(() => state) } };
});

jest.mock('../../artifactsStore', () => {
  const state = { closePanel: jest.fn() };
  return { useArtifactsStore: { getState: jest.fn(() => state) } };
});

import { useArtifactsStore } from '../../artifactsStore';
import { useUIStore } from '../../uiStore';
import { safeRemoveItem, safeSetItem } from '../../../utils/safeStorage';
import {
  CURRENT_SESSION_ID_STORAGE_KEY,
  resetRightPanelStateAfterSessionRemoval,
} from '../sessionLifecycle';

const safeSetItemMock = safeSetItem as jest.MockedFunction<typeof safeSetItem>;
const safeRemoveItemMock = safeRemoveItem as jest.MockedFunction<typeof safeRemoveItem>;

describe('session lifecycle helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears current-session UI and selects the next session after deletion', () => {
    const ui = useUIStore.getState();

    resetRightPanelStateAfterSessionRemoval(['session-a'], 'session-b', 'session-a');

    expect(ui.clearQuestionnaire).toHaveBeenCalledWith('session-a');
    expect(ui.clearPermissionsForSession).toHaveBeenCalledWith('session-a');
    expect(ui.clearArtifactId).toHaveBeenCalled();
    expect(ui.clearTaskProgress).toHaveBeenCalled();
    expect(ui.setActiveSkill).toHaveBeenCalledWith(null);
    expect(ui.setAgentPanelTab).toHaveBeenCalledWith('main');
    expect(ui.clearAllPermissions).not.toHaveBeenCalled();
    expect(useArtifactsStore.getState().closePanel).toHaveBeenCalled();
    expect(safeSetItemMock).toHaveBeenCalledWith(CURRENT_SESSION_ID_STORAGE_KEY, 'session-b');
  });

  it('clears global permissions and stored selection when no sessions remain', () => {
    const ui = useUIStore.getState();

    resetRightPanelStateAfterSessionRemoval(['session-a'], null, 'session-a');

    expect(ui.clearAllPermissions).toHaveBeenCalled();
    expect(ui.clearArtifactId).toHaveBeenCalled();
    expect(useArtifactsStore.getState().closePanel).toHaveBeenCalled();
    expect(safeRemoveItemMock).toHaveBeenCalledWith(CURRENT_SESSION_ID_STORAGE_KEY);
    expect(safeSetItemMock).not.toHaveBeenCalled();
  });
});
