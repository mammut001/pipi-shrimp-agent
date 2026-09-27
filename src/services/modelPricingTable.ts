/**
 * Model pricing table lifecycle: load the backend's saved OpenRouter table at
 * startup, refresh it in the background once it is a week old, and let
 * Settings refresh it on demand.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  setRemotePricingTable,
  type RemotePricingMeta,
  type RemotePricingTable,
} from '@/shared/providers';
import { useSettingsStore } from '@/store/settingsStore';

const MAX_TABLE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function applyTable(table: RemotePricingTable): RemotePricingMeta {
  setRemotePricingTable(table);
  useSettingsStore.setState({ pricingTableMeta: table._meta });
  return table._meta;
}

/** Parse the backend's `%Y-%m-%d %H:%M:%S%z` timestamp (`...20:34:28+0800`). */
export function parsePricingTimestamp(value: string): number {
  const iso = value.trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return Date.parse(iso);
}

export function isPricingTableStale(meta: RemotePricingMeta | null, now = Date.now()): boolean {
  if (!meta) {
    return true;
  }
  const updatedAt = parsePricingTimestamp(meta.updated_at);
  return !Number.isFinite(updatedAt) || now - updatedAt > MAX_TABLE_AGE_MS;
}

export async function loadModelPricingTable(): Promise<RemotePricingMeta> {
  return applyTable(await invoke<RemotePricingTable>('get_model_pricing_table'));
}

export async function refreshModelPricingTable(): Promise<RemotePricingMeta> {
  return applyTable(await invoke<RemotePricingTable>('refresh_model_pricing'));
}

export async function initModelPricingTable(): Promise<void> {
  const meta = await loadModelPricingTable();
  if (isPricingTableStale(meta)) {
    // Offline or blocked is fine: the saved or bundled table stays in use.
    await refreshModelPricingTable().catch((error: unknown) => {
      console.warn('[pricing] Background price refresh failed:', error);
    });
  }
}
