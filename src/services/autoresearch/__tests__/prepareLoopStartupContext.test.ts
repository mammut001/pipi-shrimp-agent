import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../runDir', () => ({
  executeTargetCommand: jest.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' })),
  pathExistsOnTarget: jest.fn(async () => true),
  readTargetText: jest.fn(async () => null),
  writeTargetText: jest.fn(async () => undefined),
}));

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: jest.fn(() => ({
      updateRunPaths: jest.fn(),
    })),
  },
}));

import { useAutoResearchStore } from '@/store/autoresearchStore';
import { pathExistsOnTarget, readTargetText, writeTargetText } from '../runDir';
import { prepareLoopStartupContext } from '../preflight';

const pathExistsMock = pathExistsOnTarget as jest.MockedFunction<typeof pathExistsOnTarget>;
const readTargetTextMock = readTargetText as jest.MockedFunction<typeof readTargetText>;
const writeTargetTextMock = writeTargetText as jest.MockedFunction<typeof writeTargetText>;
const updateRunPathsMock = jest.fn();

describe('prepareLoopStartupContext (AG-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAutoResearchStore.getState as jest.Mock).mockReturnValue({
      updateRunPaths: updateRunPathsMock,
    });
    pathExistsMock.mockResolvedValue(true);
    readTargetTextMock.mockResolvedValue(null);
  });

  it('throws when ssh config is missing', async () => {
    await expect(prepareLoopStartupContext({
      sshConfig: null,
    } as never)).rejects.toThrow('SSH config not set');
  });

  it('initializes session file and updates run paths', async () => {
    const store = {
      id: 'session-1',
      sshConfig: {
        mode: 'local',
        remoteWorkDir: '/work',
      },
      experimentDir: '/work/experiment',
      sessionFilePath: '/work/session.md',
      metricName: 'loss',
      metricDirection: 'lower',
      maxIterations: 3,
    } as never;

    const startup = await prepareLoopStartupContext(store);

    expect(writeTargetTextMock).toHaveBeenCalled();
    expect(updateRunPathsMock).toHaveBeenCalled();
    expect(startup.workDir).toBe('/work');
    expect(startup.experimentDir).toBe('/work/experiment');
    expect(startup.sessionContent).toContain('AutoResearch Session');
  });
});