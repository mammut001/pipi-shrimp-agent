import { buildProviderExecutionCapabilities } from '../capabilities';

describe('buildProviderExecutionCapabilities', () => {
  it('enables supportsToolCalls for standard agent models like Anthropic Claude, OpenAI GPT-4o, and DeepSeek-V3', () => {
    const claudeCaps = buildProviderExecutionCapabilities({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
    });
    expect(claudeCaps.supportsToolCalls).toBe(true);

    const gptCaps = buildProviderExecutionCapabilities({
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(gptCaps.supportsToolCalls).toBe(true);
    expect(gptCaps.supportsToolOpenAI).toBe(true);

    const deepseekV3Caps = buildProviderExecutionCapabilities({
      provider: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(deepseekV3Caps.supportsToolCalls).toBe(true);
  });

  it('enables thinking for current Claude generations and not for older ones', () => {
    const thinks = (model: string) => buildProviderExecutionCapabilities({
      provider: 'anthropic',
      apiFormat: 'anthropic',
      model,
    }).supportsThinking;

    for (const model of [
      'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1',
      'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-3-7-sonnet-20250219',
    ]) {
      expect(thinks(model)).toBe(true);
    }
    expect(thinks('claude-3-5-sonnet-20241022')).toBe(false);
  });

  it('disables supportsToolCalls for reasoning models like DeepSeek-R1 that do not support tool calling protocol', () => {
    const r1Caps = buildProviderExecutionCapabilities({
      provider: 'deepseek',
      model: 'deepseek-reasoner',
    });
    expect(r1Caps.supportsToolCalls).toBe(false);
    expect(r1Caps.supportsToolOpenAI).toBe(false);

    const o1MiniCaps = buildProviderExecutionCapabilities({
      provider: 'openai',
      model: 'o1-mini',
    });
    expect(o1MiniCaps.supportsToolCalls).toBe(false);
  });
});
