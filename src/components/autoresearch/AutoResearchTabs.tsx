import { useState } from 'react';
import { t } from '@/i18n';
import { AdvancedWorkdirSetup } from './AdvancedWorkdirSetup';
import { BootstrapChatView } from './BootstrapChatView';

type AutoResearchTabId = 'conversational' | 'advanced';

export function AutoResearchTabs() {
  const [activeTab, setActiveTab] = useState<AutoResearchTabId>('conversational');

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f6f1e8]">
      <div className="border-b border-[#e7ded1] bg-[#fbf7f0] px-4 py-3">
        <div className="inline-flex rounded-2xl border border-[#ded3c5] bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab('conversational')}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === 'conversational'
                ? 'bg-[#1d4ed8] text-white'
                : 'text-[#6f665c] hover:bg-[#f5efe6]'
            }`}
          >
            {t('autoresearch.tabs.conversational')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('advanced')}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === 'advanced'
                ? 'bg-[#1d4ed8] text-white'
                : 'text-[#6f665c] hover:bg-[#f5efe6]'
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