import { useEffect } from 'react';
import { t } from '@/i18n';
import { useChatStore, useUIStore } from '@/store';

export function NewChatProjectPickerModal() {
  const visible = useUIStore((state) => state.newChatProjectPickerVisible);
  const resolvePicker = useUIStore((state) => state.resolveNewChatProjectPicker);
  const projects = useChatStore((state) => state.projects);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        resolvePicker(undefined);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resolvePicker, visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('chat.newChatTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('chat.projectPickerDescription')}
          </p>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {projects.length > 0 ? (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50"
                onClick={() => resolvePicker(project.id)}
              >
                <span className="font-medium text-gray-800">{project.name}</span>
                <span className="text-xs text-gray-400">{t('chat.selectProject')}</span>
              </button>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
              {t('chat.projectPickerEmpty')}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            onClick={() => resolvePicker(undefined)}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => resolvePicker(null)}
          >
            {t('chat.noProjectRoot')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NewChatProjectPickerModal;
