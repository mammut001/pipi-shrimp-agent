import type { Dispatch, SetStateAction } from 'react';
import type { ApiConfig, AutoResearchLlmSettings, ModelEntry, ModelPricing } from '@/types/settings';
import { DEFAULT_MODEL_PRICING } from '@/types/settings';
import { AutoResearchLlmSettingsSection } from '@/components/settings/AutoResearchLlmSettings';
import {
  canFetchModels,
  getProvider,
  getProviderNames,
  isApiKeyRequired,
  supportsCustomModel,
} from '@/shared/providers';
import { formatCost } from '@/utils/pricing';
import { formatApiKeyLengthHint, sanitizeApiKeyValue } from '@/services/agentConfig';
import { t } from '@/i18n';

type SettingsFormData = {
  name: string;
  provider: ApiConfig['provider'];
  apiKey: string;
  baseUrl: string;
  model: string;
  apiFormat: '' | 'anthropic' | 'openai';
  pricing: Partial<Omit<ModelPricing, 'model' | 'provider'>>;
};

type CurrentPricingDisplay = {
  inputPrice: number;
  outputPrice: number;
  isCustom: boolean;
};

type ApiConfigurationActions = {
  handleAddNew: () => void;
  handleSelectConfig: (config: ApiConfig) => void;
  handleActivate: (id: string) => void;
  handleDeleteConfig: (id: string) => void;
  handleChange: (field: string, value: string | ApiConfig['provider']) => void;
  handleRefreshModels: () => void;
  handlePricingChange: (field: string, value: string) => void;
  useDefaultPricing: () => void;
  clearCustomPricing: () => void;
  getCurrentPricingDisplay: () => CurrentPricingDisplay;
  handleTestConnection: () => void;
  handleSaveConfig: () => void;
};

interface ApiConfigurationSettingsProps {
  apiConfigs: ApiConfig[];
  showApiKey: boolean;
  toggleShowApiKey: () => void;
  editingConfigId: string | null;
  resolvedActiveConfigId: string | null;
  activeConfigId: string | null;
  formData: SettingsFormData;
  errors: Record<string, string>;
  isSaving: boolean;
  isTesting: boolean;
  testResult: { success: boolean; message: string } | null;
  isFetchingModels: boolean;
  autoResearchLlmSettings: AutoResearchLlmSettings;
  updateAutoResearchLlmSettings: (settings: Partial<AutoResearchLlmSettings>) => void;
  currentProviderModelEntries: ModelEntry[];
  showPricingSection: boolean;
  setShowPricingSection: Dispatch<SetStateAction<boolean>>;
  actions: ApiConfigurationActions;
}

