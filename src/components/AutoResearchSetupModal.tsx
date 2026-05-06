/**
 * AutoResearchSetupModal — Compact SSH + experiment config modal.
 *
 * Triggered when:
 * - User says "研究/research" in chat → skill activates → modal pops up
 * - User clicks "Setup" button from the AutoResearch panel tab
 */

import { useState, useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { useChatStore, useUIStore } from '@/store';
import {
  formatAgentConfigValidationError,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
} from '@/services/agentConfig';
import { startExperimentLoop } from '@/services/autoresearch';
import { createAutoResearchSendMessage } from '@/services/autoresearch/chatAdapter';
import { createAutoResearchRunId } from '@/services/autoresearch/history';
import {
  isHorizontalArrowKey,
  resolveInitialExperimentDir,
  sanitizePathInput,
} from '@/services/autoresearch/pathInput';
import { runAutoResearchPreflight } from '@/services/autoresearch/preflight';
import { formatError } from '@/services/autoresearch/errors';
import { resolveAutoResearchRunConfig } from '@/services/autoresearch/runConfig';

export function AutoResearchSetupModal() {
  const showSetupModal = useAutoResearchStore(s => s.showSetupModal);
  const setShowSetupModal = useAutoResearchStore(s => s.setShowSetupModal);
  const sshConfig = useAutoResearchStore(s => s.sshConfig);
  const storedExperimentDir = useAutoResearchStore(s => s.experimentDir);
  const setSshConfig = useAutoResearchStore(s => s.setSshConfig);
  const initSession = useAutoResearchStore(s => s.initSession);
  const setAgentPanelTab = useUIStore(s => s.setAgentPanelTab);
  const agentConfig = resolveActiveAgentConfig();
  const agentConfigIssues = validateResolvedAgentConfig(agentConfig);
  const agentConfigError = agentConfigIssues.length > 0
    ? formatAgentConfigValidationError(agentConfig, agentConfigIssues)
    : '';

  const modalRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<SshConfig>({
    mode: sshConfig?.mode || 'ssh',
    host: sshConfig?.host || '',
    user: sshConfig?.user || 'root',
    keyPath: sshConfig?.keyPath || '',
    port: sshConfig?.port || 22,
    remoteWorkDir: sshConfig?.remoteWorkDir || '~/autoresearch',
    authMode: sshConfig?.authMode || 'agent',
    password: sshConfig?.password || '',
  });
  const [metric, setMetric] = useState('val_bpb');
  const [direction, setDirection] = useState<'lower' | 'higher'>('lower');
  const [maxIter, setMaxIter] = useState(50);
  const [experimentDir, setExperimentDir] = useState('');

  // Sync form when sshConfig changes (e.g. from previous session)
  useEffect(() => {
    if (sshConfig) {
      setForm({
        ...sshConfig,
        remoteWorkDir: sanitizePathInput(sshConfig.remoteWorkDir),
      });
    }
  }, [sshConfig]);

  useEffect(() => {
    if (!showSetupModal) return;
    const chatState = useChatStore.getState();
    const currentChatSession = chatState.sessions.find((session) => session.id === chatState.currentSessionId);
    setExperimentDir(resolveInitialExperimentDir(storedExperimentDir, currentChatSession?.workDir));
  }, [showSetupModal, storedExperimentDir]);

  // Close on click outside
  useEffect(() => {
    if (!showSetupModal) return;
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowSetupModal(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSetupModal, setShowSetupModal]);

  // Close on Escape
  useEffect(() => {
    if (!showSetupModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSetupModal(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showSetupModal, setShowSetupModal]);

  const handlePathInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isHorizontalArrowKey(event.key)) {
      event.stopPropagation();
    }
  }, []);

  const handleWorkDirChange = useCallback((value: string) => {
    setForm((current) => ({
      ...current,
      remoteWorkDir: sanitizePathInput(value),
    }));
  }, []);

  const handleExperimentDirChange = useCallback((value: string) => {
    setExperimentDir(sanitizePathInput(value));
  }, []);

  const handleStart = useCallback(async () => {
    // Mode-specific validation
    if (form.mode === 'ssh') {
      if (!form.host || !form.user) return;
      if (form.authMode === 'password' && !form.password) return;
      if (form.authMode === 'key' && !form.keyPath) return;
    }

    const sessionId = createAutoResearchRunId();

    let runConfig;
    try {
      runConfig = resolveAutoResearchRunConfig();
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
      return;
    }

    try {
      const preflight = await runAutoResearchPreflight({
        sshConfig: form,
        experimentDir,
        workDir: form.remoteWorkDir,
        sessionId,
        agentConfig: runConfig.agentConfig,
      });

      const sanitizedForm = {
        ...form,
        remoteWorkDir: preflight.resolvedWorkDir,
      };

      setSshConfig(sanitizedForm);

      initSession({
        id: sessionId,
        maxIterations: maxIter,
        metricName: metric,
        metricDirection: direction,
        sshConfig: sanitizedForm,
        experimentDir: preflight.resolvedExperimentDir,
        sessionFilePath: preflight.sessionFilePath,
        livingDocPath: preflight.livingDocPath,
        agentConfigSnapshot: runConfig.snapshot,
      });

      setShowSetupModal(false);
      setAgentPanelTab('autoresearch');

      const sendMessage = createAutoResearchSendMessage(
        preflight.resolvedExperimentDir,
        preflight.agentConfig,
        {
          environmentSummary: preflight.environmentSummary,
          metricName: metric,
          direction,
          maxIterations: maxIter,
        },
      );

      void startExperimentLoop(sendMessage);
    } catch (error) {
      useAutoResearchStore.getState().setError(formatError(error));
    }
  }, [agentConfig, agentConfigError, direction, experimentDir, form, initSession, maxIter, metric, setAgentPanelTab, setShowSetupModal, setSshConfig]);

  if (!showSetupModal) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={modalRef}
        className="w-[420px] bg-white rounded-2xl shadow-2xl border border-gray-200/60 overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-50 rounded-lg">
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">AutoResearch</h3>
              <p className="text-[10px] text-gray-400">Configure experiment loop</p>
            </div>
          </div>
          <button
            onClick={() => setShowSetupModal(false)}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-3">
          {/* Target Section */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Execution Target</label>

            {/* Mode toggle */}
            <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'ssh' }))}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${form.mode === 'ssh' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
              >SSH</button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'local' }))}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${form.mode === 'local' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
              >Local</button>
            </div>

            {form.mode === 'ssh' && (
              <>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                    placeholder="host (e.g. 192.168.1.10 or connect.westd.seetacloud.com)"
                    value={form.host}
                    onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  />
                  <input
                    className="w-16 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                    placeholder="port"
                    type="number"
                    value={form.port}
                    onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                    placeholder="user"
                    value={form.user}
                    onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
                  />
                  <select
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors bg-white"
                    value={form.authMode}
                    onChange={e => setForm(f => ({ ...f, authMode: e.target.value as SshConfig['authMode'] }))}
                  >
                    <option value="agent">Auth: Agent (~/.ssh/config)</option>
                    <option value="password">Auth: Password</option>
                    <option value="key">Auth: Private key</option>
                  </select>
                </div>
                {form.authMode === 'password' && (
                  <>
                    <input
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                      placeholder="password"
                      type="password"
                      autoComplete="off"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    />
                    <p className="text-[10px] text-gray-400 leading-snug">
                      Kept in memory only (not saved to disk). Requires <code className="px-1 py-0.5 bg-gray-100 rounded">sshpass</code>:<br/>
                      <code className="px-1 py-0.5 bg-gray-100 rounded">brew install hudochenkov/sshpass/sshpass</code>
                    </p>
                  </>
                )}
                {form.authMode === 'key' && (
                  <input
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                    placeholder="key path (e.g. ~/.ssh/id_rsa)"
                    value={form.keyPath}
                    onChange={e => setForm(f => ({ ...f, keyPath: e.target.value }))}
                  />
                )}
              </>
            )}

            <input
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
              placeholder={form.mode === 'local' ? 'local work dir (absolute path)' : 'remote work dir'}
              aria-label="AutoResearch workdir"
              value={form.remoteWorkDir}
              onChange={e => handleWorkDirChange(e.target.value)}
              onKeyDown={handlePathInputKeyDown}
            />
          </div>

          {/* Experiment Section */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Experiment</label>
            <input
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors font-mono"
              placeholder="experiment project directory"
              aria-label="Experiment path"
              value={experimentDir}
              onChange={e => handleExperimentDirChange(e.target.value)}
              onKeyDown={handlePathInputKeyDown}
            />
            <p className="text-[10px] text-gray-400 leading-snug">
              Project directory only. Internal <code className="px-1 py-0.5 bg-gray-100 rounded">session.md</code> and living-doc paths are stored separately.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                placeholder="metric name"
                value={metric}
                onChange={e => setMetric(e.target.value)}
              />
              <select
                className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors bg-white"
                value={direction}
                onChange={e => setDirection(e.target.value as 'lower' | 'higher')}
              >
                <option value="lower">↓ Lower</option>
                <option value="higher">↑ Higher</option>
              </select>
              <input
                className="w-16 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                placeholder="max"
                type="number"
                value={maxIter}
                onChange={e => setMaxIter(parseInt(e.target.value) || 50)}
              />
            </div>
          </div>

          {/* Start Button */}
          <button
            className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 transition-all mt-1"
            disabled={
              form.mode === 'ssh'
                ? (!form.host || !form.user
                    || (form.authMode === 'password' && !form.password)
                    || (form.authMode === 'key' && !form.keyPath)
                    || !sanitizePathInput(form.remoteWorkDir, { trim: true })
                    || !sanitizePathInput(experimentDir, { trim: true })
                    || Boolean(agentConfigError))
                : !sanitizePathInput(form.remoteWorkDir, { trim: true }) || !sanitizePathInput(experimentDir, { trim: true }) || Boolean(agentConfigError)
            }
            onClick={handleStart}
          >
            Start Experiment Loop
          </button>
          {agentConfigError && (
            <p className="text-[10px] text-red-500 leading-snug">
              {agentConfigError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default AutoResearchSetupModal;
