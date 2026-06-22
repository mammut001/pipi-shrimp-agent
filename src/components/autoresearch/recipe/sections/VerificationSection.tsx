import React from 'react';
import { t } from '@/i18n';

interface VerificationSectionProps {
  commands: string[];
  newCommand: string;
  setNewCommand: (val: string) => void;
  onAddCommand: () => void;
  onRemoveCommand: (cmd: string) => void;
}

export function VerificationSection({
  commands,
  newCommand,
  setNewCommand,
  onAddCommand,
  onRemoveCommand,
}: VerificationSectionProps) {
  return (
    <div className="space-y-4 font-sans">
      <div className="flex gap-2">
        <input
          type="text"
          value={newCommand}
          onChange={(e) => setNewCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAddCommand();
            }
          }}
          placeholder={t('autoresearch.recipe.addCommandPlaceholder') || 'e.g. pytest tests/test_model.py'}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <button
          type="button"
          onClick={onAddCommand}
          className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-xs font-bold transition-all shadow-sm"
        >
          {t('autoresearch.recipe.addButton') || 'Add'}
        </button>
      </div>

      {commands.length > 0 ? (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {commands.map((cmd) => (
            <div key={cmd} className="flex justify-between items-center bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs font-mono">
              <span className="truncate flex-1 pr-2 text-gray-700">{cmd}</span>
              <button
                type="button"
                onClick={() => onRemoveCommand(cmd)}
                className="text-gray-400 hover:text-red-500 font-bold px-1"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic text-center py-4 bg-gray-50 rounded-xl">
          {t('autoresearch.recipe.noCommands') || 'No verification commands specified. The agent will discover test files automatically.'}
        </p>
      )}
    </div>
  );
}