export function ApiConfigurationSettings({
  apiConfigs,
  showApiKey,
  toggleShowApiKey,
  editingConfigId,
  resolvedActiveConfigId,
  activeConfigId,
  formData,
  errors,
  isSaving,
  isTesting,
  testResult,
  isFetchingModels,
  autoResearchLlmSettings,
  updateAutoResearchLlmSettings,
  currentProviderModelEntries,
  showPricingSection,
  setShowPricingSection,
  actions: {
    handleAddNew,
    handleSelectConfig,
    handleActivate,
    handleDeleteConfig,
    handleChange,
    handleRefreshModels,
    handlePricingChange,
    useDefaultPricing,
    clearCustomPricing,
    getCurrentPricingDisplay,
    handleTestConnection,
    handleSaveConfig,
  },
}: ApiConfigurationSettingsProps) {
  return (
    <>
          {/* ====== API Configurations Section ====== */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">{t('settings.apiConfigurations')}</h2>
              <button
                type="button"
                onClick={handleAddNew}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                {t('settings.addNew')}
              </button>
            </div>

            {/* Config List */}
            {apiConfigs.length > 0 && (
              <div className="space-y-2 mb-4">
                {apiConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      editingConfigId === config.id
                        ? 'border-gray-900 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => handleSelectConfig(config)}
                  >
                    {/* Active indicator / activate button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleActivate(config.id);
                      }}
                      className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        resolvedActiveConfigId === config.id
                          ? 'border-green-500 bg-green-500'
                          : 'border-gray-300 hover:border-green-400'
                      }`}
                      title={resolvedActiveConfigId === config.id ? t('settings.active') : t('settings.clickToActivate')}
                    >
                      {resolvedActiveConfigId === config.id && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>

                    {/* Config info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{config.name}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {config.provider}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">{config.model}</div>
                    </div>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConfig(config.id);
                      }}
                      className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                      title={t('common.delete')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ====== Edit / Add Form ====== */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                {editingConfigId ? t('settings.editConfiguration') : t('settings.newConfiguration')}
              </h3>

              {/* Name */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.name')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={t('settings.configNamePlaceholder')}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                    errors.name ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
              </div>

              {/* Provider */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.provider')}</label>
                <select
                  value={formData.provider}
                  onChange={(e) => handleChange('provider', e.target.value as ApiConfig['provider'])}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  {getProviderNames().map((p) => (
                    <option key={p} value={p}>
                      {getProvider(p)?.label ?? p}
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key — hidden for providers that don't require it */}
              {isApiKeyRequired(formData.provider) && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('settings.apiKey')} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={formData.apiKey}
                    onChange={(e) => {
                      handleChange('apiKey', sanitizeApiKeyValue(e.target.value));
                    }}
                    placeholder={t('settings.apiKeyPlaceholder')}
                    className={`w-full px-3 py-2 pr-10 text-sm border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                      errors.apiKey ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={toggleShowApiKey}
                    className="absolute right-3 top-2 text-gray-500 hover:text-gray-700 focus:outline-none"
                    title={showApiKey ? t('settings.hideApiKey') : t('settings.showApiKey')}
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500" data-testid="api-key-length-hint">
                  {formatApiKeyLengthHint(formData.apiKey)}
                  {sanitizeApiKeyValue(formData.apiKey).length > 0
                    && sanitizeApiKeyValue(formData.apiKey).length < 8
                    ? ' — key may be truncated; paste the full secret'
                    : ''}
                </p>
                {errors.apiKey && <p className="mt-1 text-xs text-red-500">{errors.apiKey}</p>}
              </div>
              )}

              {/* Base URL (shown when provider has showBaseUrl) */}
              {(getProvider(formData.provider)?.showBaseUrl) && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {t('settings.baseUrl')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    value={formData.baseUrl}
                    onChange={(e) => handleChange('baseUrl', e.target.value)}
                    placeholder={getProvider(formData.provider)?.baseUrlPlaceholder || 'https://api.example.com/v1'}
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                      errors.baseUrl ? 'border-red-300' : 'border-gray-300'
                    }`}
                  />
                  {errors.baseUrl && <p className="mt-1 text-xs text-red-500">{errors.baseUrl}</p>}
                  {getProvider(formData.provider)?.baseUrlHelp && (
                    <p className="mt-1 text-xs text-gray-400">
                      {getProvider(formData.provider)!.baseUrlHelp}
                    </p>
                  )}
                </div>
              )}

              {/* Model */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="model" className="block text-xs font-medium text-gray-600">{t('settings.model')}</label>
                  {canFetchModels(formData.provider) && (
                  <button
                    type="button"
                    onClick={handleRefreshModels}
                    disabled={isFetchingModels}
                    data-testid="fetch-models-button"
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`h-3 w-3 ${isFetchingModels ? 'animate-spin' : ''}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                    </svg>
                    {isFetchingModels ? t('settings.fetchingModels') : t('settings.fetchModels')}
                  </button>
                  )}
                </div>
                {supportsCustomModel(formData.provider) ? (
                  <>
                    <input
                      id="model"
                      type="text"
                      list={`model-suggestions-${formData.provider}`}
                      value={formData.model}
                      onChange={(e) => handleChange('model', e.target.value)}
                      placeholder={t('settings.customModelPlaceholder')}
                      data-testid="model-input"
                      className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                        errors.model ? 'border-red-300' : 'border-gray-300'
                      }`}
                    />
                    <datalist id={`model-suggestions-${formData.provider}`} data-testid="model-datalist">
                      {currentProviderModelEntries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.id}{entry.source === 'remote' ? ' ✦' : ''}
                        </option>
                      ))}
                    </datalist>
                    <p className="mt-1 text-xs text-gray-400">
                      {t('settings.customModelHelp')}
                    </p>
                  </>
                ) : (
                  <select
                    id="model"
                    value={formData.model}
                    onChange={(e) => handleChange('model', e.target.value)}
                    data-testid="model-select"
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                      errors.model ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    {currentProviderModelEntries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.id}{entry.source === 'remote' ? ' ✦' : ''}
                      </option>
                    ))}
                  </select>
                )}
                {errors.model && <p className="mt-1 text-xs text-red-500">{errors.model}</p>}
              </div>

              <div className="mb-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3 border border-green-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-green-800">{t('settings.modelPricing')}</span>
                    {DEFAULT_MODEL_PRICING[formData.model] && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                        {t('settings.defaultAvailable')}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPricingSection(!showPricingSection)}
                    className="text-xs text-green-600 hover:text-green-700 font-medium"
                  >
                    {showPricingSection ? t('common.hide') : t('settings.configure')}
                  </button>
                </div>

                {/* Current pricing summary */}
                {!showPricingSection && (
                  <div className="text-xs text-green-600 flex items-center gap-3">
                    <span>
                      {t('chat.input')}: <strong>{formatCost(getCurrentPricingDisplay().inputPrice / 1000)}/1K</strong>
                    </span>
                    <span>
                      {t('chat.output')}: <strong>{formatCost(getCurrentPricingDisplay().outputPrice / 1000)}/1K</strong>
                    </span>
                  </div>
                )}

                {/* Pricing configuration */}
                {showPricingSection && (
                  <div className="space-y-3">
                    <p className="text-xs text-green-600">
                      {t('settings.pricingDescription')}
                    </p>

                    {/* Pricing inputs */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-green-700 mb-1">
                          {t('settings.inputPricePerMillion')}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={formData.pricing.inputPrice ?? DEFAULT_MODEL_PRICING[formData.model]?.inputPrice ?? ''}
                          onChange={(e) => handlePricingChange('inputPrice', e.target.value)}
                          placeholder={String(DEFAULT_MODEL_PRICING[formData.model]?.inputPrice ?? '0')}
                          className="w-full px-2 py-1.5 text-xs border border-green-300 rounded focus:ring-1 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-green-700 mb-1">
                          {t('settings.outputPricePerMillion')}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={formData.pricing.outputPrice ?? DEFAULT_MODEL_PRICING[formData.model]?.outputPrice ?? ''}
                          onChange={(e) => handlePricingChange('outputPrice', e.target.value)}
                          placeholder={String(DEFAULT_MODEL_PRICING[formData.model]?.outputPrice ?? '0')}
                          className="w-full px-2 py-1.5 text-xs border border-green-300 rounded focus:ring-1 focus:ring-green-500 focus:border-green-500"
                        />
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={useDefaultPricing}
                        disabled={!DEFAULT_MODEL_PRICING[formData.model]}
                        className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('settings.useDefault')}
                      </button>
                      <button
                        type="button"
                        onClick={clearCustomPricing}
                        className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                      >
                        {t('settings.clearCustom')}
                      </button>
                    </div>

                    {formData.pricing.inputPrice !== undefined && formData.pricing.outputPrice !== undefined && (
                      <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
                        <strong>{t('settings.estimatedCostPerThousand')}:</strong><br />
                        {t('chat.input')}: {formatCost(formData.pricing.inputPrice / 1000)} | {t('chat.output')}: {formatCost(formData.pricing.outputPrice / 1000)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isTesting ? (
                    <>
                      <svg className="animate-spin h-3 w-3 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {t('settings.testingConnection')}
                    </>
                  ) : (
                    <>
                      <svg className="h-3 w-3 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {t('settings.test')}
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={isSaving}
                  className="inline-flex items-center px-4 py-1.5 text-xs font-medium rounded-lg bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? t('settings.saving') : (editingConfigId ? t('settings.save') : t('settings.add'))}
                </button>

                {testResult && (
                  <span className={`text-xs whitespace-pre-wrap break-words ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <AutoResearchLlmSettingsSection
            apiConfigs={apiConfigs}
            activeConfigId={activeConfigId}
            settings={autoResearchLlmSettings}
            onUpdate={updateAutoResearchLlmSettings}
          />


    </>
  );
}
