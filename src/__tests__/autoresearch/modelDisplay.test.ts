/**
 * AutoResearch Model Display Tests
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  buildAutoResearchModelDisplayFromResolvedConfig,
  buildAutoResearchModelDisplayFromSnapshot,
  formatAutoResearchModelDisplay,
  type AutoResearchModelDisplay,
} from '@/services/autoresearch/modelDisplay';
import type { AutoResearchAgentConfigSnapshot } from '@/services/autoresearch/errors';
import type { ResolvedAgentConfig } from '@/services/agentConfig';

// Mock i18n
jest.mock('@/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      'autoresearch.model.unknownProvider': 'Unknown provider',
      'autoresearch.model.unknownModel': 'Unknown model',
      'autoresearch.model.unknownCompact': 'Unknown provider · Unknown model',
    };
    return map[key] ?? key;
  },
}));

describe('AutoResearch Model Display', () => {
  describe('buildAutoResearchModelDisplayFromResolvedConfig', () => {
    it('returns unknown display for null config', () => {
      const result = buildAutoResearchModelDisplayFromResolvedConfig(null);
      expect(result.providerLabel).toBe('Unknown provider');
      expect(result.modelLabel).toBe('Unknown model');
      expect(result.compactLabel).toBe('Unknown provider · Unknown model');
      expect(result.isDemo).toBe(false);
    });

    it('formats OpenAI config correctly', () => {
      const config: ResolvedAgentConfig = {
        configId: 'cfg-123',
        name: 'My OpenAI Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: 'gpt-4.1',
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseUrl: true,
        apiKey: 'sk-xxxx',
      };

      const result = buildAutoResearchModelDisplayFromResolvedConfig(config);
      expect(result.providerLabel).toBe('OpenAI');
      expect(result.providerId).toBe('openai');
      expect(result.modelLabel).toBe('gpt-4.1');
      expect(result.configName).toBe('My OpenAI Config');
      expect(result.compactLabel).toBe('My OpenAI Config · OpenAI · gpt-4.1');
      expect(result.isDemo).toBe(false);
    });

    it('formats MiniMax config correctly', () => {
      const config: ResolvedAgentConfig = {
        configId: 'cfg-minimax',
        name: 'MiniMax Settings',
        provider: 'minimax',
        providerLabel: 'MiniMax',
        model: 'MiniMax-M2.5',
        baseUrl: 'https://api.minimax.chat/v1',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseUrl: true,
        apiKey: 'minimax-xxxx',
      };

      const result = buildAutoResearchModelDisplayFromResolvedConfig(config);
      expect(result.providerLabel).toBe('MiniMax');
      expect(result.providerId).toBe('minimax');
      expect(result.modelLabel).toBe('MiniMax-M2.5');
      expect(result.compactLabel).toBe('MiniMax Settings · MiniMax · MiniMax-M2.5');
      expect(result.isDemo).toBe(false);
    });

    it('handles empty model gracefully', () => {
      const config: ResolvedAgentConfig = {
        configId: 'cfg-empty',
        name: 'Empty Model Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: '',
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseUrl: true,
        apiKey: 'sk-xxxx',
      };

      const result = buildAutoResearchModelDisplayFromResolvedConfig(config);
      expect(result.modelLabel).toBe('Unknown model');
      expect(result.compactLabel).toBe('Empty Model Config · OpenAI · Unknown model');
    });

    it('uses provider labels from the resolved config instead of hardcoded mappings', () => {
      const config: ResolvedAgentConfig = {
        configId: 'cfg-custom',
        name: 'Custom Provider',
        provider: 'custom-provider',
        providerLabel: 'Custom Provider',
        model: 'custom-model',
        baseUrl: 'https://custom.api/v1',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseUrl: true,
        apiKey: 'key-xxxx',
      };

      const result = buildAutoResearchModelDisplayFromResolvedConfig(config);
      expect(result.providerLabel).toBe('Custom Provider');
      expect(result.modelLabel).toBe('custom-model');
      expect(result.compactLabel).toBe('Custom Provider · custom-model');
    });
  });

  describe('buildAutoResearchModelDisplayFromSnapshot', () => {
    it('returns unknown display for null snapshot', () => {
      const result = buildAutoResearchModelDisplayFromSnapshot(null);
      expect(result.providerLabel).toBe('Unknown provider');
      expect(result.modelLabel).toBe('Unknown model');
      expect(result.isDemo).toBe(false);
    });

    it('returns unknown display for undefined snapshot', () => {
      const result = buildAutoResearchModelDisplayFromSnapshot(undefined);
      expect(result.providerLabel).toBe('Unknown provider');
      expect(result.modelLabel).toBe('Unknown model');
    });

    it('marks fallback source as demo', () => {
      const snapshot: AutoResearchAgentConfigSnapshot = {
        configId: 'demo-config',
        configName: 'Demo Config',
        provider: 'demo',
        providerLabel: 'Demo Provider',
        apiFormat: 'openai',
        baseUrl: 'https://demo.example.com',
        model: 'demo-model',
        keyPreview: 'DEMO',
        keyPresent: true,
        source: 'fallback',
      };

      const result = buildAutoResearchModelDisplayFromSnapshot(snapshot);
      expect(result.isDemo).toBe(true);
      expect(result.providerLabel).toBe('Demo Provider');
      expect(result.modelLabel).toBe('demo-model');
      expect(result.compactLabel).toBe('Demo Config · Demo Provider · demo-model');
    });

    it('marks settings.activeConfig as not demo', () => {
      const snapshot: AutoResearchAgentConfigSnapshot = {
        configId: 'cfg-openai',
        configName: 'Real Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        keyPreview: 'sk-xxxx',
        keyPresent: true,
        source: 'settings.activeConfig',
      };

      const result = buildAutoResearchModelDisplayFromSnapshot(snapshot);
      expect(result.isDemo).toBe(false);
      expect(result.providerLabel).toBe('OpenAI');
      expect(result.compactLabel).toBe('Real Config · OpenAI · gpt-4.1');
    });

    it('formats provider correctly', () => {
      const snapshot: AutoResearchAgentConfigSnapshot = {
        configId: 'cfg-anthropic',
        configName: 'Anthropic Config',
        provider: 'anthropic',
        providerLabel: 'Anthropic',
        apiFormat: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-20250514',
        keyPreview: 'sk-ant-xxxx',
        keyPresent: true,
        source: 'settings.activeConfig',
      };

      const result = buildAutoResearchModelDisplayFromSnapshot(snapshot);
      expect(result.providerLabel).toBe('Anthropic');
      expect(result.modelLabel).toBe('claude-sonnet-4-20250514');
      expect(result.compactLabel).toBe('Anthropic Config · Anthropic · claude-sonnet-4-20250514');
    });
  });

  describe('formatAutoResearchModelDisplay', () => {
    it('returns compact label by default', () => {
      const display: AutoResearchModelDisplay = {
        providerLabel: 'OpenAI',
        providerId: 'openai',
        modelLabel: 'gpt-4.1',
        configName: 'My Config',
        compactLabel: 'My Config · OpenAI · gpt-4.1',
        isDemo: false,
      };

      expect(formatAutoResearchModelDisplay(display)).toBe('My Config · OpenAI · gpt-4.1');
    });

    it('respects compact option', () => {
      const display: AutoResearchModelDisplay = {
        providerLabel: 'OpenAI',
        providerId: 'openai',
        modelLabel: 'gpt-4.1',
        configName: 'My Config',
        compactLabel: 'My Config · OpenAI · gpt-4.1',
        isDemo: false,
      };

      expect(formatAutoResearchModelDisplay(display, { compact: true })).toBe('My Config · OpenAI · gpt-4.1');
    });
  });

  describe('no hardcoded MiniMax in real runs', () => {
    it('does not hardcode MiniMax provider label for non-MiniMax providers', () => {
      const config: ResolvedAgentConfig = {
        configId: 'cfg-test',
        name: 'Test Config',
        provider: 'openai',
        providerLabel: 'OpenAI',
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
        apiFormat: 'openai',
        hasApiKey: true,
        hasBaseUrl: true,
        apiKey: 'sk-xxxx',
      };

      const result = buildAutoResearchModelDisplayFromResolvedConfig(config);
      expect(result.providerLabel).not.toBe('minimax');
      expect(result.providerLabel).not.toBe('MiniMax');
      expect(result.compactLabel).not.toMatch(/minimax/i);
    });

    it('demo source is clearly marked as demo', () => {
      const snapshot: AutoResearchAgentConfigSnapshot = {
        configId: 'demo-config',
        configName: 'Demo',
        provider: 'demo',
        providerLabel: 'Demo Provider',
        apiFormat: 'openai',
        baseUrl: 'https://demo.example.com',
        model: 'demo-model',
        keyPreview: 'DEMO',
        keyPresent: true,
        source: 'fallback',
      };

      const result = buildAutoResearchModelDisplayFromSnapshot(snapshot);
      expect(result.isDemo).toBe(true);
    });

    it('keeps MiniMax-M2.5 out of non-demo AutoResearch production display files', () => {
      const filesToCheck = [
        'src/components/AutoResearchPanel.tsx',
        'src/components/autoresearch/AutoResearchRunChips.tsx',
        'src/components/autoresearch/AutoResearchDashboardHeader.tsx',
        'src/components/autoresearch/AutoResearchDashboardView.tsx',
        'src/services/autoresearch/modelDisplay.ts',
        'src/services/autoresearch/runDocument.ts',
      ];

      filesToCheck.forEach((filePath) => {
        const content = fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
        expect(content).not.toContain('MiniMax-M2.5');
      });
    });
  });
});