/**
 * AgentNode - React Flow node component for workflow agents
 *
 * Features (migrated from LobsterAI):
 * - NodeResizer for resizing
 * - 4-direction connection handles (top/bottom/left/right)
 * - Avatar with name initial + color
 * - Inline double-click to rename
 * - InputFrom dropdown for explicit DAG construction
 * - OutputRoutes inline editing
 * - Status indicator with animation
 */

import React, { memo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import type { WorkflowAgent, RouteCondition } from '@/types/workflow';
import { useSettingsStore } from '@/store/settingsStore';
import { getProviderDefaultModelIds } from '@/shared/providers';
import { t } from '@/i18n';

interface AgentNodeData {
  agent: WorkflowAgent;
  allAgents: WorkflowAgent[];
  onRemove: (id: string) => void;
  onRemoveSkill: (agentId: string, skillId: string) => void;
  onAddSkill: (agentId: string, skill: any) => void;
  onUpdateName: (id: string, name: string) => void;
  onUpdateSize?: (id: string, width: number, height: number) => void;
  onSetInputFrom: (agentId: string, fromId: string | null) => void;
  onAddRoute: (agentId: string, condition: RouteCondition, targetAgentId: string, keyword?: string) => void;
  onRemoveRoute: (agentId: string, routeId: string) => void;
  onUpdateRoute: (agentId: string, routeId: string, updates: { condition?: RouteCondition; keyword?: string; targetAgentId?: string }) => void;
  onUpdateModel: (agentId: string, provider: string, modelId: string) => void;
  onSelect: (id: string) => void;
}

// Agent colors derived from agent ID
const AGENT_COLORS = [
  '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#3B82F6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

function getAgentColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Condition display config
const CONDITION_CONFIG: Record<RouteCondition, { label: string; icon: string }> = {
  onComplete: { label: t('workflow.onComplete'), icon: '✅' },
  onError: { label: t('workflow.onError'), icon: '❌' },
  outputContains: { label: t('workflow.outputContains'), icon: '🔍' },
  always: { label: t('workflow.always'), icon: '🔄' },
};

const AgentNode: React.FC<NodeProps> = memo(({ data, selected }) => {
  const d = data as unknown as AgentNodeData;
  const { agent, allAgents, onRemove, onUpdateName, onAddRoute, onRemoveRoute, onUpdateModel, onSelect } = d;

  // Settings store
  const apiConfigs = useSettingsStore((s) => s.apiConfigs);
  const availableModels = useSettingsStore((s) => s.availableModels);

  // Local state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [newRouteCondition, setNewRouteCondition] = useState<RouteCondition>('onComplete');
  const [newRouteKeyword, setNewRouteKeyword] = useState('');
  const [newRouteTarget, setNewRouteTarget] = useState('');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  // Get configured providers (those that have an apiConfig)
  const configuredProviders = apiConfigs.map((c) => c.provider);

  // Current agent model info
  const currentProvider = agent.model?.provider || '';
  const currentModelId = agent.model?.modelId || '';

  // Get display name for provider
  const getProviderDisplayName = (provider: string) => {
    const config = apiConfigs.find((c) => c.provider === provider);
    return config ? `${config.name} (${provider})` : provider;
  };

  // Group models by provider
  const modelsByProvider = configuredProviders.map((provider) => {
    const fetchedModels = availableModels[provider];
    const models = fetchedModels && fetchedModels.length > 0 
      ? fetchedModels 
      : getProviderDefaultModelIds(provider);
    return [provider, models] as [string, string[]];
  }).filter(([, models]) => models.length > 0);

  const handleSelectModel = (provider: string, modelId: string) => {
    onUpdateModel(agent.id, provider as 'anthropic' | 'openai' | 'minimax' | 'anthropic-compatible' | 'openai-compatible', modelId);
    setShowModelSelector(false);
    setExpandedProvider(null);
  };

  const color = getAgentColor(agent.id);
  const initials = getInitials(agent.name);

  // Get other agents for dropdown
  const otherAgents = allAgents.filter((a) => a.id !== agent.id);

  // Status colors
  const statusBgMap: Record<string, string> = {
    idle: '#9CA3AF',
    running: '#3B82F6',
    completed: '#10B981',
    error: '#EF4444',
  };

  const statusBorderMap: Record<string, string> = {
    idle: '#E5E7EB',
    running: '#3B82F6',
    completed: '#10B981',
    error: '#EF4444',
  };

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameDoubleClick = () => {
    setEditName(agent.name);
    setIsEditingName(true);
  };

  const handleNameSubmit = () => {
    if (editName.trim()) {
      onUpdateName(agent.id, editName.trim());
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNameSubmit();
    if (e.key === 'Escape') setIsEditingName(false);
  };

  const handleAddRoute = () => {
    if (newRouteTarget) {
      onAddRoute(agent.id, newRouteCondition, newRouteTarget, newRouteKeyword || undefined);
      setNewRouteTarget('');
      setNewRouteCondition('onComplete');
      setNewRouteKeyword('');
      setShowAddRoute(false);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(agent.id);
  };

  return (
    <>
      {/* NodeResizer - only visible when selected */}
      <NodeResizer
        minWidth={200}
        minHeight={120}
        isVisible={selected}
        lineClassName="!border-blue-500"
        handleClassName="!w-3 !h-3 !bg-white !border-2 !border-blue-500 !rounded"
      />

      {/* 4-direction handles */}
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !hover:bg-gray-400 cursor-crosshair" />
      <Handle type="source" position={Position.Top} id="top-out" className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !hover:bg-gray-400 cursor-crosshair" />

      <Handle type="target" position={Position.Bottom} className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !hover:bg-gray-400 cursor-crosshair" />
      <Handle type="source" position={Position.Bottom} id="bottom-out" className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !hover:bg-gray-400 cursor-crosshair" />

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !hover:bg-gray-400 cursor-crosshair" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white !hover:bg-gray-400 cursor-crosshair" />

      {/* Node card */}
      <div
        className={`w-full h-full bg-white rounded-xl border-2 shadow-sm transition-all duration-200 flex flex-col ${
          selected ? 'ring-2 ring-blue-500 ring-offset-2' : ''
        } ${agent.status === 'running' ? 'animate-pulse' : ''}`}
        style={{ 
          borderColor: selected ? '#3B82F6' : statusBorderMap[agent.status],
          position: 'relative'
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(agent.id);
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: color }}
              title={agent.name}
            >
              {initials}
            </div>

            {/* Status dot + Name */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: statusBgMap[agent.status] }}
              />
              {isEditingName ? (
                <input
                  ref={inputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleNameSubmit}
                  onKeyDown={handleNameKeyDown}
                  className="flex-1 text-sm font-medium text-gray-900 bg-blue-50 border border-blue-300 rounded px-1 py-0.5 outline-none min-w-0"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="text-sm font-medium text-gray-900 truncate cursor-text"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleNameDoubleClick();
                  }}
                  title={agent.name}
                >
                  {agent.name}
                </span>
              )}
            </div>
          </div>

          {/* Delete button */}
          <button
            onClick={handleDelete}
            className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors shrink-0"
            title={t('workflow.delete')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-3 py-2 space-y-2 overflow-hidden">
          {/* Task label */}
          {agent.task && (
            <p className="text-xs font-medium text-gray-700 truncate" title={agent.task}>
              {agent.task}
            </p>
          )}

          {/* Task prompt preview */}
          {agent.taskPrompt && (
            <div
              className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2"
              title={agent.taskPrompt}
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                Prompt
              </div>
              <p
                className="text-[11px] leading-4 text-gray-600"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: selected ? 5 : 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {agent.taskPrompt}
              </p>
            </div>
          )}

          {/* Mode badge */}
          <div className="flex items-center gap-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              agent.execution.mode === 'single'
                ? 'bg-gray-100 text-gray-500'
                : 'bg-blue-100 text-blue-600'
            }`}>
              {agent.execution.mode === 'single' ? t('workflow.singleExecution') : `${agent.execution.maxRounds || 3}${t('workflow.rounds')}`}
            </span>
          </div>

          {/* Model Selector */}
          <div ref={modelSelectorRef} className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowModelSelector(!showModelSelector);
                  if (!showModelSelector) {
                    // Auto-expand current provider
                    setExpandedProvider(currentProvider || modelsByProvider[0]?.[0] || null);
                  }
                }}
                className="w-full flex items-center gap-1 text-[10px] px-1.5 py-1 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 transition-colors"
              >
                <span className="text-gray-500">Model:</span>
                <span className="text-gray-700 font-medium truncate flex-1 text-left">
                  {currentProvider ? `${currentProvider}/${currentModelId || 'default'}` : t('workflow.usingGlobalConfig')}
                </span>
                <span className="text-gray-400 shrink-0">▼</span>
              </button>

              {/* Dropdown - using portal to escape overflow clipping */}
              {showModelSelector && createPortal(
                <div
                  className="fixed z-[9999] bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                  style={{
                    top: modelSelectorRef.current 
                      ? modelSelectorRef.current.getBoundingClientRect().bottom + 4 
                      : 0,
                    left: modelSelectorRef.current 
                      ? modelSelectorRef.current.getBoundingClientRect().left 
                      : 0,
                    width: modelSelectorRef.current 
                      ? modelSelectorRef.current.offsetWidth 
                      : 200,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {modelsByProvider.length === 0 ? (
                    <div className="px-3 py-2 text-[10px] text-gray-500 text-center">
                      {configuredProviders.length === 0 
                        ? t('workflow.addApiConfigFirst') 
                        : t('workflow.getModelListFirst')}
                    </div>
                  ) : modelsByProvider.map(([provider, models]) => (
                    <div key={provider}>
                      {/* Provider header */}
                      <button
                        onClick={() => setExpandedProvider(expandedProvider === provider ? null : provider)}
                        className="w-full flex items-center gap-1 px-2 py-1 text-[10px] hover:bg-gray-50 text-left"
                      >
                        <span className="text-gray-400">{expandedProvider === provider ? '▼' : '▶'}</span>
                        <span className="font-medium text-gray-700">{getProviderDisplayName(provider)}</span>
                        <span className="text-gray-400">(+{models.length} models)</span>
                      </button>

                      {/* Models list */}
                      {expandedProvider === provider && (
                        <div className="bg-gray-50">
                          {models.map((model) => (
                            <button
                              key={model}
                              onClick={() => handleSelectModel(provider, model)}
                              className={`w-full flex items-center gap-1 px-4 py-0.5 text-[10px] hover:bg-gray-100 text-left ${
                                currentProvider === provider && currentModelId === model ? 'bg-blue-50 text-blue-600' : 'text-gray-600'
                              }`}
                            >
                              <span className="w-3">{currentProvider === provider && currentModelId === model ? '✓' : ''}</span>
                              <span className="font-mono">{model}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>,
                document.body
              )}
            </div>

          {/* Output Routes */}
          {agent.outputRoutes.length > 0 && (
            <div className="space-y-0.5">
              {agent.outputRoutes.map((route) => {
                const target = allAgents.find((a) => a.id === route.targetAgentId);
                const cfg = CONDITION_CONFIG[route.condition];
                return (
                  <div key={route.id} className="flex items-center gap-1 text-[10px]">
                    <span className="shrink-0">{cfg.icon}</span>
                    <span className="text-gray-500 truncate max-w-[60px]">{cfg.label}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-gray-700 truncate font-medium">{target?.name || '?'}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveRoute(agent.id, route.id);
                      }}
                      className="ml-auto text-gray-400 hover:text-red-500 shrink-0"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add route button */}
          {selected && otherAgents.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAddRoute(!showAddRoute);
              }}
              className="text-[10px] text-blue-500 hover:text-blue-700 mt-0.5"
            >
              {showAddRoute ? t('workflow.cancelAdd') : `+ ${t('workflow.addRoute')}`}
            </button>
          )}

          {/* Add route form */}
          {showAddRoute && otherAgents.length > 0 && (
            <div className="space-y-1 bg-gray-50 rounded p-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
              <select
                value={newRouteCondition}
                onChange={(e) => setNewRouteCondition(e.target.value as RouteCondition)}
                className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5"
              >
                <option value="onComplete">{t('workflow.onComplete')}</option>
                <option value="onError">{t('workflow.onError')}</option>
                <option value="outputContains">{t('workflow.outputContains')}</option>
                <option value="always">{t('workflow.always')}</option>
              </select>
              {newRouteCondition === 'outputContains' && (
                <input
                  value={newRouteKeyword}
                  onChange={(e) => setNewRouteKeyword(e.target.value)}
                  placeholder={t('workflow.keywordPlaceholder')}
                  className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5"
                />
              )}
              <select
                value={newRouteTarget}
                onChange={(e) => setNewRouteTarget(e.target.value)}
                className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5"
              >
                <option value="">{t('workflow.selectTargetAgent')}</option>
                {otherAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <button
                onClick={handleAddRoute}
                disabled={!newRouteTarget}
                className="w-full text-[10px] bg-blue-500 text-white rounded px-1 py-0.5 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {t('workflow.confirm')}
              </button>
            </div>
          )}
        </div>

        {/* InputFrom indicator */}
        {agent.inputFrom && (
          <div className="px-3 py-1 bg-gray-50 border-t border-gray-100">
            <div className="flex items-center gap-1 text-[10px] text-gray-400">
              <span>{t('workflow.target')}:</span>
              <span className="font-medium text-gray-600">
                {allAgents.find((a) => a.id === agent.inputFrom)?.name || '?'}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
});

AgentNode.displayName = 'AgentNode';

export { AgentNode };
export default AgentNode;
