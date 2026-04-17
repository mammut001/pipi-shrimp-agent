/**
 * AutoResearchSetupModal — Compact SSH + experiment config modal.
 *
 * Triggered when:
 * - User says "研究/research" in chat → skill activates → modal pops up
 * - User clicks "Setup" button from the AutoResearch panel tab
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { useChatStore, useUIStore } from '@/store';
import { startExperimentLoop } from '@/services/autoresearch';
import { createAutoResearchSendMessage } from '@/services/autoresearch/chatAdapter';

export function AutoResearchSetupModal() {
  const showSetupModal = useAutoResearchStore(s => s.showSetupModal);
  const setShowSetupModal = useAutoResearchStore(s => s.setShowSetupModal);
  const sshConfig = useAutoResearchStore(s => s.sshConfig);
  const setSshConfig = useAutoResearchStore(s => s.setSshConfig);
  const initSession = useAutoResearchStore(s => s.initSession);
  const setAgentPanelTab = useUIStore(s => s.setAgentPanelTab);

  const modalRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<SshConfig>({
    host: sshConfig?.host || '',
    user: sshConfig?.user || 'root',
    keyPath: sshConfig?.keyPath || '~/.ssh/id_rsa',
    port: sshConfig?.port || 22,
    remoteWorkDir: sshConfig?.remoteWorkDir || '~/autoresearch',
  });
  const [metric, setMetric] = useState('val_bpb');
  const [direction, setDirection] = useState<'lower' | 'higher'>('lower');
  const [maxIter, setMaxIter] = useState(50);
  const [sessionFile, setSessionFile] = useState('~/.pipi-shrimp/autoresearch/session.md');

  // Sync form when sshConfig changes (e.g. from previous session)
  useEffect(() => {
    if (sshConfig) {
      setForm(sshConfig);
    }
  }, [sshConfig]);

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

  const handleStart = useCallback(() => {
    if (!form.host) return;

    setSshConfig(form);

    const sessionId = `autoresearch-${Date.now()}`;
    initSession({
      id: sessionId,
      maxIterations: maxIter,
      metricName: metric,
      metricDirection: direction,
      sshConfig: form,
      sessionFilePath: sessionFile,
    });

    setShowSetupModal(false);
    setAgentPanelTab('autoresearch');

    // Resolve current chat session's workDir for tool execution context
    const chatSession = useChatStore.getState().sessions.find(
      s => s.id === useChatStore.getState().currentSessionId
    );
    const sendMessage = createAutoResearchSendMessage(chatSession?.workDir);

    startExperimentLoop(sendMessage);
  }, [form, maxIter, metric, direction, sessionFile, initSession, setSshConfig, setShowSetupModal, setAgentPanelTab]);

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
          {/* SSH Section */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SSH Connection</label>
            <div className="flex gap-2">
              <input
                className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                placeholder="host (e.g. 123.45.67.89)"
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
              <input
                className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
                placeholder="key path"
                value={form.keyPath}
                onChange={e => setForm(f => ({ ...f, keyPath: e.target.value }))}
              />
            </div>
            <input
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors"
              placeholder="remote work dir"
              value={form.remoteWorkDir}
              onChange={e => setForm(f => ({ ...f, remoteWorkDir: e.target.value }))}
            />
          </div>

          {/* Experiment Section */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Experiment</label>
            <input
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-indigo-400 transition-colors font-mono"
              placeholder="session file path (e.g. ~/.pipi-shrimp/autoresearch/session.md)"
              value={sessionFile}
              onChange={e => setSessionFile(e.target.value)}
            />
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
            disabled={!form.host}
            onClick={handleStart}
          >
            Start Experiment Loop
          </button>
        </div>
      </div>
    </div>
  );
}

export default AutoResearchSetupModal;
