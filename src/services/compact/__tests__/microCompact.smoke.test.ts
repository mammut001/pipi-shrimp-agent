const mockSafeInvoke = jest.fn();

jest.mock('@/utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
}));

describe('runMicrocompactCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeInvoke.mockRejectedValue(new Error('no tauri runtime'));
  });

  it('returns did_compact false instead of throwing when tauri commands are unavailable', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { runMicrocompactCheck } = await import('../microCompact');

    await expect(runMicrocompactCheck('session-1')).resolves.toEqual({ did_compact: false });
    expect(mockSafeInvoke).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });
});
