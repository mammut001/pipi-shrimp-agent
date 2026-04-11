/**
 * Swarm Memory — Public API
 *
 * Barrel export for the swarm memory subsystem:
 * - init: directory creation for team/agent memory
 * - recall: reading indexes and building prompt sections
 * - extraction: LLM-driven memory persistence after task completion
 * - teamMemory: team memory templates and helpers
 * - agentMemory: agent memory templates
 */

// Initialization
export { initTeamMemory, initAgentMemory, getSwarmBaseDir } from './init';

// Recall (reading + prompt building)
export {
  readTeamMemoryIndex,
  readAgentMemoryIndex,
  buildAgentMemoryPrompt,
  buildTeamMemoryPrompt,
} from './recall';

// Extraction (write after task completion)
export { extractAgentMemory, extractTeamMemory } from './extraction';

// Templates & helpers
export { buildTeamMemoryTemplate, buildTeamMemoryFilename, buildTeamMemoryFrontmatter } from './teamMemory';
export { buildAgentMemoryTemplate } from './agentMemory';
