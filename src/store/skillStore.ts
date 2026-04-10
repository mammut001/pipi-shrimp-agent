/**
 * SkillStore - Manages available skills/tools for display in the UI
 *
 * Dynamically reads from the ToolRegistry to provide a consistent
 * list of skills across the application.
 */

import { create } from 'zustand';
import { toolRegistry } from '@/tools/core/ToolRegistry';
import type { Tool } from '@/tools/base/Tool';

export interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: 'file' | 'shell' | 'web' | 'task' | 'communication' | 'development' | 'other';
  isEnabled: boolean;
}

interface SkillState {
  skills: SkillInfo[];
  isLoaded: boolean;
  loadSkills: () => void;
  getVisibleSkills: () => SkillInfo[];
  getSkillsByCategory: (category: SkillInfo['category']) => SkillInfo[];
  getCoreSkills: () => SkillInfo[];
  getRemainingCount: () => number;
}

const CORE_SKILL_IDS = new Set([
  'FileRead', 'FileWrite', 'FileEdit', 'Bash', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'Task', 'Todo',
]);

function categorizeTool(toolName: string): SkillInfo['category'] {
  const name = toolName.toLowerCase();
  if (name.includes('file') || name.includes('read') || name.includes('write') || name.includes('edit')) {
    return 'file';
  }
  if (name.includes('bash') || name.includes('shell') || name.includes('exec') || name.includes('repl')) {
    return 'shell';
  }
  if (name.includes('web') || name.includes('search') || name.includes('fetch') || name.includes('http')) {
    return 'web';
  }
  if (name.includes('task') || name.includes('todo')) {
    return 'task';
  }
  if (name.includes('ask') || name.includes('brief') || name.includes('question')) {
    return 'communication';
  }
  if (name.includes('lsp') || name.includes('config') || name.includes('skill')) {
    return 'development';
  }
  return 'other';
}

function toolToSkillInfo(tool: Tool): SkillInfo {
  return {
    id: tool.name,
    name: tool.name.toLowerCase().replace(/([A-Z])/g, '_$1').toLowerCase(),
    displayName: tool.aliases?.[0] ?? tool.name,
    description: tool.searchHint ?? '',
    category: categorizeTool(tool.name),
    isEnabled: true,
  };
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  isLoaded: false,

  loadSkills: () => {
    if (get().isLoaded) return;

    try {
      const tools = toolRegistry.getAll();
      const skills = tools.map(toolToSkillInfo);
      set({ skills, isLoaded: true });
    } catch (error) {
      console.error('Failed to load skills from registry:', error);
      set({ skills: [], isLoaded: true });
    }
  },

  getVisibleSkills: () => {
    return get().skills.filter(s => s.isEnabled);
  },

  getSkillsByCategory: (category) => {
    return get().skills.filter(s => s.category === category && s.isEnabled);
  },

  getCoreSkills: () => {
    return get().skills.filter(s => CORE_SKILL_IDS.has(s.id) && s.isEnabled);
  },

  getRemainingCount: () => {
    const all = get().getVisibleSkills();
    const core = get().getCoreSkills();
    return Math.max(0, all.length - core.length);
  },
}));
