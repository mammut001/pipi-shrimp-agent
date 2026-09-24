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
import type { ApiConfig } from '@/types/settings';
import { DEFAULT_MODEL_PRICING } from '@/types/settings';
import { resolveAgentConfig, validateApiKeyForConnection } from '@/services/agentConfig';
import { testResolvedChatConnection } from '@/services/resolvedChatRequest';
import { formatError } from '@/utils/errorFormat';
import {
  isApiKeyRequired,
  validateProviderFields,
  validateFetchModelsPrereqs,
  type ProviderName,
} from '@/shared/providers';
import { ApiConfigurationSettings } from '@/components/settings/ApiConfigurationSettings';
import type { Locale } from '@/i18n/types';
import { t, getCurrentLocale, setLocale, convertToOldLanguageCode } from '@/i18n';
import {
  type SettingsFormData,
  createEmptySettingsFormData,
  settingsFormDataFromConfig,
  buildProviderModelEntries,
  buildDraftApiConfig,
  buildProviderChangeUpdates,
  getSettingsPricingDisplay,
  collectApiFormErrors,
  buildSaveConfigPayload,
  buildConnectionTestSuccessMessage,
  buildConnectionTestFailure,
} from './settings/settingsFormHelpers';
import {
  SettingsLoadingState,
  SettingsModalShell,
  SettingsSecondarySections,
  SettingsTokenStatsFrame,
} from './settings/settingsSections';

const TokenStats = lazy(() => import('@/components/TokenStats').then((module) => ({ default: module.TokenStats })));

/**
 * Settings page component
 */
