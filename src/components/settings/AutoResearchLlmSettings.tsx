import { getCapability } from '@/services/llm/capabilities';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { getProvider } from '@/shared/providers';
import {
  buildAutoResearchRunLockMessage,
  getAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import type { AutoResearchLlmSettings, ApiConfig } from '@/types/settings';

type AutoResearchLlmSettingsProps = {
  apiConfigs: ApiConfig[];
  activeConfigId: string | null;
  settings: AutoResearchLlmSettings;
  onUpdate: (settings: Partial<AutoResearchLlmSettings>) => void;
};

function formatConfigLabel(config: ApiConfig): string {
  const providerLabel = getProvider(config.provider)?.label ?? config.provider;
  return `${config.name} · ${providerLabel} · ${config.model}`;
}

function Badge({ label, enabled, tone = 'neutral' }: { label: string; enabled: boolean; tone?: 'neutral' | 'warn' | 'danger' }) {
  const palette = enabled
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-gray-200 bg-gray-50 text-gray-500';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${palette}`}>
      {label}
    </span>
  );
}

function CapabilityBadges({ config }: { config: ApiConfig }) {
  const capability = getCapability(config.provider);

  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge label="streaming" enabled={capability.streaming} />
      <Badge
        label={`tool:${capability.toolCalls}`}
        enabled={capability.toolCalls !== 'none'}
        tone={capability.toolCalls === 'none' ? 'danger' : 'neutral'}
      />
      <Badge label="json_mode" enabled={capability.jsonMode} tone="warn" />
      <Badge label="vision" enabled={capability.vision} />
    </div>
  );
}

export function AutoResearchLlmSettingsSection({
  apiConfigs,
  activeConfigId,
  settings,
  onUpdate,
}: AutoResearchLlmSettingsProps) {
  const lifecycleLock = useAutoResearchStore((state) => getAutoResearchLifecycleLock(state));
  const activeConfig = apiConfigs.find((config) => config.id === activeConfigId) ?? null;
  const selectedDefaultConfig = apiConfigs.find((config) => config.id === settings.defaultConfigId) ?? activeConfig;
  const settingsLocked = lifecycleLock.locked;
  const lockMessage = settingsLocked
    ? buildAutoResearchRunLockMessage('change the AutoResearch provider selection', lifecycleLock)
    : null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">AutoResearch LLM Provider</h2>
        <p className="mt-1 text-xs text-gray-500">
          Pick the default provider snapshot for AutoResearch runs, then override agent and reflection only when needed.
        </p>
      </div>

      {lockMessage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {lockMessage}
        </div>
      )}

      {apiConfigs.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Configure a provider first.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-xs text-gray-600">
              <span className="mb-1 block font-medium text-gray-700">Default provider</span>
              <select
                value={settings.defaultConfigId ?? ''}
                disabled={settingsLocked}
                onChange={(event) => onUpdate({ defaultConfigId: event.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">Use active Settings config</option>
                {apiConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {formatConfigLabel(config)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-gray-600">
              <span className="mb-1 block font-medium text-gray-700">Agent model override</span>
              <select
                value={settings.agentConfigId ?? ''}
                disabled={settingsLocked}
                onChange={(event) => onUpdate({ agentConfigId: event.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">Use AutoResearch default</option>
                {apiConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {formatConfigLabel(config)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-gray-600">
              <span className="mb-1 block font-medium text-gray-700">Reflection model override</span>
              <select
                value={settings.reflectionConfigId ?? ''}
                disabled={settingsLocked}
                onChange={(event) => onUpdate({ reflectionConfigId: event.target.value || null })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">Use AutoResearch default</option>
                {apiConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {formatConfigLabel(config)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedDefaultConfig && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-medium text-gray-700">Selected default snapshot</p>
              <p className="mt-1 text-sm text-gray-900">{formatConfigLabel(selectedDefaultConfig)}</p>
              <div className="mt-2">
                <CapabilityBadges config={selectedDefaultConfig} />
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 font-semibold text-gray-600">Config</th>
                  <th className="px-3 py-2 font-semibold text-gray-600">Provider</th>
                  <th className="px-3 py-2 font-semibold text-gray-600">Capabilities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {apiConfigs.map((config) => (
                  <tr key={config.id}>
                    <td className="px-3 py-2 align-top text-gray-900">
                      <div className="font-medium">{config.name}</div>
                      <div className="text-gray-500">{config.model}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-gray-700">
                      <div>{getProvider(config.provider)?.label ?? config.provider}</div>
                      {config.id === activeConfigId && (
                        <div className="mt-1 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          Active
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <CapabilityBadges config={config} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}