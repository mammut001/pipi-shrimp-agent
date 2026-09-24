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

import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { useSettingsStore, useUIStore } from '@/store';
import type { ApiConfig, ModelPricing, ModelEntry } from '@/types/settings';
import { DEFAULT_MODEL_PRICING } from '@/types/settings';
import {
  resolveDraftApiKeyValue,
  resolveAgentConfig,
  sanitizeApiKeyValue,
  validateApiKeyForConnection,
  formatApiKeyLengthHint,
} from '@/services/agentConfig';
import { testResolvedChatConnection } from '@/services/resolvedChatRequest';
import { formatError } from '@/utils/errorFormat';
import {
  getProvider,
  getProviderDefaultModelId,
  getProviderDefaultModelIds,
  getProviderDefaultBaseUrl,
  getProviderDefaultApiFormat,
  isApiKeyRequired,
  canFetchModels,
  supportsCustomModel,
  validateProviderFields,
  validateFetchModelsPrereqs,
} from '@/shared/providers';
import type { ProviderName } from '@/shared/providers';
import { PromptTemplateSettings } from '@/components/settings/PromptTemplateSettings';
import { ApiConfigurationSettings } from '@/components/settings/ApiConfigurationSettings';
import { TelegramSettings } from '@/components/settings/TelegramSettings';
import { MCPSettingsSection } from '@/components/settings/MCPSettingsSection';
import { AgentBehaviorSettings } from '@/components/settings/AgentBehaviorSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { DatabaseHealthSection } from '@/components/settings/DatabaseHealthSection';
import { TerminalSettings } from '@/components/settings/TerminalSettings';
import type { Locale } from '@/i18n/types';
import { t, getCurrentLocale, setLocale, convertToOldLanguageCode } from '@/i18n';
import {
  buildConnectionFailureDetails,
  classifyConnectionError,
  getConnectionErrorMessage,
} from '@/services/settings/settingsConnection';

