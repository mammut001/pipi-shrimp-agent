/**
 * Vision browser provider registry.
 *
 * Concrete vision backends (Fara, OmniParser, etc.) plug in here. We ship a
 * single deterministic mock provider so the rest of the agent loop can be
 * developed and tested without any real vision model runtime.
 *
 * Adding a real provider:
 *   1. Implement `VisionBrowserProvider` (see `types/visionBrowserAgent.ts`).
 *   2. Call `registerVisionProvider(provider)` at module load time.
 *   3. Update `defaultVisionProvider()` if the new provider should win.
 */

import type {
  VisionBrowserAction,
  VisionBrowserInput,
  VisionBrowserProvider,
} from '@/types/visionBrowserAgent';

const registry = new Map<string, VisionBrowserProvider>();

export const registerVisionProvider = (provider: VisionBrowserProvider): void => {
  if (!provider?.name) {
    return;
  }
  registry.set(provider.name, provider);
};

export const listVisionProviders = (): VisionBrowserProvider[] =>
  Array.from(registry.values());

export const getVisionProvider = (name: string): VisionBrowserProvider | undefined =>
  registry.get(name);

export const defaultVisionProviderName = (): string | undefined => {
  if (registry.has('mock')) return 'mock';
  return registry.keys().next().value;
};

export const defaultVisionProvider = (): VisionBrowserProvider | undefined => {
  const name = defaultVisionProviderName();
  return name ? registry.get(name) : undefined;
};

// ─── Mock provider ─────────────────────────────────────────────────────────

/**
 * Deterministic mock that "looks" at the screenshot dimensions and decides
 * to click in the centre of the viewport. Used by tests and by the agent
 * loop when no real provider is registered but the fallback is enabled.
 */
class MockVisionProvider implements VisionBrowserProvider {
  readonly name = 'mock';

  isReady(input: VisionBrowserInput): boolean {
    return Boolean(input?.screenshotRef?.value);
  }

  async observeAndAct(input: VisionBrowserInput): Promise<VisionBrowserAction> {
    const viewport = input?.viewport ?? { width: 1280, height: 720 };
    const cx = Math.max(1, Math.round(viewport.width / 2));
    const cy = Math.max(1, Math.round(viewport.height / 2));
    // Deterministic — always click centre. Tests can vary the screenshot ref
    // to confirm the right provider was invoked.
    return { action: 'left_click', coordinate: [cx, cy] };
  }
}

registerVisionProvider(new MockVisionProvider());
