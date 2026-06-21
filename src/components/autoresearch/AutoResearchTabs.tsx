import { useState } from 'react';
import { t } from '@/i18n';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { AdvancedWorkdirSetup } from './AdvancedWorkdirSetup';
import { BootstrapChatView } from './BootstrapChatView';

type AutoResearchTabId = 'conversational' | 'advanced';

export function AutoResearchTabs() {
  const runHistory = useAutoResearchStore((s) => s.runHistory);
  const [activeTab, setActiveTab] = useState<AutoResearchTabId>(
    runHistory.length > 0 ? 'advanced' : 'conversational'
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="inline-flex rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('conversational')}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === 'conversational'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t('autoresearch.tabs.conversational')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('advanced')}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === 'advanced'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t('autoresearch.tabs.advanced')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <div className={activeTab === 'conversational' ? 'flex h-full' : 'hidden h-full'}>
          <BootstrapChatView onReady={() => setActiveTab('advanced')} />
        </div>
        <div className={activeTab === 'advanced' ? 'flex h-full' : 'hidden h-full'}>
          <AdvancedWorkdirSetup />
        </div>
      </div>
    </div>
  );
}

export default AutoResearchTabs;