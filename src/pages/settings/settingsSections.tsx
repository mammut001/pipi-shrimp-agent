import type { ComponentProps, ReactNode } from 'react';
import { t } from '@/i18n';
import { TelegramSettings } from '@/components/settings/TelegramSettings';
import { MCPSettingsSection } from '@/components/settings/MCPSettingsSection';
import { AgentBehaviorSettings } from '@/components/settings/AgentBehaviorSettings';
import { TerminalSettings } from '@/components/settings/TerminalSettings';
import { DatabaseHealthSection } from '@/components/settings/DatabaseHealthSection';
import { PromptTemplateSettings } from '@/components/settings/PromptTemplateSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';

export interface SettingsModalShellProps {
  onClose: () => void;
  children: ReactNode;
}

export function SettingsLoadingState() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
    </div>
  );
}

export function SettingsModalShell({ onClose, children }: SettingsModalShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm transition-opacity" onClick={onClose} />

      {/* Modal Content */}
      <div className="relative bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-xl max-h-[85vh] overflow-y-auto animate-in">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
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

        {children}
      </div>
    </div>
  );
}

export interface SettingsSecondarySectionsProps {
  agentSettings: ComponentProps<typeof AgentBehaviorSettings>['agentSettings'];
  onUpdateAgentSettings: ComponentProps<typeof AgentBehaviorSettings>['onUpdate'];
  windowsShellProfile: ComponentProps<typeof TerminalSettings>['windowsShellProfile'];
  onWindowsShellProfileChange: ComponentProps<typeof TerminalSettings>['onChange'];
  addNotification: ComponentProps<typeof DatabaseHealthSection>['addNotification'];
  theme: ComponentProps<typeof AppearanceSettings>['theme'];
  language: ComponentProps<typeof AppearanceSettings>['language'];
  onThemeChange: ComponentProps<typeof AppearanceSettings>['onThemeChange'];
  onLanguageChange: ComponentProps<typeof AppearanceSettings>['onLanguageChange'];
  onSaveOtherSettings: () => void | Promise<void>;
}

export function SettingsSecondarySections({
  agentSettings,
  onUpdateAgentSettings,
  windowsShellProfile,
  onWindowsShellProfileChange,
  addNotification,
  theme,
  language,
  onThemeChange,
  onLanguageChange,
  onSaveOtherSettings,
}: SettingsSecondarySectionsProps) {
  return (
    <>
      {/* ====== Telegram Section ====== */}
      <TelegramSettings />

      {/* ====== MCP Section ====== */}
      <MCPSettingsSection />

      {/* ====== Agent Settings Section ====== */}
      <AgentBehaviorSettings
        agentSettings={agentSettings}
        onUpdate={onUpdateAgentSettings}
      />

      <TerminalSettings
        windowsShellProfile={windowsShellProfile}
        onChange={onWindowsShellProfileChange}
      />

      {/* ====== Database Health Section ====== */}
      <DatabaseHealthSection addNotification={addNotification} />

      <PromptTemplateSettings />

      {/* ====== Theme & Language Section ====== */}
      <AppearanceSettings
        theme={theme}
        language={language}
        onThemeChange={onThemeChange}
        onLanguageChange={onLanguageChange}
      />

      {/* ====== Save Other Settings Button ====== */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSaveOtherSettings}
          className="px-6 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium text-sm transition-colors"
        >
          {t('settings.saveSettings')}
        </button>
      </div>
    </>
  );
}

export interface SettingsTokenStatsFrameProps {
  children: ReactNode;
}

export function SettingsTokenStatsFrame({ children }: SettingsTokenStatsFrameProps) {
  return (
    <div className="border-t border-gray-200 pt-6 px-4 pb-6">
      <div className="h-96 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {children}
      </div>
    </div>
  );
}
