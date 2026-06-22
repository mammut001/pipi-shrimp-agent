import React from 'react';
import { t } from '@/i18n';
import type { Recipe } from '../../bootstrapRecipePrompt';
import type { SshConfig } from '@/store/autoresearchStore';

interface WorkspaceSectionProps {
  recipe: Recipe;
  sshConfig?: SshConfig;
  onChange: (val: Partial<Recipe['workspace']>) => void;
}

export function WorkspaceSection({ recipe, sshConfig, onChange }: WorkspaceSectionProps) {
  return (
    <div className="space-y-4 font-sans">
      <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
          {t('autoresearch.recipe.targetProfileMode') || 'Target Profile Mode'}
        </span>
        <span className="text-xs font-semibold text-gray-700 flex items-center gap-1 font-sans">
          <span>
            {sshConfig?.mode === 'ssh'
              ? `🌐 ${t('autoresearch.recipe.remoteMode') || 'SSH Remote Connection'}`
              : `💻 ${t('autoresearch.recipe.localMode') || 'Local Project Directory'}`}
          </span>
        </span>
        {sshConfig?.mode === 'ssh' && (
          <p className="text-[10px] text-gray-400 mt-1">
            {t('autoresearch.recipe.hostUser', {
              host: sshConfig.host,
              port: sshConfig.port,
              user: sshConfig.user,
            }) || `Host: ${sshConfig.host}:${sshConfig.port} (User: ${sshConfig.user})`}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 font-sans">
            {t('autoresearch.recipe.rootDir') || 'Root Directory Path'}
          </label>
          <input
            type="text"
            value={recipe.workspace.workDir}
            onChange={(e) => onChange({ workDir: e.target.value })}
            placeholder={t('autoresearch.recipe.rootDirPlaceholder') || '/path/to/workdir'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          {recipe.workspace.workDir.trim().length === 0 && (
            <span className="text-[10px] text-red-500 font-medium">
              {t('autoresearch.recipe.rootDirEmpty') || '⚠️ Target directory path cannot be empty'}
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 font-sans">
            {t('autoresearch.recipe.scaffoldFolderLabel') || 'Scaffold Folder Name'}
          </label>
          <input
            type="text"
            value={recipe.workspace.folderName}
            onChange={(e) => onChange({ folderName: e.target.value })}
            placeholder={t('autoresearch.recipe.scaffoldPlaceholder') || 'e.g. experiment-run'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          {recipe.workspace.folderName.trim().length === 0 && (
            <span className="text-[10px] text-red-500 font-medium">
              {t('autoresearch.recipe.folderNameEmpty') || '⚠️ Folder name is required'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
