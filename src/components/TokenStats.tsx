/**
 * TokenStats - Token usage statistics component
 * 
 * Shows daily, monthly, and model-based token usage statistics.
 */

import { useState, useEffect, useCallback } from 'react';
import { useChatStore } from '@/store';

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

export function TokenStats() {
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'model'>('daily');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<DailyStats[]>([]);
  const [modelStats, setModelStats] = useState<ModelStats[]>([]);
  const [totalStats, setTotalStats] = useState({ input: 0, output: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  const {
    getDailyTokenStats,
    getMonthlyTokenStats,
    getModelTokenStats,
    getTotalTokenStats,
  } = useChatStore();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [daily, monthly, model, total] = await Promise.all([
        getDailyTokenStats(selectedMonth),
        getMonthlyTokenStats(),
        getModelTokenStats(),
        getTotalTokenStats(),
      ]);
      setDailyStats(daily);
      setMonthlyStats(monthly);
      setModelStats(model);
      setTotalStats(total);
    } catch (error) {
      console.error('Failed to load token stats:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, getDailyTokenStats, getMonthlyTokenStats, getModelTokenStats, getTotalTokenStats]);

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
    return model.slice(0, 15);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">📊 Token 使用统计</h2>
        <p className="text-sm text-gray-500 mt-1">查看您的 API token 消耗情况</p>
      </div>

      {/* Total Stats Card */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{formatNumber(totalStats.input)}</div>
            <div className="text-xs text-gray-500">总输入</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{formatNumber(totalStats.output)}</div>
            <div className="text-xs text-gray-500">总输出</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{formatNumber(totalStats.total)}</div>
            <div className="text-xs text-gray-500">总计</div>
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
          📅 每日
        </button>
        <button
          onClick={() => setActiveTab('monthly')}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'monthly'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          📊 月度
        </button>
        <button
          onClick={() => setActiveTab('model')}
          className={`flex-1 py-2 text-sm font-medium ${
            activeTab === 'model'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          🤖 模型
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-gray-500">加载中...</div>
          </div>
        ) : (
          <>
            {/* Daily Stats */}
            {activeTab === 'daily' && (
              <div>
                {/* Month Selector */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">选择月份</label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>

                {/* Daily Stats List */}
                {dailyStats.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">暂无数据</div>
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
                            总计: {formatNumber(stat.total_tokens)}
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          <span>输入: {formatNumber(stat.input_tokens)}</span>
                          <span>输出: {formatNumber(stat.output_tokens)}</span>
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
                  <div className="text-center text-gray-500 py-8">暂无数据</div>
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
                            总计: {formatNumber(stat.total_tokens)}
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          <span>输入: {formatNumber(stat.input_tokens)}</span>
                          <span>输出: {formatNumber(stat.output_tokens)}</span>
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
                  <div className="text-center text-gray-500 py-8">暂无数据</div>
                ) : (
                  <div className="space-y-2">
                    {modelStats.map((stat) => (
                      <div
                        key={stat.model}
                        className="bg-white rounded-lg p-3 border border-gray-200"
                      >
                        <div className="flex justify-between items-center">
                          <div className="font-medium text-gray-900">{formatModelName(stat.model)}</div>
                          <div className="text-sm text-gray-500">
                            总计: {formatNumber(stat.total_tokens)}
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-500">
                          <span>输入: {formatNumber(stat.input_tokens)}</span>
                          <span>输出: {formatNumber(stat.output_tokens)}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">{stat.model}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default TokenStats;
