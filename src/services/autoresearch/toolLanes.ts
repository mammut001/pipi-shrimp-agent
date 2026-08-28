import type { SshConfig } from '@/store/autoresearchStore';
import type { AutoResearchRunPhase } from './history';
import { getAutoResearchToolProfile } from './toolCatalog';

const TOOL_LANE_PHASE_ORDER: AutoResearchRunPhase[] = [
  'READ_CONTEXT',
  'PLAN_HYPOTHESIS',
  'EDIT_CODE',
  'RUN_EXPERIMENT',
  'PARSE_METRICS',
  'REFLECT',
  'DECIDE_NEXT',
  'DONE',
  'FAILED',
];

function phaseRank(phase: AutoResearchRunPhase): number {
  return TOOL_LANE_PHASE_ORDER.indexOf(phase);
}

function uniqueTools(tools: Array<string | undefined>): string[] {
  return Array.from(new Set(tools.filter((tool): tool is string => Boolean(tool))));
}

export function getAutoResearchAllowedToolsForPhase(
  config: Pick<SshConfig, 'mode'> | null | undefined,
  phase: AutoResearchRunPhase,
): string[] {
  const profile = getAutoResearchToolProfile(config);
  const createDirectoryTool = profile.mode === 'local' ? profile.createDirectoryTool : undefined;
  const writeTool = profile.mode === 'local' ? profile.writeTool : profile.uploadTool;

  switch (phase) {
    case 'READ_CONTEXT':
    case 'PLAN_HYPOTHESIS':
      return uniqueTools([
        'get_current_workspace',
        profile.readTool,
      ]);
    case 'EDIT_CODE':
      return uniqueTools([
        'get_current_workspace',
        profile.commandTool,
        profile.readTool,
        createDirectoryTool,
        writeTool,
      ]);
    case 'RUN_EXPERIMENT':
      return uniqueTools([
        'get_current_workspace',
        profile.commandTool,
        profile.readTool,
      ]);
    case 'PARSE_METRICS':
    case 'REFLECT':
    case 'DECIDE_NEXT':
      return uniqueTools([
        'get_current_workspace',
        profile.readTool,
        writeTool,
        createDirectoryTool,
      ].filter((t): t is string => typeof t === 'string'));
    case 'DONE':
    case 'FAILED':
    default:
      return uniqueTools([
        'get_current_workspace',
      ]);
  }
}

export function formatAutoResearchToolLanes(
  config: Pick<SshConfig, 'mode'> | null | undefined,
): string {
  const phases: AutoResearchRunPhase[] = [
    'READ_CONTEXT',
    'EDIT_CODE',
    'RUN_EXPERIMENT',
    'PARSE_METRICS',
    'DECIDE_NEXT',
  ];

  return phases
    .map((phase) => `${phase}: ${getAutoResearchAllowedToolsForPhase(config, phase).join(', ')}`)
    .join('\n');
}

export function isAutoResearchToolLaneTransitionAllowed(
  currentPhase: AutoResearchRunPhase,
  nextPhase: AutoResearchRunPhase,
): boolean {
  return phaseRank(nextPhase) >= phaseRank(currentPhase);
}

export function classifyAutoResearchToolPhase(input: {
  currentPhase: AutoResearchRunPhase;
  toolName: string;
  isExperimentRun: boolean;
  config: Pick<SshConfig, 'mode'> | null | undefined;
}): AutoResearchRunPhase {
  const profile = getAutoResearchToolProfile(input.config);
  const createDirectoryTool = profile.mode === 'local' ? profile.createDirectoryTool : undefined;
  const writeTool = profile.mode === 'local' ? profile.writeTool : profile.uploadTool;

  if (input.toolName === 'get_current_workspace' || input.toolName === profile.readTool) {
    if (input.currentPhase === 'RUN_EXPERIMENT' || input.currentPhase === 'PARSE_METRICS') {
      return 'PARSE_METRICS';
    }
    if (input.currentPhase === 'REFLECT' || input.currentPhase === 'DECIDE_NEXT') {
      return input.currentPhase;
    }
    if (input.currentPhase === 'EDIT_CODE') {
      return 'EDIT_CODE';
    }
    return 'READ_CONTEXT';
  }

  if (createDirectoryTool && input.toolName === createDirectoryTool) {
    if (
      input.currentPhase === 'RUN_EXPERIMENT' ||
      input.currentPhase === 'PARSE_METRICS' ||
      input.currentPhase === 'DECIDE_NEXT' ||
      input.currentPhase === 'REFLECT'
    ) {
      return 'PARSE_METRICS';
    }
    return 'EDIT_CODE';
  }

  if (writeTool && input.toolName === writeTool) {
    if (
      input.currentPhase === 'RUN_EXPERIMENT' ||
      input.currentPhase === 'PARSE_METRICS' ||
      input.currentPhase === 'DECIDE_NEXT' ||
      input.currentPhase === 'REFLECT'
    ) {
      return 'PARSE_METRICS';
    }
    return 'EDIT_CODE';
  }

  if (input.toolName === profile.commandTool) {
    if (
      input.currentPhase === 'PARSE_METRICS'
      || input.currentPhase === 'REFLECT'
      || input.currentPhase === 'DECIDE_NEXT'
      || input.currentPhase === 'DONE'
      || input.currentPhase === 'FAILED'
    ) {
      return input.currentPhase;
    }

    if (input.isExperimentRun) {
      return 'RUN_EXPERIMENT';
    }

    if (input.currentPhase === 'RUN_EXPERIMENT') {
      return 'PARSE_METRICS';
    }

    return 'EDIT_CODE';
  }

  return input.currentPhase;
}

export function buildAutoResearchToolLaneError(
  toolName: string,
  phase: AutoResearchRunPhase,
  allowedTools: string[],
): string {
  return `Tool "${toolName}" is not allowed during ${phase}. Allowed tools: ${allowedTools.join(', ')}`;
}