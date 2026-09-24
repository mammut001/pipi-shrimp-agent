import { useState } from 'react';
import { usePromptStore } from '@/store/promptStore';
import { useUIStore } from '@/store/uiStore';
import { t } from '@/i18n';
import { exportPrompt, getSectionTokenInfo } from '@/services/prompt/promptBuilder';

export function PromptTemplateSettings() {
  const { getActiveTemplate, updateSection, resetToDefault } = usePromptStore();
  const { addNotification } = useUIStore();
  const activeTemplate = getActiveTemplate();
  const sectionTokenInfo = activeTemplate ? getSectionTokenInfo(activeTemplate.sections) : [];
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{t('settings.promptTemplates')}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (!activeTemplate) return;
              const json = exportPrompt(activeTemplate.sections);
              navigator.clipboard.writeText(json);
              addNotification('success', t('settings.promptExported'));
            }}
            className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
          >
            {t('settings.exportJson')}
          </button>
          <button
            type="button"
            onClick={() => {
              resetToDefault();
              addNotification('info', t('settings.resetToDefaultTemplate'));
            }}
            className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
          >
            {t('settings.resetTemplate')}
          </button>
        </div>
      </div>

      {/* Section list */}
      {activeTemplate?.sections.map((section) => (
        <div key={section.id} className="mb-2 border border-gray-200 rounded-lg overflow-hidden">
          <div
            className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
            onClick={() => setExpandedSectionId(expandedSectionId === section.id ? null : section.id)}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(e) => {
                  e.stopPropagation();
                  updateSection(activeTemplate.id, section.id, { enabled: e.target.checked });
                }}
                onClick={(e) => e.stopPropagation()}
                className="rounded border-gray-300"
              />
              <span className="text-xs font-medium text-gray-700">{section.label}</span>
              <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
                {section.category}
              </span>
              {section.cacheable && (
                <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{t('settings.cached')}</span>
              )}
              {!section.cacheable && (
                <span className="text-xs text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">{t('settings.dynamic')}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">#{section.order}</span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${expandedSectionId === section.id ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {expandedSectionId === section.id && (
            <div className="p-3 border-t border-gray-200">
              {section.description && (
                <p className="text-xs text-gray-500 mb-2">{section.description}</p>
              )}
              <textarea
                value={section.content}
                onChange={(e) => updateSection(activeTemplate.id, section.id, { content: e.target.value })}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded font-mono bg-white"
                rows={6}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">
                  {section.content.length} {t('settings.chars')}
                </span>
                <span className="text-xs text-gray-400">
                  {Math.ceil(section.content.length / 4)} {t('settings.tokensEstimate')}
                </span>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Token Analysis */}
      {sectionTokenInfo.length > 0 && (
        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-xs font-medium text-blue-800 mb-2">{t('settings.tokenAnalysis')}</h3>
          {sectionTokenInfo.map((info) => (
            <div key={info.sectionId} className="flex items-center justify-between text-xs text-blue-700 py-0.5">
              <span>{info.label}</span>
              <span>{info.tokens} {t('token.tokens')} ({info.percentage.toFixed(1)}%)</span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-blue-200 flex items-center justify-between text-xs font-medium text-blue-800">
            <span>{t('chat.total')}</span>
            <span>{sectionTokenInfo.reduce((s, i) => s + i.tokens, 0)} {t('token.tokens')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
