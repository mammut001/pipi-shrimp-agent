/**
 * SidebarAccountChip — bottom-left account/model chip with picker.
 *
 * Opens a keyboard-accessible menu of API configs (same inventory Settings
 * uses) so users can switch account/model without hunting for the gear.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsStore, useUIStore } from '@/store';
import { t } from '@/i18n';
import { getProvider } from '@/shared/providers';

export const SIDEBAR_ACCOUNT_CHIP_TEST_ID = 'sidebar-account-chip';
export const SIDEBAR_ACCOUNT_PICKER_TEST_ID = 'sidebar-account-picker';

export function SidebarAccountChip() {
  const apiConfigs = useSettingsStore((s) => s.apiConfigs);
  const activeConfigId = useSettingsStore((s) => s.activeConfigId);
  const setActiveConfig = useSettingsStore((s) => s.setActiveConfig);
  const addNotification = useUIStore((s) => s.addNotification);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const activeApiConfig = useMemo(
    () => apiConfigs.find((c) => c.id === activeConfigId) || apiConfigs[0] || null,
    [apiConfigs, activeConfigId],
  );
  const profileName = activeApiConfig?.name?.trim() || t('sidebar.localUser');
  const providerLabel = activeApiConfig
    ? (getProvider(activeApiConfig.provider)?.label ?? activeApiConfig.provider)
    : null;
  const profileSubtitle = providerLabel
    ? `${providerLabel} ${t('sidebar.accountSuffix')}`
    : t('sidebar.noApiConfig');
  const profileInitial = (profileName.charAt(0) || 'U').toUpperCase();
  const resolvedActiveId = activeApiConfig?.id ?? null;

  const openSettings = useCallback(() => {
    useUIStore.setState({ settingsOpen: true });
  }, []);

  const closePicker = useCallback(() => setOpen(false), []);

  const handleChipClick = useCallback(() => {
    if (apiConfigs.length === 0) {
      openSettings();
      return;
    }
    setOpen((prev) => !prev);
  }, [apiConfigs.length, openSettings]);

  const handleSelectConfig = useCallback(
    (id: string) => {
      if (id !== resolvedActiveId) {
        setActiveConfig(id);
        const config = apiConfigs.find((c) => c.id === id);
        if (config) {
          addNotification('success', `${t('settings.switchedToConfig')}: ${config.name}`);
        }
      }
      closePicker();
    },
    [addNotification, apiConfigs, closePicker, resolvedActiveId, setActiveConfig],
  );

  const handleManageInSettings = useCallback(() => {
    closePicker();
    openSettings();
  }, [closePicker, openSettings]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closePicker();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [closePicker, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePicker();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closePicker, open]);

  const menuPosition = (() => {
    if (!open || !rootRef.current || typeof window === 'undefined') return null;
    const rect = rootRef.current.getBoundingClientRect();
    return {
      left: Math.max(8, rect.left),
      bottom: Math.max(8, window.innerHeight - rect.top + 8),
      minWidth: Math.max(rect.width, 240),
    };
  })();

  const pickerMenu =
    open && menuPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={t('sidebar.accountPickerLabel')}
            data-testid={SIDEBAR_ACCOUNT_PICKER_TEST_ID}
            className="fixed z-[1100] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden"
            style={{
              left: menuPosition.left,
              bottom: menuPosition.bottom,
              minWidth: menuPosition.minWidth,
              maxWidth: 320,
            }}
          >
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {t('sidebar.accountPickerLabel')}
              </p>
            </div>
            <ul className="max-h-64 overflow-y-auto py-1">
              {apiConfigs.map((config) => {
                const isActive = config.id === resolvedActiveId;
                const label = getProvider(config.provider)?.label ?? config.provider;
                return (
                  <li key={config.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-testid={`sidebar-account-option-${config.id}`}
                      onClick={() => handleSelectConfig(config.id)}
                      className={`w-full px-3 py-2.5 text-left flex items-start gap-2.5 transition-colors ${
                        isActive ? 'bg-gray-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          isActive ? 'border-green-500 bg-green-500' : 'border-gray-300'
                        }`}
                        aria-hidden="true"
                      >
                        {isActive && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 truncate">{config.name}</span>
                        <span className="block text-xs text-gray-500 truncate">
                          {label} · {config.model}
                        </span>
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-green-600 flex-shrink-0">
                          {t('settings.active')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-gray-100 p-1">
              <button
                type="button"
                data-testid="sidebar-account-manage-settings"
                onClick={handleManageInSettings}
                className="w-full px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                {t('sidebar.manageAccountsInSettings')}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        data-testid={SIDEBAR_ACCOUNT_CHIP_TEST_ID}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        title={t('sidebar.openAccountPicker')}
        aria-label={t('sidebar.openAccountPicker')}
        onClick={handleChipClick}
        className="w-full flex items-center gap-3 rounded-xl px-1 py-1 -mx-1 text-left
                   hover:bg-white/80 hover:shadow-sm focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-gray-900/20
                   active:scale-[0.99] transition-all"
      >
        <div className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-sm ring-2 ring-white select-none flex-shrink-0">
          <span className="font-bold text-sm">{profileInitial}</span>
        </div>
        <div className="min-w-0 flex-1 select-none">
          <p className="text-sm font-semibold text-gray-900 truncate leading-none mb-1">{profileName}</p>
          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider opacity-60 truncate">
            {profileSubtitle}
          </p>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {pickerMenu}
    </div>
  );
}

export default SidebarAccountChip;
