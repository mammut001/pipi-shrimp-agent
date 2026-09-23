/**
 * @jest-environment jsdom
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useSessionFolderBindings } from '../useSessionFolderBindings';

const safeInvokeMock = jest.fn();
const safeInvokeOrNullMock = jest.fn();

jest.mock('@/utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => (safeInvokeMock as any)(...args),
  safeInvokeOrNull: (...args: unknown[]) => (safeInvokeOrNullMock as any)(...args),
}));

const mockSetSessionProjectDir = jest.fn();
const mockClearSessionProjectDir = jest.fn();
const mockSetSessionPipiOutputDir = jest.fn();
const mockClearSessionPipiOutputDir = jest.fn();

jest.mock('@/store', () => ({
  useChatStore: () => ({
    setSessionProjectDir: mockSetSessionProjectDir,
    clearSessionProjectDir: mockClearSessionProjectDir,
    setSessionPipiOutputDir: mockSetSessionPipiOutputDir,
    clearSessionPipiOutputDir: mockClearSessionPipiOutputDir,
  }),
}));

describe('useSessionFolderBindings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets isBindingFolder to project while binding and calls store action', async () => {
    let resolveBind: (val: string) => void;
    const bindPromise = new Promise<string>((resolve) => {
      resolveBind = resolve;
    });
    const setSessionProjectDir = jest.fn(() => bindPromise);

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        setSessionProjectDir,
      }),
    );

    let handlePromise: Promise<any>;
    act(() => {
      handlePromise = result.current.handleBindProject();
    });

    expect(result.current.isBindingFolder).toBe('project');
    expect(setSessionProjectDir).toHaveBeenCalledWith('session-1');

    await act(async () => {
      resolveBind!('/path/to/project');
      const res = await handlePromise;
      expect(res).toBe('/path/to/project');
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('finally clears isBindingFolder to null even if handleBindProject throws', async () => {
    const setSessionProjectDir = jest.fn(async () => {
      throw new Error('bind project failed');
    });

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        setSessionProjectDir,
      }),
    );

    await act(async () => {
      await expect(result.current.handleBindProject()).rejects.toThrow('bind project failed');
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('sets isBindingFolder to project while clearing and calls store action', async () => {
    let resolveClear: () => void;
    const clearPromise = new Promise<void>((resolve) => {
      resolveClear = resolve;
    });
    const clearSessionProjectDir = jest.fn(() => clearPromise);

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        clearSessionProjectDir,
      }),
    );

    let handlePromise: Promise<any>;
    act(() => {
      handlePromise = result.current.handleClearProject();
    });

    expect(result.current.isBindingFolder).toBe('project');
    expect(clearSessionProjectDir).toHaveBeenCalledWith('session-1');

    await act(async () => {
      resolveClear!();
      await handlePromise;
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('finally clears isBindingFolder to null even if handleClearProject throws', async () => {
    const clearSessionProjectDir = jest.fn(async () => {
      throw new Error('clear project failed');
    });

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        clearSessionProjectDir,
      }),
    );

    await act(async () => {
      await expect(result.current.handleClearProject()).rejects.toThrow('clear project failed');
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('sets isBindingFolder to output while binding and calls store action', async () => {
    let resolveBind: (val: string) => void;
    const bindPromise = new Promise<string>((resolve) => {
      resolveBind = resolve;
    });
    const setSessionPipiOutputDir = jest.fn(() => bindPromise);

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        setSessionPipiOutputDir,
      }),
    );

    let handlePromise: Promise<any>;
    act(() => {
      handlePromise = result.current.handleBindOutput();
    });

    expect(result.current.isBindingFolder).toBe('output');
    expect(setSessionPipiOutputDir).toHaveBeenCalledWith('session-1');

    await act(async () => {
      resolveBind!('/path/to/output');
      const res = await handlePromise;
      expect(res).toBe('/path/to/output');
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('finally clears isBindingFolder to null even if handleBindOutput throws', async () => {
    const setSessionPipiOutputDir = jest.fn(async () => {
      throw new Error('bind output failed');
    });

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        setSessionPipiOutputDir,
      }),
    );

    await act(async () => {
      await expect(result.current.handleBindOutput()).rejects.toThrow('bind output failed');
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('sets isBindingFolder to output while clearing and calls store action', async () => {
    let resolveClear: () => void;
    const clearPromise = new Promise<void>((resolve) => {
      resolveClear = resolve;
    });
    const clearSessionPipiOutputDir = jest.fn(() => clearPromise);

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        clearSessionPipiOutputDir,
      }),
    );

    let handlePromise: Promise<any>;
    act(() => {
      handlePromise = result.current.handleClearOutput();
    });

    expect(result.current.isBindingFolder).toBe('output');
    expect(clearSessionPipiOutputDir).toHaveBeenCalledWith('session-1');

    await act(async () => {
      resolveClear!();
      await handlePromise;
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('finally clears isBindingFolder to null even if handleClearOutput throws', async () => {
    const clearSessionPipiOutputDir = jest.fn(async () => {
      throw new Error('clear output failed');
    });

    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: { id: 'session-1' } as any,
        clearSessionPipiOutputDir,
      }),
    );

    await act(async () => {
      await expect(result.current.handleClearOutput()).rejects.toThrow('clear output failed');
    });

    expect(result.current.isBindingFolder).toBeNull();
  });

  it('safely no-ops when currentSession is null or missing', async () => {
    const { result } = renderHook(() =>
      useSessionFolderBindings({
        currentSession: null,
      }),
    );

    let bindProjRes: any;
    let bindOutRes: any;
    await act(async () => {
      bindProjRes = await result.current.handleBindProject();
      bindOutRes = await result.current.handleBindOutput();
      await result.current.handleClearProject();
      await result.current.handleClearOutput();
    });

    expect(bindProjRes).toBeNull();
    expect(bindOutRes).toBeNull();
    expect(mockSetSessionProjectDir).not.toHaveBeenCalled();
    expect(mockClearSessionProjectDir).not.toHaveBeenCalled();
    expect(mockSetSessionPipiOutputDir).not.toHaveBeenCalled();
    expect(mockClearSessionPipiOutputDir).not.toHaveBeenCalled();
  });

  describe('handleOpenFolder', () => {
    it('opens projectDir in finder when provided', async () => {
      safeInvokeMock.mockResolvedValueOnce(undefined);
      const { result } = renderHook(() =>
        useSessionFolderBindings({
          currentSession: { id: 'session-1' } as any,
          projectDir: '/my/workspace/repo',
        }),
      );

      await act(async () => {
        await result.current.handleOpenFolder();
      });

      expect(safeInvokeMock).toHaveBeenCalledWith('reveal_in_finder', {
        path: '/my/workspace/repo',
      }, { source: 'ChatInput.openFolder' });
    });

    it('falls back to default dir when projectDir is empty', async () => {
      safeInvokeOrNullMock.mockResolvedValueOnce('/fallback/chats/session-1');
      safeInvokeMock.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() =>
        useSessionFolderBindings({
          currentSession: { id: 'session-1' } as any,
          projectDir: undefined,
        }),
      );

      await act(async () => {
        await result.current.handleOpenFolder();
      });

      expect(safeInvokeOrNullMock).toHaveBeenCalledWith('get_app_default_dir', {
        sessionId: 'session-1',
      }, { source: 'ChatInput.getDefaultDir' });
      expect(safeInvokeMock).toHaveBeenCalledWith('reveal_in_finder', {
        path: '/fallback/chats/session-1',
      }, { source: 'ChatInput.openFolder' });
    });

    it('handles errors gracefully without throwing', async () => {
      safeInvokeMock.mockRejectedValueOnce(new Error('Tauri error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useSessionFolderBindings({
          currentSession: { id: 'session-1' } as any,
          projectDir: '/some/path',
        }),
      );

      await act(async () => {
        await expect(result.current.handleOpenFolder()).resolves.toBeUndefined();
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to open folder:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });
});
