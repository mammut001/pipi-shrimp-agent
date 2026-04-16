/**
 * TokenStats - Token usage statistics component
 *
 * Shows daily, monthly, and model-based token usage statistics with cost estimation.
 */

import { useState, useEffect, useCallback } from 'react';
import { useChatStore, useSettingsStore } from '@/store';
import { calculateRequestCost, formatCost } from '@/utils/pricing';
import { t } from '@/i18n';

interface DailyStats {
  date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface ModelStats {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface DailyStatsWithCost extends DailyStats {
  cost: number;
}

interface ModelStatsWithCost extends ModelStats {
  cost: number;
  pricing: { inputPrice: number; outputPrice: number } | null;
}

export function TokenStats() {
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'model'>('daily');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedApiConfigId, setSelectedApiConfigId] = useState<string>('all');
  const [dailyStats, setDailyStats] = useState<DailyStatsWithCost[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<DailyStatsWithCost[]>([]);
  const [modelStats, setModelStats] = useState<ModelStatsWithCost[]>([]);
  const [totalStats, setTotalStats] = useState({ input: 0, output: 0, total: 0, cost: 0 });
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const {
    getDailyTokenStats,
    getMonthlyTokenStats,
    getModelTokenStats,
    getTotalTokenStats,
    resetTokenEstimate,
  } = useChatStore();

  const apiConfigs = useSettingsStore((s) => s.apiConfigs);

  const handleResetTokenEstimate = async () => {
    if (resetting) return;
    if (!window.confirm(t('token.resetConfirm'))) return;
    setResetting(true);
    try {
      await resetTokenEstimate();
      await loadData();
      alert(t('token.resetSuccess'));
    } catch (error: any) {
      alert(t('token.resetFailed') + ': ' + error.message);
    } finally {
      setResetting(false);
    }
  };

  const getModelPricing = useSettingsStore((s) => s.getModelPricing);

  // Calculate cost for a given stats entry
  const calculateStatsCost = useCallback((stats: { input_tokens: number; output_tokens: number }, model?: string): number => {
    // Use the provided model or try to find pricing from settings
    // For aggregate stats, we use a weighted average approach
    if (!model) {
      return 0;
    }

    const pricing = getModelPricing(model, 'anthropic');
    if (!pricing) return 0;

    return calculateRequestCost(stats.input_tokens, stats.output_tokens, pricing);
  }, [getModelPricing]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const filterConfigId = selectedApiConfigId === 'all' ? undefined : selectedApiConfigId;
    try {
      const [daily, monthly, model, total] = await Promise.all([
        getDailyTokenStats(selectedMonth, filterConfigId),
        getMonthlyTokenStats(filterConfigId),
        getModelTokenStats(filterConfigId),
        getTotalTokenStats(filterConfigId),
      ]);

      // Calculate costs for daily stats (using default model pricing as approximation)
      const dailyWithCost = daily.map((stat): DailyStatsWithCost => ({
        ...stat,
        cost: 0, // Daily stats don't have model info, show aggregate cost only
      }));

      // Calculate costs for monthly stats
      const monthlyWithCost = monthly.map((stat): DailyStatsWithCost => ({
        ...stat,
        cost: 0,
      }));

      // Calculate costs for model stats
      const modelWithCost = model.map((stat): ModelStatsWithCost => {
        const pricing = getModelPricing(stat.model, 'anthropic');
        const cost = pricing
          ? calculateRequestCost(stat.input_tokens, stat.output_tokens, pricing)
          : 0;

        return {
          ...stat,
          cost,
          pricing: pricing ? { inputPrice: pricing.inputPrice, outputPrice: pricing.outputPrice } : null,
        };
      });

      // Calculate total cost
      const totalCost = modelWithCost.reduce((sum, stat) => sum + stat.cost, 0);

      setDailyStats(dailyWithCost);
      setMonthlyStats(monthlyWithCost);
      setModelStats(modelWithCost);
      setTotalStats({ ...total, cost: totalCost });
    } catch (error) {
      console.error('Failed to load token stats:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, selectedApiConfigId, getDailyTokenStats, getMonthlyTokenStats, getModelTokenStats, getTotalTokenStats, getModelPricing, calculateStatsCost]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatModelName = (model: string) => {
    // Shorten model names for display
    if (model.includes('claude-sonnet')) return 'Sonnet';
    if (model.includes('claude-haiku')) return 'Haiku';
    if (model.includes('claude-opus')) return 'Opus';
    if (model.includes('MiniMax')) return model.replace('MiniMax-', 'MiniMax ');
    if (model.includes('gpt-4')) return model.replace('gpt-4', 'GPT-4').replace(/-/g, ' ');
    return model.slice(0, 15);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
       {/* Header */}
       <div className="px-4 py-3 bg-white border-b border-gray-200">
         <div className="flex justify-between items-center">
           <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('token.usageStats')}</h2>
              <p className="text-sm text-gray-500 mt-1">{t('token.viewConsumption')}</p>
            </div>
            <button
              onClick={handleResetTokenEstimate}
              disabled={resetting}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                resetting
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
            >
              {resetting ? t('token.loading') : t('token.resetStats')}
            </button>
         </div>

         {/* API Key Selector */}
         {apiConfigs.length > 1 && (
           <div className="mt-2">
             <select
               value={selectedApiConfigId}
               onChange={(e) => setSelectedApiConfigId(e.target.value)}
               className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-gray-50 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
             >
               <option value="all">{t('token.allApiKeys') || '全部 API Key'}</option>
               {apiConfigs.map((config) => (
                 <option key={config.id} value={config.id}>
                   {config.name} ({config.provider})
                 </option>
               ))}
             </select>
           </div>
         )}
       </div>

      {/* Total Stats Card */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        {/* Cost Summary */}
        {totalStats.cost > 0 && (
          <div className="mb-3 p-2 bg-green-50 rounded-lg border border-green-200">
            <div className="text-center">
              <div className="text-xl font-bold text-green-600">
                💰 {formatCost(totalStats.cost)}
              </div>
               <div className="text-xs text-green-600">{t('token.totalCostLabel')}</div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{formatNumber(totalStats.input)}</div>
            <div className="text-xs text-gray-500">{t('token.totalInput')}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{formatNumber(totalStats.output)}</div>
            <div className="text-xs text-gray-500">{t('token.totalOutput')}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{formatNumber(totalStats.total)}</div>
            <div className="text-xs text-gray-500">{t('token.total')}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveTab('daily')}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'daily'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('token.daily')}
        </button>
        <button
          onClick={() => setActiveTab('monthly')}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'monthly'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('token.monthly')}
        </button>
        <button
          onClick={() => setActiveTab('model')}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'model'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('token.byModel')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500">{t('token.loading')}</div>
          </div>
        ) : (
          <>
            {/* Daily Stats */}
            {activeTab === 'daily' && (
              <div>
                {/* Month Selector */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('token.selectMonth')}</label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>

                {/* Daily Stats List */}
                {dailyStats.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">{t('token.noData')}</div>
                ) : (
                  <div className="space-y-2">
                    {dailyStats.map((stat) => (
                      <div
                        key={stat.date}
                        className="bg-white rounded-lg p-3 border border-gray-200"
                      >
                        <div className="flex justify-between items-center">
                          <div className="font-medium text-gray-900">{stat.date}</div>
                          <div className="text-sm text-gray-500">
                            {t('token.total')}: {formatNumber(stat.total_tokens)}
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          <span>{t('token.input')}: {formatNumber(stat.input_tokens)}</span>
                          <span>{t('token.output')}: {formatNumber(stat.output_tokens)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Monthly Stats */}
            {activeTab === 'monthly' && (
              <div>
                {monthlyStats.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">{t('token.noData')}</div>
                ) : (
                  <div className="space-y-2">
                    {monthlyStats.map((stat) => (
                      <div
                        key={stat.date}
                        className="bg-white rounded-lg p-3 border border-gray-200"
                      >
                        <div className="flex justify-between items-center">
                          <div className="font-medium text-gray-900">{stat.date}</div>
                          <div className="text-sm text-gray-500">
                            {t('token.total')}: {formatNumber(stat.total_tokens)}
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          <span>{t('token.input')}: {formatNumber(stat.input_tokens)}</span>
                          <span>{t('token.output')}: {formatNumber(stat.output_tokens)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Model Stats */}
            {activeTab === 'model' && (
              <div>
                {modelStats.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">{t('token.noData')}</div>
                ) : (
                  <div className="space-y-2">
                    {modelStats.map((stat) => (
                      <div
                        key={stat.model}
                        className="bg-white rounded-lg p-3 border border-gray-200"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-gray-900">{formatModelName(stat.model)}</div>
                            {stat.cost > 0 && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
                                {formatCost(stat.cost)}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">
                            {t('token.total')}: {formatNumber(stat.total_tokens)}
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          <span>{t('token.input')}: {formatNumber(stat.input_tokens)}</span>
                          <span>{t('token.output')}: {formatNumber(stat.output_tokens)}</span>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <div className="text-xs text-gray-400">{stat.model}</div>
                          {stat.pricing && (
                            <div className="text-xs text-gray-400">
                              {formatCost(stat.pricing.inputPrice / 1000)}/1K in | {formatCost(stat.pricing.outputPrice / 1000)}/1K out
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Cost Disclaimer */}
            <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-xs text-yellow-700 whitespace-pre-line">{t('token.disclaimer')}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TokenStats;
