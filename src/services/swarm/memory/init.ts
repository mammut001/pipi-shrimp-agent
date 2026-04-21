/**
 * Swarm Memory Initialization
 *
 * Creates the directory structure and MEMORY.md templates for
 * Team Memory and Agent Memory when teams/agents are created.
 */

import { invoke } from '@tauri-apps/api/core';
import { getMemoryDir } from '../../memory/memoryPaths';
import type { AgentMemory, TeamMemory } from '../types';
import { buildTeamMemoryTemplate } from './teamMemory';
import { buildAgentMemoryTemplate } from './agentMemory';

/**
 * Initialize Team Memory directory structure.
 * Called when a team is created via `createTeam()`.
 */
export async function initTeamMemory(teamId: string, baseDir: string): Promise<TeamMemory> {
  const memoryDir = `${baseDir}/swarm/${teamId}/team-memory`;
  const topicDir = `${memoryDir}/topic-memories`;

  try {
    await invoke('create_directory', { path: topicDir });
  } catch {
    // directory may already exist
  }

  const template = buildTeamMemoryTemplate(memoryDir);
  try {
    await invoke('write_file', { path: `${memoryDir}/MEMORY.md`, content: template });
  } catch (e) {
    console.error('[SwarmMemory] Failed to write team MEMORY.md:', e);
  }

  return { teamId, memoryDir, enabled: true };
}

/**
 * Initialize Agent Memory directory structure.
 * Called when an agent is spawned via `spawnAgent()`.
 */
export async function initAgentMemory(
  teamId: string,
  agentId: string,
  baseDir: string,
): Promise<AgentMemory> {
  const memoryDir = `${baseDir}/swarm/${teamId}/${agentId}/memory`;
  const topicDir = `${memoryDir}/topic-memories`;

  try {
    await invoke('create_directory', { path: topicDir });
  } catch {
    // directory may already exist
  }

  const template = buildAgentMemoryTemplate(memoryDir);
  try {
    await invoke('write_file', { path: `${memoryDir}/MEMORY.md`, content: template });
  } catch (e) {
    console.error('[SwarmMemory] Failed to write agent MEMORY.md:', e);
  }

  return { teamId, agentId, memoryDir, enabled: true };
}

/**
 * Get the base swarm directory for the current project.
 * Reuses the project memory base so swarm state stays local to the
 * current workDir when available.
 */
export async function getSwarmBaseDir(projectRoot?: string): Promise<string> {
  return getMemoryDir(projectRoot);
}
