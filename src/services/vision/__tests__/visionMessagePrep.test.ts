import { beforeEach, describe, expect, it } from '@jest/globals';

import { useSettingsStore } from '@/store/settingsStore';
import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { DEFAULT_VISION_SETTINGS } from '@/types/vision';
import { prepareMessagesForVision } from '../visionMessagePrep';

const baseConfig: ResolvedAgentConfig = {
  configId: 'cfg-1',
  name: 'OpenAI',
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'secret',
  hasApiKey: true,
  baseUrl: 'https://api.openai.com/v1',
  hasBaseUrl: true,
  apiFormat: 'openai',
};

beforeEach(() => {
  useSettingsStore.setState({ visionSettings: DEFAULT_VISION_SETTINGS });
});

describe('prepareMessagesForVision', () => {
  it('keeps attachments for models with native vision support', () => {
    const messages = prepareMessagesForVision([{
      role: 'user',
      content: 'describe this',
      attachments: [{
        id: 'img-1',
        source: 'upload',
        mime: 'image/png',
        bytes: 128,
        encoding: 'base64',
        data: 'ZmFrZQ==',
        createdAt: 1,
      }],
    }], baseConfig);

    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].content).toBe('describe this');
  });

  it('converts attachments into placeholder text when the model is text-only', () => {
    const messages = prepareMessagesForVision([{
      role: 'user',
      content: 'check it',
      attachments: [{
        id: 'img-1',
        source: 'upload',
        mime: 'image/png',
        bytes: 128,
        encoding: 'base64',
        data: 'ZmFrZQ==',
        origPath: 'bug.png',
        createdAt: 1,
      }],
    }], {
      ...baseConfig,
      provider: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(messages[0].attachments).toBeUndefined();
    expect(String(messages[0].content)).toContain('[Vision fallback]');
    expect(String(messages[0].content)).toContain('bug.png');
  });

  it('converts attachments into placeholder text when vision is disabled globally', () => {
    useSettingsStore.setState({
      visionSettings: {
        ...DEFAULT_VISION_SETTINGS,
        policy: 'disabled',
      },
    });

    const messages = prepareMessagesForVision([{
      role: 'user',
      content: '',
      attachments: [{
        id: 'img-1',
        source: 'upload',
        mime: 'image/png',
        bytes: 128,
        encoding: 'base64',
        data: 'ZmFrZQ==',
        createdAt: 1,
      }],
    }], baseConfig);

    expect(messages[0].attachments).toBeUndefined();
    expect(String(messages[0].content)).toContain('Vision is disabled in settings');
  });
});