export function Settings() {
  const {
    apiConfigs, activeConfigId, theme, availableModelEntries,
    agentSettings, autoResearchLlmSettings, windowsShellProfile,
    addApiConfig, updateApiConfig, removeApiConfig, fetchAvailableModels,
    setActiveConfig, getActiveConfig, setTheme, setLanguage,
    updateAgentSettings, updateAutoResearchLlmSettings, setWindowsShellProfile,
  } = useSettingsStore();

  const { addNotification, toggleSettings, showApiKey, toggleShowApiKey } = useUIStore();

  // Currently editing config ID (null = adding new)
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);

  // Form state for API config editing
  const [formData, setFormData] = useState<SettingsFormData>(createEmptySettingsFormData);

  // Pricing section collapsed state
  const [showPricingSection, setShowPricingSection] = useState(false);

  // Other settings form
  const [otherSettings, setOtherSettings] = useState({
    theme: 'light' as 'light' | 'dark',
    language: getCurrentLocale() as Locale,
  });

  // Build source-annotated model list: remote entries first, then default fallbacks, then current custom model if missing
  const currentProviderModelEntries = buildProviderModelEntries(
    formData.provider,
    availableModelEntries,
    formData.model,
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydratedConfigId, setHydratedConfigId] = useState<string | null>(null);
  const resolvedActiveConfigId = getActiveConfig()?.id ?? null;

  useEffect(() => {
    setOtherSettings({ theme, language: getCurrentLocale() });
    setIsLoading(false);
  }, [theme]);

  useEffect(() => {
    if (apiConfigs.length === 0) return;
    const active = getActiveConfig();
    if (!active || hydratedConfigId === active.id) return;

    setEditingConfigId(active.id);
    setFormData(settingsFormDataFromConfig(active));
    setShowPricingSection(!!active.pricing);
    setHydratedConfigId(active.id);
  }, [apiConfigs, activeConfigId, hydratedConfigId, getActiveConfig]);

  const getEditingConfig = () => (
    editingConfigId ? apiConfigs.find((config) => config.id === editingConfigId) || null : null
  );

  const buildDraftConfig = (): ApiConfig => (
    buildDraftApiConfig(formData, editingConfigId, getEditingConfig())
  );

  /** Load a config into the form for editing */
  const handleSelectConfig = (config: ApiConfig) => {
    setEditingConfigId(config.id);
    setFormData(settingsFormDataFromConfig(config));
    setShowPricingSection(!!config.pricing);
    setTestResult(null);
    setErrors({});
  };

  /** Start adding a new config */
  const handleAddNew = () => {
    setEditingConfigId(null);
    setFormData(createEmptySettingsFormData());
    setShowPricingSection(false);
    setTestResult(null);
    setErrors({});
  };

  /** Handle model fetching */
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
        setFormData((prev) => {
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

  /** Handle form field changes */
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
      const updates = buildProviderChangeUpdates(value as ProviderName, formData, availableModelEntries);
      setFormData((prev) => ({ ...prev, ...updates }));
    }
  };

  /** Handle pricing field changes */
  const handlePricingChange = (field: string, value: string) => {
    const numValue = parseFloat(value);
    setFormData((prev) => ({
      ...prev,
      pricing: { ...prev.pricing, [field]: isNaN(numValue) ? 0 : numValue },
    }));
  };

  /** Use default pricing for the current model */
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

  /** Clear custom pricing (use defaults) */
  const clearCustomPricing = () => {
    setFormData((prev) => ({ ...prev, pricing: {} }));
    addNotification('info', t('settings.usingDefaultPricing'));
  };

  /** Get current pricing display info */
  const getCurrentPricingDisplay = (): { inputPrice: number; outputPrice: number; isCustom: boolean } => (
    getSettingsPricingDisplay(formData)
  );

  /** Validate API config form */
  const validateApiForm = (): boolean => {
    const draftConfig = buildDraftConfig();
    const newErrors = collectApiFormErrors(formData, draftConfig);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /** Save API config (add or update) */
  const handleSaveConfig = async () => {
    if (!validateApiForm()) return;

    setIsSaving(true);
    try {
      const draftConfig = buildDraftConfig();
      const configData = buildSaveConfigPayload(draftConfig);

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

  /** Delete a config */
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

  /** Activate a config */
  const handleActivate = (id: string) => {
    setActiveConfig(id);
    const config = apiConfigs.find((c) => c.id === id);
    if (config) {
      handleSelectConfig(config);
    }
    addNotification('success', `${t('settings.switchedToConfig')}: ${config?.name}`);
  };

  /** Handle test connection with latency measurement and error classification */
  const handleTestConnection = async () => {
    const draftConfig = buildDraftConfig();
    const providerErrors = validateProviderFields(draftConfig.provider, draftConfig.apiKey, draftConfig.baseUrl || '');
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
      const successMsg = buildConnectionTestSuccessMessage(
        resolvedConfig.provider,
        resolvedConfig.model,
        latency,
      );
      setTestResult({ success: true, message: successMsg });
      addNotification('success', t('settings.connectionTestPassed'));
    } catch (error) {
      const { friendlyMsg, details } = buildConnectionTestFailure(error);
      setTestResult({ success: false, message: `${friendlyMsg}\n${details}` });
      addNotification('error', `${t('settings.connectionTestFailed')}: ${friendlyMsg}`);
    } finally {
      setIsTesting(false);
    }
  };

  /** Save other settings (theme, language) */
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
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  if (isLoading) {
    return <SettingsLoadingState />;
  }

  return (
    <SettingsModalShell onClose={handleClose}>
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
            handleAddNew, handleSelectConfig, handleActivate, handleDeleteConfig,
            handleChange, handleRefreshModels, handlePricingChange, useDefaultPricing,
            clearCustomPricing, getCurrentPricingDisplay, handleTestConnection, handleSaveConfig,
          }}
        />

        <SettingsSecondarySections
          agentSettings={agentSettings}
          onUpdateAgentSettings={updateAgentSettings}
          windowsShellProfile={windowsShellProfile}
          onWindowsShellProfileChange={setWindowsShellProfile}
          addNotification={addNotification}
          theme={otherSettings.theme}
          language={otherSettings.language}
          onThemeChange={(nextTheme) => setOtherSettings((prev) => ({ ...prev, theme: nextTheme }))}
          onLanguageChange={(nextLanguage) => setOtherSettings((prev) => ({ ...prev, language: nextLanguage as Locale }))}
          onSaveOtherSettings={handleSaveOtherSettings}
        />
      </div>

      <SettingsTokenStatsFrame>
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400">{t('common.loading')}</div>}>
          <TokenStats />
        </Suspense>
      </SettingsTokenStatsFrame>
    </SettingsModalShell>
  );
}

export default Settings;
