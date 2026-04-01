/**
 * Prompt Store
 *
 * Manages prompt templates with localStorage persistence.
 * Supports: template selection, section editing, reset to default.
 */

import { create } from 'zustand';
import type { PromptTemplate, PromptSection } from '../types/prompt';
import { createDefaultTemplate } from '../services/prompt/defaultTemplate';

const PROMPT_TEMPLATES_KEY = 'pipi-shrimp-prompt-templates';
const ACTIVE_TEMPLATE_KEY = 'pipi-shrimp-active-template';

interface PromptState {
  templates: PromptTemplate[];
  activeTemplateId: string;

  getActiveTemplate: () => PromptTemplate | null;
  setActiveTemplate: (id: string) => void;
  updateTemplate: (id: string, updates: Partial<PromptTemplate>) => void;
  updateSection: (templateId: string, sectionId: string, updates: Partial<PromptSection>) => void;
  resetToDefault: () => void;
}

export const usePromptStore = create<PromptState>((set, get) => {
  const templates = loadTemplates();
  const activeId = localStorage.getItem(ACTIVE_TEMPLATE_KEY) || 'default';

  return {
    templates,
    activeTemplateId: templates.some(t => t.id === activeId) ? activeId : 'default',

    getActiveTemplate: () => {
      const { templates: ts, activeTemplateId } = get();
      return ts.find(t => t.id === activeTemplateId) || null;
    },

    setActiveTemplate: (id) => {
      set({ activeTemplateId: id });
      localStorage.setItem(ACTIVE_TEMPLATE_KEY, id);
    },

    updateTemplate: (id, updates) => {
      const { templates: ts } = get();
      const updated = ts.map(t =>
        t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
      );
      set({ templates: updated });
      saveTemplates(updated);
    },

    updateSection: (templateId, sectionId, updates) => {
      const { templates: ts } = get();
      const updated = ts.map(t => {
        if (t.id !== templateId) return t;
        return {
          ...t,
          updatedAt: Date.now(),
          sections: t.sections.map(s =>
            s.id === sectionId ? { ...s, ...updates } : s
          ),
        };
      });
      set({ templates: updated });
      saveTemplates(updated);
    },

    resetToDefault: () => {
      const defaultTemplate = createDefaultTemplate();
      set({
        templates: [defaultTemplate],
        activeTemplateId: 'default',
      });
      saveTemplates([defaultTemplate]);
      localStorage.setItem(ACTIVE_TEMPLATE_KEY, 'default');
    },
  };
});

function loadTemplates(): PromptTemplate[] {
  try {
    const stored = localStorage.getItem(PROMPT_TEMPLATES_KEY);
    if (stored) {
      const templates = JSON.parse(stored) as PromptTemplate[];
      if (templates.length > 0) return templates;
    }
  } catch {
    // ignore parse errors
  }
  const defaultTemplate = createDefaultTemplate();
  saveTemplates([defaultTemplate]);
  return [defaultTemplate];
}

function saveTemplates(templates: PromptTemplate[]) {
  try {
    localStorage.setItem(PROMPT_TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    console.warn('[PromptStore] Failed to persist templates');
  }
}
