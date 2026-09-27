import { useState } from 'react';
import { useSettingsStore, useUIStore } from '@/store';
import { refreshModelPricingTable } from '@/services/modelPricingTable';
import { t } from '@/i18n';

/** Where model prices come from, with an on-demand OpenRouter refresh. */
export function ModelPricingSource() {
  const meta = useSettingsStore((state) => state.pricingTableMeta);
  const addNotification = useUIStore((state) => state.addNotification);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await refreshModelPricingTable();
      addNotification('success', t('settings.pricesRefreshed', { count: next.active_count }));
    } catch (error) {
      addNotification('error', t('settings.pricesRefreshFailed', { error: String(error) }));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-green-700/80">
      <span className="truncate">
        {meta
          ? t('settings.pricingSource', {
            date: meta.updated_at.slice(0, 10),
            count: meta.active_count,
          })
          : t('settings.pricingSourceMissing')}
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="shrink-0 font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
      >
        {refreshing ? t('settings.refreshingPrices') : t('settings.refreshPrices')}
      </button>
    </div>
  );
}
