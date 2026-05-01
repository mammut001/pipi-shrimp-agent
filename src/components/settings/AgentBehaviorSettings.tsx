import type { AgentSettings } from '@/types/settings';
import { t } from '@/i18n';

type AgentBehaviorSettingsProps = {
  agentSettings: AgentSettings;
  onUpdate: (settings: Partial<AgentSettings>) => void;
};

export function AgentBehaviorSettings({ agentSettings, onUpdate }: AgentBehaviorSettingsProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('settings.agentBehavior')}</h2>

      <div className="mb-1">
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600">
            {t('settings.maxToolLoopRounds')}
          </label>
          <span className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
            {agentSettings.maxToolRounds}
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          step="1"
          value={agentSettings.maxToolRounds}
          onChange={(event) => onUpdate({ maxToolRounds: parseInt(event.target.value, 10) })}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>1</span>
          <span>50</span>
          <span>100</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {t('settings.maxToolLoopRoundsDescription')}
        </p>
      </div>
    </div>
  );
}
