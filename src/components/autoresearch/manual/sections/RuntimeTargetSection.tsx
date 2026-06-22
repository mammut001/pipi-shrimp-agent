import React from 'react';
import { t, getCurrentLocale } from '@/i18n';
import type { SshConfig } from '@/store/autoresearchStore';

interface RuntimeTargetSectionProps {
  setupForm: SshConfig;
  setSetupForm: React.Dispatch<React.SetStateAction<SshConfig>>;
}

export function RuntimeTargetSection({ setupForm, setSetupForm }: RuntimeTargetSectionProps) {
  return (
    <div className="space-y-4 font-sans">
      <div className="flex gap-1 rounded-2xl bg-gray-100/80 p-1">
        <button
          type="button"
          onClick={() => setSetupForm((current) => ({ ...current, mode: 'local' }))}
          className={`flex-1 rounded-xl py-1.5 text-xs font-semibold transition-all ${
            setupForm.mode === 'local' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('autoresearch.manual.localRun') || '本机运行'}
        </button>
        <button
          type="button"
          onClick={() => setSetupForm((current) => ({ ...current, mode: 'ssh' }))}
          className={`flex-1 rounded-xl py-1.5 text-xs font-semibold transition-all ${
            setupForm.mode === 'ssh' ? 'bg-white text-neutral-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('autoresearch.manual.sshRun') || 'SSH 远程运行'}
        </button>
      </div>

      {setupForm.mode === 'local' ? (
        <p className="text-[11px] leading-relaxed text-gray-500 font-sans">
          本机运行支持 macOS 和 Linux 操作系统。如果您的系统是 Windows，本地运行需要将 Shell 配置文件设置为 WSL。
        </p>
      ) : (
        <div className="space-y-3 font-sans">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">主机地址 (Host)</label>
            <input
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
              placeholder={t('autoresearch.hostPlaceholder')}
              value={setupForm.host}
              onChange={(event) => setSetupForm((current) => ({ ...current, host: event.target.value }))}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-semibold text-gray-700">用户名 (User)</label>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                placeholder={t('autoresearch.userPlaceholder')}
                value={setupForm.user}
                onChange={(event) => setSetupForm((current) => ({ ...current, user: event.target.value }))}
              />
            </div>
            <div className="w-24 space-y-1">
              <label className="text-xs font-semibold text-gray-700">端口 (Port)</label>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                placeholder={t('autoresearch.portPlaceholder')}
                type="number"
                value={setupForm.port}
                onChange={(event) =>
                  setSetupForm((current) => ({
                    ...current,
                    port: Number.parseInt(event.target.value, 10) || 22,
                  }))
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">
              {getCurrentLocale() === 'zh-CN' ? '认证方式' : 'Authentication'}
            </label>
            <select
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
              value={setupForm.authMode}
              onChange={(event) =>
                setSetupForm((current) => ({
                  ...current,
                  authMode: event.target.value as SshConfig['authMode'],
                }))
              }
            >
              <option value="agent">{t('autoresearch.authAgent')}</option>
              <option value="password">{t('autoresearch.authPassword')}</option>
              <option value="key">{t('autoresearch.authKey')}</option>
            </select>
            <p className="text-[11px] text-gray-500 font-sans mt-1">
              {t('autoresearch.authHelper')}
            </p>
          </div>
          {setupForm.authMode === 'password' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">密码</label>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                placeholder={t('autoresearch.passwordPlaceholder')}
                type="password"
                autoComplete="off"
                value={setupForm.password || ''}
                onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>
          )}
          {setupForm.authMode === 'key' && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">密钥路径 (Key Path)</label>
              <input
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm transition-colors focus:border-neutral-400 focus:outline-none"
                placeholder={t('autoresearch.sshKeyPathPlaceholder')}
                value={setupForm.keyPath}
                onChange={(event) => setSetupForm((current) => ({ ...current, keyPath: event.target.value }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
