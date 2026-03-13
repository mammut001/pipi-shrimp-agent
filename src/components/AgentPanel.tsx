/**
 * AgentPanel - Right panel for displaying agent instructions and task progress
 */

import React, { useState } from 'react';
import { useUIStore } from '@/store';

/**
 * AgentPanel component
 */
export const AgentPanel: React.FC = () => {
  const { 
    agentInstructions, 
    setAgentInstructions,
    taskProgress,
    permissionMode,
    setPermissionMode,
    addNotification
  } = useUIStore();

  const [showBypassConfirm, setShowBypassConfirm] = useState(false);
  const [localInstructions, setLocalInstructions] = useState(agentInstructions);
  const [isSaving, setIsSaving] = useState(false);

  // Update local instructions when global state changes (e.g. from store initialization)
  React.useEffect(() => {
    setLocalInstructions(agentInstructions);
  }, [agentInstructions]);

  const handleModeChange = (mode: string) => {
    if (mode === 'bypass' && permissionMode !== 'bypass') {
      setShowBypassConfirm(true);
    } else {
      setPermissionMode(mode as any);
      setShowBypassConfirm(false);
    }
  };

  const confirmBypass = () => {
    setPermissionMode('bypass');
    setShowBypassConfirm(false);
  };

  const handleSaveSoul = async () => {
    if (isSaving) return;
    
    setIsSaving(true);
    try {
      // Simulate saving delay for animation
      await new Promise(resolve => setTimeout(resolve, 800));
      setAgentInstructions(localInstructions);
      addNotification('success', 'Agent Soul saved successfully');
    } catch (error) {
      addNotification('error', 'Failed to save Agent Soul');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-gray-800 border-l border-gray-100 shadow-sm transition-all duration-300">
      {/* 
        Agent Control Section - Compact Tab Style with Enhanced Indicators 
      */}
      <div className="p-3 border-b border-gray-100 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Permission Mode
            </h2>
            {/* Status Dot based on current mode */}
            <div className={`rounded-full transition-all duration-300 ${
              permissionMode === 'bypass' ? 'h-3 w-3 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse' :
              permissionMode === 'standard' ? 'h-2 w-2 bg-blue-500' :
              permissionMode === 'auto-edits' ? 'h-2 w-2 bg-indigo-500' :
              permissionMode === 'plan-only' ? 'h-2 w-2 bg-green-500' : 'h-2 w-2 bg-gray-300'
            }`} />
          </div>
        </div>
        
        {/* Tab-style Selector */}
        <div className="flex p-0.5 bg-gray-100 rounded-lg">
          {[
            { id: 'standard', label: 'Ask', dotColor: 'bg-blue-500' },
            { id: 'auto-edits', label: 'Auto', dotColor: 'bg-indigo-500' },
            { id: 'bypass', label: 'Bypass', dotColor: 'bg-red-500' },
            { id: 'plan-only', label: 'Plan', dotColor: 'bg-green-500' },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              className={`flex-1 px-1 py-1 text-[10px] font-bold rounded-md transition-all duration-200 uppercase tracking-tighter flex items-center justify-center gap-1.5 ${
                permissionMode === mode.id
                  ? `bg-white shadow-sm border border-gray-200 text-gray-900 scale-[1.02] z-10`
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${mode.dotColor} ${permissionMode === mode.id ? 'opacity-100' : 'opacity-40'}`} />
              {mode.label}
            </button>
          ))}
        </div>

        {/* Bypass Confirmation Mini-Panel */}
        {showBypassConfirm && (
          <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded-md animate-in fade-in slide-in-from-top-1 duration-200">
            <p className="text-[10px] text-red-700 font-medium mb-2 leading-tight">
              ⚠️ Warning: Bypass mode allows AI to execute commands without approval. Proceed?
            </p>
            <div className="flex gap-2">
              <button 
                onClick={confirmBypass}
                className="flex-1 px-2 py-1 bg-red-600 text-white text-[9px] font-bold rounded hover:bg-red-700 uppercase"
              >
                Confirm
              </button>
              <button 
                onClick={() => setShowBypassConfirm(false)}
                className="flex-1 px-2 py-1 bg-white text-gray-600 text-[9px] font-bold rounded border border-gray-200 hover:bg-gray-50 uppercase"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Agent Soul / Instructions - Editable area */}
      <div className="p-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-7.535 5.535a1 1 0 001.415 0 3 3 0 014.242 0 1 1 0 001.415-1.415 5 5 0 00-7.072 0 1 1 0 000 1.415z" clipRule="evenodd" />
            </svg>
            Agent Soul
          </h3>
          {localInstructions !== agentInstructions && (
            <button
              onClick={handleSaveSoul}
              disabled={isSaving}
              className={`text-[9px] font-bold uppercase tracking-tighter px-2 py-0.5 rounded transition-all duration-200 flex items-center gap-1 ${
                isSaving 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-95'
              }`}
            >
              {isSaving ? (
                <>
                  <div className="h-2 w-2 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 10-1.414-1.414L11 11.586V4.5a1 1 0 00-2 0v7.086l-1.293-1.293z" />
                    <path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
                  </svg>
                  Save
                </>
              )}
            </button>
          )}
        </div>
        <textarea
          value={localInstructions}
          onChange={(e) => setLocalInstructions(e.target.value)}
          placeholder="Enter agent instructions..."
          className="w-full max-h-32 min-h-[60px] overflow-y-auto text-[11px] text-gray-600 leading-normal italic bg-gray-50 p-2.5 rounded-lg border border-gray-50 focus:border-blue-200 focus:bg-white focus:outline-none transition-all resize-none scrollbar-hide hover:scrollbar-default"
        />
      </div>

      {/* Task Progress - Flexible growth */}
      <div className="flex-1 flex flex-col p-3 overflow-hidden">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812 3.066 3.066 0 00.723 1.745 3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Progress
        </h3>
        
        <div className="flex-1 overflow-y-auto space-y-2 relative pr-1 scrollbar-thin scrollbar-thumb-gray-200">
          {taskProgress.length > 0 ? (
            <>
              {/* Vertical line connecting steps */}
              <div className="absolute left-2.5 top-2 bottom-2 w-[1px] bg-gray-100 -z-0"></div>
              
              {taskProgress.map((step, idx) => (
                <div key={step.id} className="flex gap-3 items-start relative z-10 group">
                  <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors shadow-sm ${
                    step.status === 'done' ? 'bg-green-500 text-white' :
                    step.status === 'running' ? 'bg-blue-500 text-white animate-pulse' :
                    step.status === 'failed' ? 'bg-red-500 text-white' :
                    'bg-white text-gray-300 border border-gray-100'
                  }`}>
                    {step.status === 'done' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <span className="text-[8px] font-bold">{idx + 1}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] leading-tight ${
                      step.status === 'running' ? 'text-gray-900 font-bold' : 'text-gray-500'
                    }`}>
                      {step.label}
                    </p>
                    {step.status === 'running' && (
                      <span className="text-[8px] text-blue-500 font-bold uppercase tracking-tighter">Thinking...</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full opacity-30 select-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[9px] uppercase tracking-widest font-bold">Idle State</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
