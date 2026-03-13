/**
 * AgentTemplateDrawer - Drawer for selecting agent templates
 *
 * Shows a list of predefined agent templates (Technical Writer, Developer, etc.)
 * when user wants to quickly add a pre-configured agent.
 */

import { AGENT_TEMPLATES } from '@/types/workflow';
import type { AgentTemplate } from '@/types/workflow';

interface AgentTemplateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: AgentTemplate) => void;
}

export function AgentTemplateDrawer({ isOpen, onClose, onSelect }: AgentTemplateDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium text-gray-900">选择 Agent 模板</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Template list */}
        <div className="overflow-y-auto p-4 space-y-3 max-h-[60vh]">
          {AGENT_TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => {
                onSelect(template);
                onClose();
              }}
              className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: template.color }}
                />
                <span className="font-medium text-gray-900">{template.name}</span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{template.task}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AgentTemplateDrawer;
