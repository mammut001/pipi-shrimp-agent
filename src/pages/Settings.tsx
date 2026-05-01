/**
 * Settings - Application settings page
 *
 * Features:
 * - Multiple API configurations (add, edit, delete, activate)
 * - Working directory selection
 * - Telegram token
 * - Theme/language settings
 * - Save button with validation
 * - Loading states
 */

import { useState, useEffect } from 'react';
import { useSettingsStore, useUIStore } from '@/store';
import { usePromptStore } from '@/store/promptStore';
import { invoke } from '@tauri-apps/api/core';
import type { ApiConfig, ModelPricing } from '@/types/settings';
import { DEFAULT_MODEL_PRICING } from '@/types/settings';
import {
  getProviderNames,
  getProvider,
  getProviderDefaultModelIds,
  getProviderDefaultBaseUrl,
  getProviderDefaultApiFormat,
  isApiKeyRequired,
  canFetchModels,
  validateProviderFields,
  validateFetchModelsPrereqs,
} from '@/shared/providers';
import type { ProviderName } from '@/shared/providers';
import { formatCost } from '@/utils/pricing';
import { TokenStats } from '@/components/TokenStats';
import { TelegramSettings } from '@/components/settings/TelegramSettings';
import { MCPSettingsSection } from '@/components/settings/MCPSettingsSection';
import { t, getSupportedLocales, getCurrentLocale, setLocale, convertToOldLanguageCode } from '@/i18n';
import { getSectionTokenInfo, exportPrompt } from '@/services/prompt/promptBuilder';

/**
 * Settings page component
 */
