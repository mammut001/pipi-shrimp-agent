jest.mock('@tauri-apps/api/core', () => ({
  invoke: jest.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

import { clickBrowserElement, typeIntoBrowserElement } from '@/utils/browserActionClient';

const invokeMock = invoke as jest.MockedFunction<typeof invoke>;

describe('browserActionClient', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue('ok' as never);
  });

  it('passes navigationId through browser_click', async () => {
    await clickBrowserElement({
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
    });

    expect(invokeMock).toHaveBeenCalledWith('browser_click', {
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
    });
  });

  it('passes navigationId through browser_type', async () => {
    await typeIntoBrowserElement(
      {
        elementId: 7,
        backendNodeId: 88,
        navigationId: 'nav-1',
      },
      'hello world',
    );

    expect(invokeMock).toHaveBeenCalledWith('browser_type', {
      elementId: 7,
      backendNodeId: 88,
      navigationId: 'nav-1',
      text: 'hello world',
    });
  });
});