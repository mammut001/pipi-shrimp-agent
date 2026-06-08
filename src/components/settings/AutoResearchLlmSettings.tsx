import { getCapability } from '@/services/llm/capabilities';
import { getProvider } from '@/shared/providers';
import {
  buildAutoResearchRunLockMessage,
  useAutoResearchLifecycleLock,
} from '@/services/autoresearch/runLock';
import type { AutoResearchLlmSettings, ApiConfig } from '@/types/settings';

type AutoResearchLlmSettingsProps = {
  apiConfigs: ApiConfig[];
  activeConfigId: string | null;
  settings: AutoResearchLlmSettings;
  onUpdate: (settings: Partial<AutoResearchLlmSettings>) => void;
};

function formatProviderLabel(config: ApiConfig): string {
  return getProvider(config.provider)?.label ?? config.provider;
}

function CapabilityDot({ enabled, tone = 'neutral' }: { enabled: boolean; tone?: 'neutral' | 'warn' | 'danger' }) {
  const palette = enabled
    ? 'bg-emerald-500'
    : tone === 'danger'
      ? 'bg-red-500'
      : tone === 'warn'
        ? 'bg-amber-400'
        : 'bg-gray-300';
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${palette}`} aria-hidden="true" />;
}

function CapabilityBadges({ config, size = 'sm' }: { config: ApiConfig; size?: 'sm' | 'xs' }) {
  const capability = getCapability(config.provider);
  const padding = size === 'xs' ? 'px-1.5 py-[1px]' : 'px-2 py-0.5';
  const text = size === 'xs' ? 'text-[10px]' : 'text-[11px]';
  const rowGap = size === 'xs' ? 'gap-1' : 'gap-1.5';

  const items: { label: string; enabled: boolean; tone?: 'neutral' | 'warn' | 'danger' }[] = [
    { label: 'streaming', enabled: capability.streaming },
    {
      label: `tool:${capability.toolCalls}`,
      enabled: capability.toolCalls !== 'none',
      tone: capability.toolCalls === 'none' ? 'danger' : 'neutral',
    },
    { label: 'json_mode', enabled: capability.jsonMode, tone: 'warn' },
    { label: 'vision', enabled: capability.vision },
  ];

  return (
    <div className={`flex flex-wrap items-center ${rowGap}`}>
      {items.map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white ${padding} ${text} font-medium ${
            item.enabled ? 'text-gray-700' : 'text-gray-400'
          }`}
          title={`${item.label}: ${item.enabled ? 'supported' : 'unsupported'}`}
        >
          <CapabilityDot enabled={item.enabled} tone={item.tone} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ConfigRow({
  config,
  isActive,
  isSelected,
  disabled,
  onSelect,
  showCapabilities = false,
}: {
  config: ApiConfig;
  isActive: boolean;
  isSelected: boolean;
  disabled: boolean;
  onSelect: () => void;
  showCapabilities?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
        isSelected
          ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          isSelected ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white'
        }`}
        aria-hidden="true"
      >
        {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900">{config.name}</span>
          {isActive && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-1.5 py-[1px] text-[10px] font-medium text-gray-600">
              Active
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-gray-500">
          {formatProviderLabel(config)} · {config.model}
        </div>
      </div>
      {showCapabilities && (
        <div className="hidden shrink-0 sm:block">
          <CapabilityBadges config={config} size="xs" />
        </div>
      )}
    </button>
  );
}

export function AutoResearchLlmSettingsSection({
  apiConfigs,
  activeConfigId,
  settings,
  onUpdate,
}: AutoResearchLlmSettingsProps) {
  const lifecycleLock = useAutoResearchLifecycleLock();
  const activeConfig = apiConfigs.find((config) => config.id === activeConfigId) ?? null;
  const selectedDefaultConfig =
    apiConfigs.find((config) => config.id === settings.defaultConfigId) ?? activeConfig;
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
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Default provider
                </span>
                {settings.defaultConfigId && (
                  <button
                    type="button"
                    disabled={settingsLocked}
                    onClick={() => onUpdate({ defaultConfigId: null })}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use active Settings config
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {apiConfigs.map((config) => (
                  <ConfigRow
                    key={`default-${config.id}`}
                    config={config}
                    isActive={config.id === activeConfigId}
                    isSelected={(settings.defaultConfigId ?? activeConfigId) === config.id}
                    disabled={settingsLocked}
                    onSelect={() => onUpdate({ defaultConfigId: config.id })}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Agent model override
                </span>
                {settings.agentConfigId && (
                  <button
                    type="button"
                    disabled={settingsLocked}
                    onClick={() => onUpdate({ agentConfigId: null })}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use AutoResearch default
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {apiConfigs.map((config) => (
                  <ConfigRow
                    key={`agent-${config.id}`}
                    config={config}
                    isActive={config.id === activeConfigId}
                    isSelected={
                      (settings.agentConfigId ?? settings.defaultConfigId ?? activeConfigId) === config.id
                    }
                    disabled={settingsLocked}
                    onSelect={() => onUpdate({ agentConfigId: config.id })}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Reflection model override
                </span>
                {settings.reflectionConfigId && (
                  <button
                    type="button"
                    disabled={settingsLocked}
                    onClick={() => onUpdate({ reflectionConfigId: null })}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use AutoResearch default
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {apiConfigs.map((config) => (
                  <ConfigRow
                    key={`reflection-${config.id}`}
                    config={config}
                    isActive={config.id === activeConfigId}
                    isSelected={
                      (settings.reflectionConfigId ?? settings.defaultConfigId ?? activeConfigId) === config.id
                    }
                    disabled={settingsLocked}
                    onSelect={() => onUpdate({ reflectionConfigId: config.id })}
                  />
                ))}
              </div>
            </div>
          </div>

          {selectedDefaultConfig && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Selected default snapshot
                  </p>
                  <p className="mt-0.5 truncate text-sm font-medium text-gray-900">
                    {selectedDefaultConfig.name}
                  </p>
                  <p className="truncate text-[11px] text-gray-500">
                    {formatProviderLabel(selectedDefaultConfig)} · {selectedDefaultConfig.model}
                  </p>
                </div>
                <div className="shrink-0">
                  <CapabilityBadges config={selectedDefaultConfig} size="xs" />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