const TokenStats = lazy(() => import('@/components/TokenStats').then((module) => ({ default: module.TokenStats })));

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
    autoResearchLlmSettings,
    windowsShellProfile,
    addApiConfig,
    updateApiConfig,
    removeApiConfig,
    fetchAvailableModels,
    setActiveConfig,
    getActiveConfig,
    setTheme,
    setLanguage,
    updateAgentSettings,
    updateAutoResearchLlmSettings,
    setWindowsShellProfile,
  } = useSettingsStore();

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
    model: getProviderDefaultModelId('anthropic'),
    apiFormat: '',
    pricing: {},
  });

  // Pricing section collapsed state
  const [showPricingSection, setShowPricingSection] = useState(false);

  // Other settings form
  const [otherSettings, setOtherSettings] = useState({
    theme: 'light' as 'light' | 'dark',
    language: getCurrentLocale() as Locale,
  });

  // Build source-annotated model list: remote entries first, then default fallbacks, then current custom model if missing
  const providerName = formData.provider as ProviderName;
  const remoteEntries = availableModelEntries[providerName] ?? [];
  const remoteIds = new Set(remoteEntries.map((e) => e.id));
  const defaultIds = getProviderDefaultModelIds(providerName).filter((id) => !remoteIds.has(id));
  const currentProviderModelEntries: ModelEntry[] = [
    ...remoteEntries,
    ...defaultIds.map((id) => ({ id, source: 'default' as const })),
  ];
  const currentModel = formData.model?.trim();
  const existingIds = new Set(currentProviderModelEntries.map((e) => e.id));
  if (currentModel && !existingIds.has(formData.model) && !existingIds.has(currentModel)) {
    currentProviderModelEntries.push({ id: formData.model, source: 'user' });
  }

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydratedConfigId, setHydratedConfigId] = useState<string | null>(null);
  const resolvedActiveConfigId = getActiveConfig()?.id ?? null;

  useEffect(() => {
    setOtherSettings({
      theme,
      language: getCurrentLocale(),
    });
    setIsLoading(false);
  }, [theme]);


  useEffect(() => {
    if (apiConfigs.length === 0) {
      return;
    }

    const active = getActiveConfig();
    if (!active || hydratedConfigId === active.id) {
      return;
    }

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
    setHydratedConfigId(active.id);
  }, [apiConfigs, activeConfigId, hydratedConfigId, getActiveConfig]);

  const getEditingConfig = () => (
    editingConfigId
      ? apiConfigs.find((config) => config.id === editingConfigId) || null
      : null
  );

  const buildDraftConfig = (): ApiConfig => {
    const existingConfig = getEditingConfig();

    return {
      id: editingConfigId || 'draft-config',
      name: formData.name.trim() || existingConfig?.name || formData.provider,
      provider: formData.provider,
      apiKey: resolveDraftApiKeyValue(formData.apiKey, formData.provider, existingConfig),
      baseUrl: formData.baseUrl || undefined,
      model: formData.model,
      modelProviderId: formData.provider,
      apiFormat: (formData.apiFormat || undefined) as ApiConfig['apiFormat'],
      pricing: Object.keys(formData.pricing).length > 0 ? formData.pricing : undefined,
    };
  };

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
      model: getProviderDefaultModelId('anthropic'),
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
    const draftConfig = buildDraftConfig();
    if (isApiKeyRequired(draftConfig.provider)) {
      const keyCheck = validateApiKeyForConnection(draftConfig.apiKey);
      if (!keyCheck.ok) {
        setErrors((prev) => ({ ...prev, apiKey: keyCheck.error }));
        addNotification('error', keyCheck.error);
        return;
      }
    }
    const prereqErrors = validateFetchModelsPrereqs(
      draftConfig.provider,
      draftConfig.apiKey,
      draftConfig.baseUrl || '',
    );
    if (Object.keys(prereqErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...prereqErrors }));
      return;
    }

    setIsFetchingModels(true);
    try {
      // Pass the current form data directly to fetch available models
      // This works for both new and existing configs
      const models = await fetchAvailableModels({
        provider: draftConfig.provider,
        apiKey: draftConfig.apiKey,
        baseUrl: draftConfig.baseUrl,
      });

      addNotification('success', `${t('settings.foundModels')}: ${models.length}`);

      if (models.length > 0) {
        setFormData(prev => {
          if (!prev.model?.trim()) {
            return { ...prev, model: models[0] };
          }
          return prev;
        });
      }
    } catch (error) {
      const errorMessage = formatError(error);
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
    const draftConfig = buildDraftConfig();

    if (!formData.name.trim()) {
      newErrors.name = t('settings.nameRequired');
    }

    if (!formData.model.trim()) {
      newErrors.model = t('settings.modelRequired');
    }

    // Capability-driven provider field validation
    const providerErrors = validateProviderFields(
      draftConfig.provider,
      draftConfig.apiKey,
      draftConfig.baseUrl || '',
    );
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
      const draftConfig = buildDraftConfig();
      const configData = {
        name: draftConfig.name,
        provider: draftConfig.provider,
        apiKey: draftConfig.apiKey,
        baseUrl: draftConfig.baseUrl,
        model: draftConfig.model,
        modelProviderId: draftConfig.modelProviderId,
        apiFormat: draftConfig.apiFormat,
        pricing: draftConfig.pricing,
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
    const config = apiConfigs.find((c) => c.id === id);
    if (config) {
      handleSelectConfig(config);
    }
    addNotification('success', `${t('settings.switchedToConfig')}: ${config?.name}`);
  };

  /**
   * Handle test connection with latency measurement and error classification
   */
  const handleTestConnection = async () => {
    const draftConfig = buildDraftConfig();
    const providerErrors = validateProviderFields(
      draftConfig.provider,
      draftConfig.apiKey,
      draftConfig.baseUrl || '',
    );
    if (Object.keys(providerErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...providerErrors }));
      return;
    }

    if (isApiKeyRequired(draftConfig.provider)) {
      const keyCheck = validateApiKeyForConnection(draftConfig.apiKey);
      if (!keyCheck.ok) {
        setErrors((prev) => ({ ...prev, apiKey: keyCheck.error }));
        setTestResult({ success: false, message: keyCheck.error });
        addNotification('error', keyCheck.error);
        return;
      }
    }

    if (!formData.model.trim()) {
      setErrors((prev) => ({ ...prev, model: t('settings.modelRequired') }));
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const startTime = Date.now();

    try {
      const resolvedConfig = resolveAgentConfig(draftConfig);

      // Debug: non-secret length only (no raw key material)
      console.info('[Settings Test] API Key debug', {
        keyLength: resolvedConfig.apiKey?.length ?? 0,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        baseUrl: resolvedConfig.baseUrl,
        apiFormat: resolvedConfig.apiFormat,
      });

      const result = await testResolvedChatConnection(
        resolvedConfig,
        `settings-api-test-${editingConfigId ?? 'draft'}-${Date.now()}`,
      );

      const latency = result.latencyMs || (Date.now() - startTime);
      const successMsg = t('settings.testConnectionSuccess')
        .replace('{provider}', resolvedConfig.provider)
        .replace('{model}', resolvedConfig.model)
        .replace('{latency}', String(latency));
      setTestResult({ success: true, message: successMsg });
      addNotification('success', t('settings.connectionTestPassed'));
    } catch (error) {
      const details = (error instanceof Error && 'diagnostics' in error)
        ? buildConnectionFailureDetails(
          (error as Error & { diagnostics: Parameters<typeof buildConnectionFailureDetails>[0] }).diagnostics,
          error,
        )
        : formatError(error);
      const rawMsg = error instanceof Error ? error.message : formatError(error);
      const friendlyMsg = getConnectionErrorMessage(classifyConnectionError(rawMsg), t);

      setTestResult({ success: false, message: `${friendlyMsg}\n${details}` });
      addNotification('error', `${t('settings.connectionTestFailed')}: ${friendlyMsg}`);
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

  const handleClose = useCallback(() => {
    toggleSettings();
  }, [toggleSettings]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm transition-opacity" onClick={handleClose} />

      {/* Modal Content */}
      <div className="relative bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-xl max-h-[85vh] overflow-y-auto animate-in">
        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3.5 right-4 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors z-10"
          title={t('common.close')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">{t('settings.title')}</h1>
            <p className="text-slate-500 text-[11px] mt-0.5">{t('settings.subtitle')}</p>
          </div>
        </div>

        <div className="p-5 space-y-5">

          <ApiConfigurationSettings
            apiConfigs={apiConfigs}
            showApiKey={showApiKey}
            toggleShowApiKey={toggleShowApiKey}
            editingConfigId={editingConfigId}
            resolvedActiveConfigId={resolvedActiveConfigId}
            activeConfigId={activeConfigId}
            formData={formData}
            errors={errors}
            isSaving={isSaving}
            isTesting={isTesting}
            testResult={testResult}
            isFetchingModels={isFetchingModels}
            autoResearchLlmSettings={autoResearchLlmSettings}
            updateAutoResearchLlmSettings={updateAutoResearchLlmSettings}
            currentProviderModelEntries={currentProviderModelEntries}
            showPricingSection={showPricingSection}
            setShowPricingSection={setShowPricingSection}
            actions={{
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
            }}
          />
          {/* ====== Telegram Section ====== */}
          <TelegramSettings />

          {/* ====== MCP Section ====== */}
          <MCPSettingsSection />

          {/* ====== Agent Settings Section ====== */}
          <AgentBehaviorSettings
            agentSettings={agentSettings}
            onUpdate={updateAgentSettings}
          />

          <TerminalSettings
            windowsShellProfile={windowsShellProfile}
            onChange={setWindowsShellProfile}
          />

          {/* ====== Database Health Section ====== */}
          <DatabaseHealthSection addNotification={addNotification} />

          <PromptTemplateSettings />

          {/* ====== Theme & Language Section ====== */}
          <AppearanceSettings
            theme={otherSettings.theme}
            language={otherSettings.language}
            onThemeChange={(nextTheme) => setOtherSettings((prev) => ({ ...prev, theme: nextTheme }))}
            onLanguageChange={(nextLanguage) => setOtherSettings((prev) => ({ ...prev, language: nextLanguage as Locale }))}
          />

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
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400">{t('common.loading')}</div>}>
              <TokenStats />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
