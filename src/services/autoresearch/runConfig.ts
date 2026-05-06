import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import {
  buildAutoResearchAgentConfigSnapshot,
  type AutoResearchAgentConfigSnapshot,
} from './errors';

export interface AutoResearchRunConfigResolution {
  agentConfig: ResolvedAgentConfig;
  snapshot: AutoResearchAgentConfigSnapshot;
}

export function resolveAutoResearchRunConfig(): AutoResearchRunConfigResolution {
  const agentConfig = resolveActiveAgentConfig();
  const issues = validateResolvedAgentConfig(agentConfig);
  if (issues.length > 0 || !agentConfig) {
    throw new Error(formatAgentConfigValidationError(agentConfig, issues));
  }

  return {
    agentConfig,
    snapshot: buildAutoResearchAgentConfigSnapshot(agentConfig, 'settings.activeConfig'),
  };
}