export function Settings() {
  const {
    apiConfigs,
    activeConfigId,
    theme,
    availableModelEntries,
    agentSettings,
    addApiConfig,
    updateApiConfig,
    removeApiConfig,
    fetchAvailableModels,
    setActiveConfig,
    setTheme,
    setLanguage,
    updateAgentSettings,
  } = useSettingsStore();

  const {
    getActiveTemplate,
    updateSection,
    resetToDefault,
  } = usePromptStore();

  const activeTemplate = getActiveTemplate();
  const sectionTokenInfo = activeTemplate ? getSectionTokenInfo(activeTemplate.sections) : [];
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);

  const { addNotification, toggleSettings, showApiKey, toggleShowApiKey } = useUIStore();

  // Currently editing config ID (null = adding new)
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);

  // Form state for API config editing
  const [formData, setFormData] = useState<{
    name: string;
    provider: ApiConfig['provider'];
    apiKey: string;
    baseUrl: string;
    model: string;
    apiFormat: '' | 'anthropic' | 'openai';
    pricing: Partial<Omit<ModelPricing, 'model' | 'provider'>>;
  }>({
    name: '',
    provider: 'anthropic',
    apiKey: '',
    baseUrl: '',
    model: 'claude-3-5-sonnet-20241022',
    apiFormat: '',
    pricing: {},
  });

  // Pricing section collapsed state
  const [showPricingSection, setShowPricingSection] = useState(false);

  // Other settings form
  const [otherSettings, setOtherSettings] = useState({
    theme: 'light' as 'light' | 'dark',
    language: getCurrentLocale(),
  });

  // Build source-annotated model list: remote entries first, then default fallbacks
  const providerName = formData.provider as ProviderName;
  const remoteEntries = availableModelEntries[providerName] ?? [];
  const remoteIds = new Set(remoteEntries.map((e) => e.id));
  const defaultIds = getProviderDefaultModelIds(providerName).filter((id) => !remoteIds.has(id));
  const currentProviderModelEntries = [
    ...remoteEntries,
    ...defaultIds.map((id) => ({ id, source: 'default' as const })),
  ];

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load settings on mount
  useEffect(() => {
    setOtherSettings({
      theme,
      language: getCurrentLocale(),
    });

    // If there are configs, select the active one for editing
    if (apiConfigs.length > 0 && activeConfigId) {
      const active = apiConfigs.find((c) => c.id === activeConfigId);
      if (active) {
        setEditingConfigId(active.id);
        setFormData({
          name: active.name,
          provider: active.provider,
          apiKey: active.apiKey,
          baseUrl: active.baseUrl || '',
          model: active.model,
          apiFormat: (active.apiFormat || '') as '' | 'anthropic' | 'openai',
          pricing: active.pricing || {},
        });
        setShowPricingSection(!!active.pricing);
      }
    }

    setIsLoading(false);
  }, []);

  /**
   * Load a config into the form for editing
   */
  const handleSelectConfig = (config: ApiConfig) => {
    setEditingConfigId(config.id);
    setFormData({
      name: config.name,
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || '',
      model: config.model,
      apiFormat: (config.apiFormat || '') as '' | 'anthropic' | 'openai',
      pricing: config.pricing || {},
    });
    setShowPricingSection(!!config.pricing);
    setTestResult(null);
    setErrors({});
  };

  /**
   * Start adding a new config
   */
  const handleAddNew = () => {
    setEditingConfigId(null);
    setFormData({
      name: '',
      provider: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: 'claude-3-5-sonnet-20241022',
      apiFormat: '',
      pricing: {},
    });
    setShowPricingSection(false);
    setTestResult(null);
    setErrors({});
  };

  /**
   * Handle model fetching
   */
  const handleRefreshModels = async () => {
    const prereqErrors = validateFetchModelsPrereqs(formData.provider, formData.apiKey, formData.baseUrl);
    if (Object.keys(prereqErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...prereqErrors }));
      return;
    }

    setIsFetchingModels(true);
    try {
      // Pass the current form data directly to fetch available models
      // This works for both new and existing configs
      const models = await fetchAvailableModels({
        provider: formData.provider,
        apiKey: formData.apiKey,
        baseUrl: formData.baseUrl || undefined,
      });

      addNotification('success', `${t('settings.foundModels')}: ${models.length}`);

      if (models.length > 0 && !models.includes(formData.model)) {
        setFormData(prev => ({ ...prev, model: models[0] }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addNotification('error', `${t('settings.failedToFetchModels')}: ${errorMessage}`);
      console.error(error);
    } finally {
      setIsFetchingModels(false);
    }
  };

  /**
   * Handle form field changes
   */
  const handleChange = (
    field: string,
    value: string | ApiConfig['provider']
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }

    // Reset model and clear API key when provider changes
    if (field === 'provider') {
      const newProvider = value as ProviderName;
      const providerDef = getProvider(newProvider);
      const dynamicModels = (availableModelEntries[newProvider] ?? []).map((e) => e.id);
      const staticModels = getProviderDefaultModelIds(newProvider);
      const allModels = [...new Set([...staticModels, ...dynamicModels])];

      const updates: Partial<typeof formData> = {
        apiKey: '',
        name: formData.name || (providerDef?.label ?? newProvider),
      };

      if (allModels.length > 0) {
        updates.model = allModels[0];
      } else {
        updates.model = formData.model;
      }

      // Auto-fill Base URL from registry
      updates.baseUrl = getProviderDefaultBaseUrl(newProvider);

      // Auto-set apiFormat from registry
      (updates as any).apiFormat = getProviderDefaultApiFormat(newProvider);

      setFormData((prev) => ({ ...prev, ...updates }));
    }
  };

  /**
   * Handle pricing field changes
   */
  const handlePricingChange = (field: string, value: string) => {
    const numValue = parseFloat(value);
    setFormData((prev) => ({
      ...prev,
      pricing: {
        ...prev.pricing,
        [field]: isNaN(numValue) ? 0 : numValue,
      },
    }));
  };

  /**
   * Use default pricing for the current model
   */
  const useDefaultPricing = () => {
    const defaultPricing = DEFAULT_MODEL_PRICING[formData.model];
    if (defaultPricing) {
      setFormData((prev) => ({
        ...prev,
        pricing: {
          inputPrice: defaultPricing.inputPrice,
          outputPrice: defaultPricing.outputPrice,
          contextWindow: defaultPricing.contextWindow,
        },
      }));
      addNotification('info', `${t('settings.loadedDefaultPricing')}: ${formData.model}`);
    } else {
      addNotification('warning', `${t('settings.noDefaultPricing')}: ${formData.model}`);
    }
  };

  /**
   * Clear custom pricing (use defaults)
   */
  const clearCustomPricing = () => {
    setFormData((prev) => ({
      ...prev,
      pricing: {},
    }));
    addNotification('info', t('settings.usingDefaultPricing'));
  };

  /**
   * Get current pricing display info
   */
  const getCurrentPricingDisplay = (): { inputPrice: number; outputPrice: number; isCustom: boolean } => {
    const defaultPricing = DEFAULT_MODEL_PRICING[formData.model];
    const hasCustomPricing = Object.keys(formData.pricing).length > 0;

    if (hasCustomPricing) {
      return {
        inputPrice: formData.pricing.inputPrice ?? defaultPricing?.inputPrice ?? 0,
        outputPrice: formData.pricing.outputPrice ?? defaultPricing?.outputPrice ?? 0,
        isCustom: true,
      };
    }

    return {
      inputPrice: defaultPricing?.inputPrice ?? 0,
      outputPrice: defaultPricing?.outputPrice ?? 0,
      isCustom: false,
    };
  };

  /**
   * Validate API config form
   */
  const validateApiForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = t('settings.nameRequired');
    }

    // Capability-driven provider field validation
    const providerErrors = validateProviderFields(formData.provider, formData.apiKey, formData.baseUrl);
    Object.assign(newErrors, providerErrors);

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * Save API config (add or update)
   */
  const handleSaveConfig = async () => {
    if (!validateApiForm()) return;

    setIsSaving(true);
    try {
      const configData = {
        name: formData.name.trim(),
        provider: formData.provider,
        apiKey: formData.apiKey,
        baseUrl: formData.baseUrl || undefined,
        model: formData.model,
        apiFormat: (formData.apiFormat || undefined) as ApiConfig['apiFormat'],
        pricing: Object.keys(formData.pricing).length > 0 ? formData.pricing : undefined,
      };

      if (editingConfigId) {
        // Update existing
        await updateApiConfig(editingConfigId, configData);
        addNotification('success', `${t('settings.configUpdated')}: ${configData.name}`);
      } else {
        // Add new
        const newConfig = await addApiConfig(configData);
        setEditingConfigId(newConfig.id);
        addNotification('success', `${t('settings.configAdded')}: ${configData.name}`);
      }
    } catch (error) {
      addNotification('error', t('settings.failedToSaveConfig'));
      console.error('Failed to save config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Delete a config
   */
  const handleDeleteConfig = async (id: string) => {
    const config = apiConfigs.find((c) => c.id === id);
    if (!config) return;

    await removeApiConfig(id);
    addNotification('info', `${t('settings.configRemoved')}: ${config.name}`);

    // If we deleted the one being edited, switch to first remaining or add-new
    if (editingConfigId === id) {
      const remaining = apiConfigs.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        handleSelectConfig(remaining[0]);
      } else {
        handleAddNew();
      }
    }
  };

  /**
   * Activate a config
   */
  const handleActivate = (id: string) => {
    setActiveConfig(id);
    addNotification('success', `${t('settings.switchedToConfig')}: ${apiConfigs.find((c) => c.id === id)?.name}`);
  };

  /**
   * Handle test connection
   */
  const handleTestConnection = async () => {
    const providerErrors = validateProviderFields(formData.provider, formData.apiKey, formData.baseUrl);
    if (Object.keys(providerErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...providerErrors }));
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const providerDef = getProvider(formData.provider);
      const result = await invoke<boolean>('test_connection', {
        apiKey: formData.apiKey,
        model: formData.model,
        baseUrl: providerDef?.requiresBaseUrl ? formData.baseUrl : null,
      });

      if (result) {
        setTestResult({ success: true, message: t('settings.connectionSuccessful') });
        addNotification('success', t('settings.connectionTestPassed'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({ success: false, message: errorMessage });
      addNotification('error', t('settings.connectionTestFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  /**
   * Save other settings (theme, language)
   */
  const handleSaveOtherSettings = async () => {
    try {
      if (otherSettings.theme !== theme) {
        setTheme(otherSettings.theme);
      }
      // 检查语言是否变更
      const currentLocale = getCurrentLocale();
      if (otherSettings.language !== currentLocale) {
        // 直接使用 i18n 系统设置语言
        setLocale(otherSettings.language as 'zh-CN' | 'en-US');
        // 同时更新 settingsStore 中的语言（向后兼容）
        setLanguage(convertToOldLanguageCode(otherSettings.language as 'zh-CN' | 'en-US'));
        // 强制重新加载页面以应用新语言
        window.location.reload();
      }
      addNotification('success', t('settings.saved'));
    } catch (error) {
      addNotification('error', t('settings.failedToSave'));
    }
  };

  /**
   * Handle close modal
   */
  const handleClose = () => {
    toggleSettings();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal Content */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors z-10"
          title={t('common.close')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">{t('settings.title')}</h1>
          <p className="text-gray-500 mt-1 text-sm">{t('settings.subtitle')}</p>
        </div>

        <div className="p-6 space-y-6">

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
                        activeConfigId === config.id
                          ? 'border-green-500 bg-green-500'
                          : 'border-gray-300 hover:border-green-400'
                      }`}
                      title={activeConfigId === config.id ? t('settings.active') : t('settings.clickToActivate')}
                    >
                      {activeConfigId === config.id && (
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
                    onChange={(e) => handleChange('apiKey', e.target.value)}
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
                  <label className="block text-xs font-medium text-gray-600">{t('settings.model')}</label>
                  {canFetchModels(formData.provider) && (
                  <button
                    type="button"
                    onClick={handleRefreshModels}
                    disabled={isFetchingModels}
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
                    {isFetchingModels ? 'Fetching...' : 'Fetch models'}
                  </button>
                  )}
                </div>
                <select
                  value={formData.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  {currentProviderModelEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.id}{entry.source === 'remote' ? ' ✦' : ''}
                    </option>
                  ))}
                </select>
              </div>

                    {isFetchingModels ? t('settings.fetchingModels') : t('settings.fetchModels')}
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
                  <span className={`text-xs ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {testResult.message}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ====== Telegram Section ====== */}
          <TelegramSettings />

          {/* ====== MCP Section ====== */}
          <MCPSettingsSection />

          {/* ====== Agent Settings Section ====== */}
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
                max="20"
                step="1"
                value={agentSettings.maxToolRounds}
                onChange={(e) => updateAgentSettings({ maxToolRounds: parseInt(e.target.value, 10) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-900"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1</span>
                <span>10</span>
                <span>20</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {t('settings.maxToolLoopRoundsDescription')}
              </p>
            </div>
          </div>

          {/* ====== Prompt Templates Section ====== */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">{t('settings.promptTemplates')}</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!activeTemplate) return;
                    const json = exportPrompt(activeTemplate.sections);
                    navigator.clipboard.writeText(json);
                    addNotification('success', t('settings.promptExported'));
                  }}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                >
                  {t('settings.exportJson')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetToDefault();
                    addNotification('info', t('settings.resetToDefaultTemplate'));
                  }}
                  className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                >
                  {t('settings.resetTemplate')}
                </button>
              </div>
            </div>

            {/* Section list */}
            {activeTemplate?.sections.map((section) => (
              <div key={section.id} className="mb-2 border border-gray-200 rounded-lg overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
                  onClick={() => setExpandedSectionId(expandedSectionId === section.id ? null : section.id)}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={section.enabled}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateSection(activeTemplate.id, section.id, { enabled: e.target.checked });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-gray-300"
                    />
                    <span className="text-xs font-medium text-gray-700">{section.label}</span>
                    <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
                      {section.category}
                    </span>
                    {section.cacheable && (
                      <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{t('settings.cached')}</span>
                    )}
                    {!section.cacheable && (
                      <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">{t('settings.dynamic')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">#{section.order}</span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${expandedSectionId === section.id ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {expandedSectionId === section.id && (
                  <div className="p-3 border-t border-gray-200">
                    {section.description && (
                      <p className="text-xs text-gray-500 mb-2">{section.description}</p>
                    )}
                    <textarea
                      value={section.content}
                      onChange={(e) => updateSection(activeTemplate.id, section.id, { content: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded font-mono bg-white"
                      rows={6}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">
                        {section.content.length} {t('settings.chars')}
                      </span>
                      <span className="text-xs text-gray-400">
                        {Math.ceil(section.content.length / 4)} {t('settings.tokensEstimate')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Token Analysis */}
            {sectionTokenInfo.length > 0 && (
              <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="text-xs font-medium text-blue-800 mb-2">{t('settings.tokenAnalysis')}</h3>
                {sectionTokenInfo.map((info) => (
                  <div key={info.sectionId} className="flex items-center justify-between text-xs text-blue-700 py-0.5">
                    <span>{info.label}</span>
                    <span>{info.tokens} {t('token.tokens')} ({info.percentage.toFixed(1)}%)</span>
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-blue-200 flex items-center justify-between text-xs font-medium text-blue-800">
                  <span>{t('chat.total')}</span>
                  <span>{sectionTokenInfo.reduce((s, i) => s + i.tokens, 0)} {t('token.tokens')}</span>
                </div>
              </div>
            )}
          </div>

          {/* ====== Theme & Language Section ====== */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('settings.appearance')}</h2>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.theme')}</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="theme"
                    value="light"
                    checked={otherSettings.theme === 'light'}
                    onChange={() => setOtherSettings((prev) => ({ ...prev, theme: 'light' }))}
                    className="text-gray-900 focus:ring-gray-900"
                  />
                  <span className="text-sm text-gray-700">{t('common.light')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="theme"
                    value="dark"
                    checked={otherSettings.theme === 'dark'}
                    onChange={() => setOtherSettings((prev) => ({ ...prev, theme: 'dark' }))}
                    className="text-gray-900 focus:ring-gray-900"
                  />
                  <span className="text-sm text-gray-700">{t('common.dark')}</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.language')}</label>
              <div className="flex gap-4">
                {getSupportedLocales().map((locale) => (
                  <label key={locale.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="language"
                      value={locale.value}
                      checked={otherSettings.language === locale.value}
                      onChange={() => setOtherSettings((prev) => ({ ...prev, language: locale.value }))}
                      className="text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-sm text-gray-700">{locale.flag} {locale.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ====== Save Other Settings Button ====== */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveOtherSettings}
              className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium text-sm transition-colors"
            >
              {t('settings.saveSettings')}
            </button>
          </div>
        </div>

        {/* ====== Token Stats Section ====== */}
        <div className="border-t border-gray-200 pt-6 px-4 pb-6">
          <div className="h-96 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <TokenStats />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
