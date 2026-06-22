import React from 'react';
import { t } from '@/i18n';
import { AutoResearchConnectionStatusPanel } from '../../AutoResearchSetupHelpers';
import { parseConnectionCheckOutput } from '../manualFormatting';

interface ConnectionTestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  output: string;
}

interface EnvironmentCheckSectionProps {
  connectionTest: ConnectionTestState;
  testConnectionDisabled: boolean;
  isStarting: boolean;
  handleTestConnection: () => void | Promise<void>;
}

export function EnvironmentCheckSection({
  connectionTest,
  testConnectionDisabled,
  isStarting,
  handleTestConnection,
}: EnvironmentCheckSectionProps) {
  return (
    <div className="space-y-4 font-sans">
      <p className="text-xs text-gray-600 leading-relaxed">
        AutoResearch 需要测试您的环境路径是否可用，以及环境（Linux Target / local node）是否兼容。请点击下方按钮测试。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-xl bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800 disabled:opacity-50 font-sans"
          disabled={testConnectionDisabled || isStarting || connectionTest.status === 'testing'}
          onClick={handleTestConnection}
        >
          {connectionTest.status === 'testing'
            ? (t('autoresearch.connectionTesting') || '测试中...')
            : (t('autoresearch.manual.testEnv') || '测试运行环境')}
        </button>
      </div>

      <div className="mt-2">
        <AutoResearchConnectionStatusPanel
          status={connectionTest.status}
          output={connectionTest.output}
        />
      </div>

      {connectionTest.status === 'success' && (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/30 p-3 space-y-2 text-xs text-emerald-800 font-sans">
          <div className="font-semibold text-emerald-900">环境检测详情</div>
          {(() => {
            const details = parseConnectionCheckOutput(connectionTest.output);
            return (
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <span className="text-emerald-600 font-sans">操作系统 (OS):</span> {details.platform}
                </div>
                <div>
                  <span className="text-emerald-600 font-sans">Git 仓库 (Git Repo):</span> {details.isGitRepo ? '是 (Yes)' : '否 (No)'}
                </div>
                <div className="col-span-2 font-mono">
                  <span className="text-emerald-600 font-sans">当前目录 (pwd):</span> {details.pwd}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
