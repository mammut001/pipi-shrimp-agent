import React, { useState, useEffect, useCallback } from 'react';
import { t, getCurrentLocale } from '@/i18n';
import { useSettingsStore } from '@/store';
import type { SshConfig } from '@/store/autoresearchStore';
import { open } from '@tauri-apps/plugin-dialog';
import type { Recipe } from './bootstrapRecipePrompt';
import { buildBootstrapPromptFromRecipe } from './bootstrapRecipePrompt';
import { BlockComposer } from '@/components/chatInput/BlockComposer';
import { type ComposerBlock } from '@/components/chatInput/blocks/types';

export function formatTaskTypeLabel(taskType: string, locale: string): string {
  if (locale === 'zh-CN') {
    switch (taskType) {
      case 'reproduce_paper': return '复现论文';
      case 'beat_baseline': return '超越基线';
      case 'ablation': return '消融实验';
      case 'from_scratch': return '从零开始';
      default: return taskType;
    }
  } else {
    switch (taskType) {
      case 'reproduce_paper': return 'Reproduce paper';
      case 'beat_baseline': return 'Beat baseline';
      case 'ablation': return 'Ablation';
      case 'from_scratch': return 'From scratch';
      default: return taskType;
    }
  }
}

interface BootstrapRecipeBuilderProps {
  recipe: Recipe;
  onChange: (recipe: Recipe) => void;
  onSend: (compiledPrompt: string) => void;
  sshConfig?: SshConfig;
  disabled?: boolean;
}

export function BootstrapRecipeBuilder({
  recipe,
  onChange,
  onSend,
  sshConfig,
  disabled = false,
}: BootstrapRecipeBuilderProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [newCommand, setNewCommand] = useState('');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  
  // Optional Advanced Section
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [composerBlocks, setComposerBlocks] = useState<ComposerBlock[]>([
    {
      id: 'b-advanced-intent',
      type: 'intent',
      intentType: 'autoresearch',
      detail: recipe.researchGoal.goalText,
    },
  ]);

  const importedFiles = useSettingsStore((state) => state.importedFiles);
  const addImportedFiles = useSettingsStore((state) => state.addImportedFiles);
  const removeImportedFile = useSettingsStore((state) => state.removeImportedFile);

  const handleAddFilesLocal = useCallback(async () => {
    try {
      const selection = await open({
        directory: false,
        multiple: true,
        title: t('autoresearch.recipe.selectFiles') || 'Select Literature or Code Reference Files',
        filters: [
          {
            name: 'Supported Documents',
            extensions: ['pdf', 'py', 'ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'txt', 'md', 'json', 'yaml', 'yml'],
          },
        ],
      });

      if (!selection) return;

      const paths = Array.isArray(selection) ? selection : [selection];
      const newFiles = paths.map((p) => ({
        name: p.split(/[\\/]/).pop() || p,
        path: p,
      }));

      addImportedFiles(newFiles);
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  }, [addImportedFiles]);

  // Sync workspace dir if it is empty and sshConfig is loaded
  useEffect(() => {
    if (!recipe.workspace.workDir) {
      const defaultDir = sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir || '' : '';
      if (defaultDir) {
        onChange({
          ...recipe,
          workspace: {
            ...recipe.workspace,
            workDir: defaultDir,
          },
        });
      }
    }
  }, [sshConfig, recipe, onChange]);

  const handleGoalChange = (val: Partial<Recipe['researchGoal']>) => {
    onChange({
      ...recipe,
      researchGoal: { ...recipe.researchGoal, ...val, source: 'user' },
    });
  };

  const handleMetricChange = (val: Partial<Recipe['baselineAndMetric']>) => {
    onChange({
      ...recipe,
      baselineAndMetric: { ...recipe.baselineAndMetric, ...val },
    });
  };

  const handleWorkspaceChange = (val: Partial<Recipe['workspace']>) => {
    onChange({
      ...recipe,
      workspace: { ...recipe.workspace, ...val },
    });
  };

  const handleAddCommand = () => {
    const trimmed = newCommand.trim();
    if (trimmed && !recipe.verification.commands.includes(trimmed)) {
      onChange({
        ...recipe,
        verification: {
          ...recipe.verification,
          commands: [...recipe.verification.commands, trimmed],
        },
      });
      setNewCommand('');
    }
  };

  const handleRemoveCommand = (cmd: string) => {
    onChange({
      ...recipe,
      verification: {
        ...recipe.verification,
        commands: recipe.verification.commands.filter((c) => c !== cmd),
      },
    });
  };

  const handleOutputContractChange = (field: keyof Recipe['outputContract'], checked: boolean) => {
    onChange({
      ...recipe,
      outputContract: {
        ...recipe.outputContract,
        [field]: checked,
      },
    });
  };

  const compiledPrompt = buildBootstrapPromptFromRecipe(recipe, {
    projectFolder: sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir : undefined,
    contextFiles: importedFiles.map((file) => file.path),
  });

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(compiledPrompt);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleSubmit = () => {
    if (showAdvanced) {
      const { buildPromptFromBlocks } = require('@/components/chatInput/blocks/promptBuilder');
      const compiled = buildPromptFromBlocks(composerBlocks, {
        projectFolder: sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir : undefined,
        contextFiles: importedFiles.map((file) => file.path),
      });
      onSend(compiled);
    } else {
      onSend(compiledPrompt);
    }
  };

  const PLACEHOLDER_GOALS = [
    'I want to start an AutoResearch task. Please guide me through setting up goals, papers, baselines, and workspace scaffolding.',
    'I want to fully reproduce a paper. Please help me identify the paper claims, lock baselines, target primary metric, and construct scaffold files.',
    'I want to exceed an existing baseline on a known task. Please propose improvements, keep evaluations fair, and setup experiment workspace.',
    'I want to conduct ablation studies on an existing model or method. Please help me isolate ablation parameters, verify metrics, and bootstrap scaffolding.',
    'I want to start a brand new AutoResearch project from scratch. Please propose a concrete research objective and scaffold the project workspace.'
  ];

  const isGoalPlaceholder =
    (!recipe.researchGoal.source || recipe.researchGoal.source === 'template') &&
    PLACEHOLDER_GOALS.some(p => p.trim() === recipe.researchGoal.goalText.trim());

  // Section status checking helper
  const getSectionStatus = (section: string) => {
    switch (section) {
      case 'goal':
        if (recipe.researchGoal.goalText.trim().length === 0) return 'missing';
        if (isGoalPlaceholder) return 'placeholder';
        return 'completed';
      case 'references':
        return 'optional';
      case 'baseline':
        return recipe.baselineAndMetric.primaryMetric.trim().length > 0 ? 'completed' : 'missing';
      case 'workspace':
        return recipe.workspace.workDir.trim().length > 0 ? 'completed' : 'missing';
      case 'verification':
        return 'optional';
      case 'output':
        return 'optional';
      default:
        return 'completed';
    }
  };

  const isFormValid =
    getSectionStatus('goal') === 'completed' &&
    getSectionStatus('baseline') === 'completed' &&
    getSectionStatus('workspace') === 'completed';

  const requiredList = [
    { key: 'goal', completed: getSectionStatus('goal') === 'completed' },
    { key: 'baseline', completed: getSectionStatus('baseline') === 'completed' },
    { key: 'workspace', completed: getSectionStatus('workspace') === 'completed' },
  ];
  const requiredCount = requiredList.filter(item => item.completed).length;

  const totalList = [
    { key: 'goal', completed: getSectionStatus('goal') === 'completed' },
    { key: 'references', completed: true },
    { key: 'baseline', completed: getSectionStatus('baseline') === 'completed' },
    { key: 'workspace', completed: getSectionStatus('workspace') === 'completed' },
    { key: 'verification', completed: true },
    { key: 'output', completed: true },
  ];
  const totalCount = totalList.filter(item => item.completed).length;

  const missingFields: string[] = [];
  if (getSectionStatus('goal') === 'missing') {
    missingFields.push(t('autoresearch.recipe.missingGoal') || '缺少研究目标');
  } else if (getSectionStatus('goal') === 'placeholder') {
    missingFields.push(t('autoresearch.recipe.toConfirm') || '待确认研究目标');
  }
  if (getSectionStatus('baseline') === 'missing') {
    missingFields.push(t('autoresearch.recipe.missingMetric') || '缺少主指标');
  }
  if (getSectionStatus('workspace') === 'missing') {
    missingFields.push(t('autoresearch.recipe.missingWorkspace') || '缺少工作区');
  }

  let firstMissingAction: { label: string; section: string } | null = null;
  if (getSectionStatus('goal') !== 'completed') {
    firstMissingAction = {
      label: getSectionStatus('goal') === 'placeholder' ? (t('autoresearch.recipe.toConfirm') || '待确认研究目标') : (t('autoresearch.recipe.action.fillGoal') || '先填写研究目标'),
      section: 'goal'
    };
  } else if (getSectionStatus('baseline') !== 'completed') {
    firstMissingAction = {
      label: t('autoresearch.recipe.action.fillMetric') || '先填写主指标',
      section: 'baseline'
    };
  } else if (getSectionStatus('workspace') !== 'completed') {
    firstMissingAction = {
      label: t('autoresearch.recipe.action.selectWorkspace') || '先选择工作区',
      section: 'workspace'
    };
  }

  const locale = getCurrentLocale();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
      {/* Left Column: Recipe Sections */}
      <div className="space-y-3 max-w-[880px] w-full">
        {/* Section 1: Research Goal */}
        <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
          activeSection === 'goal' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">1</span>
              <span className="text-base">🎯</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 font-sans">
                  {t('autoresearch.recipe.researchGoal') || '研究目标'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                getSectionStatus('goal') === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : getSectionStatus('goal') === 'placeholder'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'bg-amber-50 text-amber-700 border border-amber-100'
              }`}>
                {getSectionStatus('goal') === 'completed'
                  ? (t('autoresearch.recipe.completed') || '已完成')
                  : getSectionStatus('goal') === 'placeholder'
                  ? (t('autoresearch.recipe.templateDefault') || '模板默认值')
                  : (t('autoresearch.recipe.missing') || '缺失')}
              </span>
              <button
                type="button"
                onClick={() => setActiveSection(activeSection === 'goal' ? null : 'goal')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200"
              >
                {activeSection === 'goal'
                  ? (t('autoresearch.recipe.collapse') || '收起')
                  : (t('autoresearch.recipe.edit') || '编辑')}
              </button>
            </div>
          </div>

          {activeSection === 'goal' && (
            <div className="p-4 space-y-4 animate-fadeIn">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">{t('autoresearch.recipe.taskType') || '任务类型'}</label>
                <select
                  value={recipe.researchGoal.taskType}
                  onChange={(e) => handleGoalChange({ taskType: e.target.value as any })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="reproduce_paper">{t('autoresearch.recipe.taskType.reproduce') || 'Reproduce Paper'}</option>
                  <option value="beat_baseline">{t('autoresearch.recipe.taskType.baseline') || 'Beat Baseline'}</option>
                  <option value="ablation">{t('autoresearch.recipe.taskType.ablation') || 'Ablation Studies'}</option>
                  <option value="from_scratch">{t('autoresearch.recipe.taskType.scratch') || 'From Scratch'}</option>
                </select>
                <p className="text-[10px] text-gray-400 leading-normal">
                  {recipe.researchGoal.taskType === 'reproduce_paper' && (t('autoresearch.recipe.taskType.reproduceDesc') || 'Guide the agent to duplicate paper claimed metrics.')}
                  {recipe.researchGoal.taskType === 'beat_baseline' && (t('autoresearch.recipe.taskType.baselineDesc') || 'Instruct the agent to search for methods to beat target scores.')}
                  {recipe.researchGoal.taskType === 'ablation' && (t('autoresearch.recipe.taskType.ablationDesc') || 'Isolate specific features/parameters to observe degradation.')}
                  {recipe.researchGoal.taskType === 'from_scratch' && (t('autoresearch.recipe.taskType.scratchDesc') || 'Start an exploratory greenfield implementation.')}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.goalLabel') || '目标描述'}</label>
                <textarea
                  value={recipe.researchGoal.goalText}
                  onChange={(e) => handleGoalChange({ goalText: e.target.value })}
                  placeholder={t('autoresearch.recipe.goalPlaceholder') || 'Summarize the core target and scope of the experiment...'}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 p-2.5 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none font-sans"
                />
              </div>
            </div>
          )}

          {activeSection !== 'goal' && (
            <div className="px-4 py-2.5 text-xs text-gray-600 bg-white font-sans flex items-center justify-between">
              <span className="truncate pr-4">
                <span className="font-semibold text-gray-700">{formatTaskTypeLabel(recipe.researchGoal.taskType, locale)}:</span>{' '}
                {isGoalPlaceholder ? (t('autoresearch.recipe.toConfirm') || '待确认') : (recipe.researchGoal.goalText || 'No goal set yet')}
              </span>
            </div>
          )}
        </div>

        {/* Section 2: References */}
        <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
          activeSection === 'references' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">2</span>
              <span className="text-base">📚</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 font-sans">
                  {t('autoresearch.recipe.references') || '参考资料'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-100">
                {t('autoresearch.recipe.optional') || '可选'}
              </span>
              <button
                type="button"
                onClick={() => setActiveSection(activeSection === 'references' ? null : 'references')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200"
              >
                {activeSection === 'references'
                  ? (t('autoresearch.recipe.collapse') || '收起')
                  : (t('autoresearch.recipe.edit') || '编辑')}
              </button>
            </div>
          </div>

          {activeSection === 'references' && (
            <div className="p-4 space-y-4 animate-fadeIn">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleAddFilesLocal}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold border border-gray-200 hover:border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-all active:scale-[0.98]"
                >
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t('autoresearch.recipe.selectFiles') || 'Select and Add Files'}
                </button>
              </div>

              {importedFiles.length > 0 ? (
                <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
                  {importedFiles.map((file) => (
                    <div key={file.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors group">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm shrink-0">
                          {file.name.endsWith('.pdf') ? '📕' : '📄'}
                        </span>
                        <span className="text-xs font-medium text-gray-700 truncate" title={file.path}>
                          {file.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeImportedFile(file.id)}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Remove"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic text-center py-4 bg-gray-50 rounded-xl">
                  {t('autoresearch.recipe.noFiles') || 'No reference files attached yet.'}
                </p>
              )}
            </div>
          )}

          {activeSection !== 'references' && (
            <div className="px-4 py-2.5 text-xs text-gray-600 bg-white">
              <p className="truncate">
                {importedFiles.length === 0
                  ? (t('autoresearch.recipe.noFiles') || '暂未添加参考文件。')
                  : `${t('autoresearch.recipe.references')}: ${importedFiles.map((f) => f.name).join(', ')}`}
              </p>
            </div>
          )}
        </div>

        {/* Section 3: Baseline & Metric */}
        <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
          activeSection === 'baseline' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">3</span>
              <span className="text-base">📊</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 font-sans">
                  {t('autoresearch.recipe.baselineAndMetric') || '基线与指标'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                getSectionStatus('baseline') === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-amber-50 text-amber-700 border border-amber-100'
              }`}>
                {getSectionStatus('baseline') === 'completed'
                  ? (t('autoresearch.recipe.completed') || '已完成')
                  : (t('autoresearch.recipe.missing') || '缺失')}
              </span>
              <button
                type="button"
                onClick={() => setActiveSection(activeSection === 'baseline' ? null : 'baseline')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200"
              >
                {activeSection === 'baseline'
                  ? (t('autoresearch.recipe.collapse') || '收起')
                  : (t('autoresearch.recipe.edit') || '编辑')}
              </button>
            </div>
          </div>

          {activeSection === 'baseline' && (
            <div className="p-4 space-y-4 animate-fadeIn">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.metricName') || 'Primary Metric Name'}</label>
                  <input
                    type="text"
                    value={recipe.baselineAndMetric.primaryMetric}
                    onChange={(e) => handleMetricChange({ primaryMetric: e.target.value })}
                    placeholder={t('autoresearch.recipe.metricPlaceholder') || 'e.g. accuracy, loss, f1'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.direction') || 'Optimization Direction'}</label>
                  <select
                    value={recipe.baselineAndMetric.direction}
                    onChange={(e) => handleMetricChange({ direction: e.target.value as any })}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="higher">{t('autoresearch.recipe.direction.higher') || 'Higher is Better (e.g. Accuracy)'}</option>
                    <option value="lower">{t('autoresearch.recipe.direction.lower') || 'Lower is Better (e.g. Loss/Latency)'}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.baselineValue') || 'Baseline Value (Optional)'}</label>
                  <input
                    type="text"
                    value={recipe.baselineAndMetric.baselineValue || ''}
                    onChange={(e) => handleMetricChange({ baselineValue: e.target.value })}
                    placeholder={t('autoresearch.recipe.baselinePlaceholder') || 'e.g. 0.85'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.successCriteria') || 'Success Criteria (Optional)'}</label>
                  <input
                    type="text"
                    value={recipe.baselineAndMetric.successCriteria || ''}
                    onChange={(e) => handleMetricChange({ successCriteria: e.target.value })}
                    placeholder={t('autoresearch.recipe.successPlaceholder') || 'e.g. Beating paper baseline of 0.88'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection !== 'baseline' && (
            <div className="px-4 py-2.5 text-xs text-gray-600 bg-white">
              <p className="truncate">
                {recipe.baselineAndMetric.primaryMetric
                  ? `${recipe.baselineAndMetric.primaryMetric} · ${
                      recipe.baselineAndMetric.direction === 'higher'
                        ? (t('autoresearch.recipe.direction.higher') || '最大化')
                        : (t('autoresearch.recipe.direction.lower') || '最小化')
                    }${recipe.baselineAndMetric.baselineValue ? ` · baseline ${recipe.baselineAndMetric.baselineValue}` : ''}`
                  : (t('autoresearch.recipe.notConfigured') || 'Not configured')}
              </p>
            </div>
          )}
        </div>

        {/* Section 4: Workspace */}
        <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
          activeSection === 'workspace' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">4</span>
              <span className="text-base">📁</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 font-sans">
                  {t('autoresearch.recipe.workspace') || '工作区'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                getSectionStatus('workspace') === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-amber-50 text-amber-700 border border-amber-100'
              }`}>
                {getSectionStatus('workspace') === 'completed'
                  ? (t('autoresearch.recipe.completed') || '已完成')
                  : (t('autoresearch.recipe.missing') || '缺失')}
              </span>
              <button
                type="button"
                onClick={() => setActiveSection(activeSection === 'workspace' ? null : 'workspace')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200"
              >
                {activeSection === 'workspace'
                  ? (t('autoresearch.recipe.collapse') || '收起')
                  : (t('autoresearch.recipe.edit') || '编辑')}
              </button>
            </div>
          </div>

          {activeSection === 'workspace' && (
            <div className="p-4 space-y-4 animate-fadeIn">
              <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                  {t('autoresearch.recipe.targetProfileMode') || 'Target Profile Mode'}
                </span>
                <span className="text-xs font-semibold text-gray-700 flex items-center gap-1 font-sans">
                  <span>{sshConfig?.mode === 'ssh' ? `🌐 ${t('autoresearch.recipe.remoteMode') || 'SSH Remote Connection'}` : `💻 ${t('autoresearch.recipe.localMode') || 'Local Project Directory'}`}</span>
                </span>
                {sshConfig?.mode === 'ssh' && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    {t('autoresearch.recipe.hostUser', { host: sshConfig.host, port: sshConfig.port, user: sshConfig.user }) || `Host: ${sshConfig.host}:${sshConfig.port} (User: ${sshConfig.user})`}
                  </p>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.rootDir') || 'Root Directory Path'}</label>
                  <input
                    type="text"
                    value={recipe.workspace.workDir}
                    onChange={(e) => handleWorkspaceChange({ workDir: e.target.value })}
                    placeholder={t('autoresearch.recipe.rootDirPlaceholder') || '/path/to/workdir'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  {recipe.workspace.workDir.trim().length === 0 && (
                    <span className="text-[10px] text-red-500 font-medium">{t('autoresearch.recipe.rootDirEmpty') || '⚠️ Target directory path cannot be empty'}</span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700 font-sans">{t('autoresearch.recipe.scaffoldFolderLabel') || 'Scaffold Folder Name'}</label>
                  <input
                    type="text"
                    value={recipe.workspace.folderName}
                    onChange={(e) => handleWorkspaceChange({ folderName: e.target.value })}
                    placeholder={t('autoresearch.recipe.scaffoldPlaceholder') || 'e.g. experiment-run'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  {recipe.workspace.folderName.trim().length === 0 && (
                    <span className="text-[10px] text-red-500 font-medium">{t('autoresearch.recipe.folderNameEmpty') || '⚠️ Folder name is required'}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection !== 'workspace' && (
            <div className="px-4 py-2.5 text-xs text-gray-600 bg-white font-sans flex items-center justify-between">
              <span className="truncate pr-4 text-gray-600">
                <span className="font-semibold text-gray-700">{t('autoresearch.recipe.workspaceRootSummary') || '工作区根目录'}: </span>
                {recipe.workspace.workDir ? recipe.workspace.workDir : (t('autoresearch.recipe.workspaceRootMissing') || '未选择')}
                <span className="mx-2 text-gray-300">|</span>
                <span className="font-semibold text-gray-700">{t('autoresearch.recipe.scaffoldFolder') || '脚手架目录'}: </span>
                {recipe.workspace.folderName}
              </span>
            </div>
          )}
        </div>

        {/* Section 5: Verification */}
        <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
          activeSection === 'verification' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">5</span>
              <span className="text-base">✅</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 font-sans">
                  {t('autoresearch.recipe.verification') || '验证命令'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-100">
                {t('autoresearch.recipe.optional') || '可选'}
              </span>
              <button
                type="button"
                onClick={() => setActiveSection(activeSection === 'verification' ? null : 'verification')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200"
              >
                {activeSection === 'verification'
                  ? (t('autoresearch.recipe.collapse') || '收起')
                  : (t('autoresearch.recipe.edit') || '编辑')}
              </button>
            </div>
          </div>

          {activeSection === 'verification' && (
            <div className="p-4 space-y-4 animate-fadeIn">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCommand();
                    }
                  }}
                  placeholder={t('autoresearch.recipe.addCommandPlaceholder') || 'e.g. pytest tests/test_model.py'}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  type="button"
                  onClick={handleAddCommand}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-xs font-bold transition-all shadow-sm"
                >
                  {t('autoresearch.recipe.addButton') || 'Add'}
                </button>
              </div>

              {recipe.verification.commands.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {recipe.verification.commands.map((cmd) => (
                    <div key={cmd} className="flex justify-between items-center bg-gray-50 border border-gray-100 rounded-lg p-2 text-xs font-mono">
                      <span className="truncate flex-1 pr-2 text-gray-700">{cmd}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommand(cmd)}
                        className="text-gray-400 hover:text-red-500 font-bold px-1"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic text-center py-4 bg-gray-50 rounded-xl">
                  {t('autoresearch.recipe.noCommands') || 'No verification commands specified. The agent will discover test files automatically.'}
                </p>
              )}
            </div>
          )}

          {activeSection !== 'verification' && (
            <div className="px-4 py-2.5 text-xs text-gray-600 bg-white">
              <p className="truncate">
                {recipe.verification.commands.length === 0
                  ? `0 ${t('autoresearch.recipe.verification') || '个验证命令'}`
                  : `${recipe.verification.commands.length} ${t('autoresearch.recipe.verification') || '个验证命令'}`}
              </p>
            </div>
          )}
        </div>

        {/* Section 6: Output Contract */}
        <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
          activeSection === 'output' ? 'border-slate-300 ring-2 ring-slate-100' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between p-4 bg-gray-50/50 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200/50 rounded-md w-5 h-5 flex items-center justify-center">6</span>
              <span className="text-base">📄</span>
              <div>
                <h4 className="text-sm font-semibold text-gray-900 font-sans">
                  {t('autoresearch.recipe.outputContract') || '输出要求'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-100">
                {t('autoresearch.recipe.optional') || '可选'}
              </span>
              <button
                type="button"
                onClick={() => setActiveSection(activeSection === 'output' ? null : 'output')}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-1 rounded bg-white border border-gray-200"
              >
                {activeSection === 'output'
                  ? (t('autoresearch.recipe.collapse') || '收起')
                  : (t('autoresearch.recipe.edit') || '编辑')}
              </button>
            </div>
          </div>

          {activeSection === 'output' && (
            <div className="p-4 space-y-3 animate-fadeIn text-xs text-gray-700">
              <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
                <input
                  type="checkbox"
                  checked={recipe.outputContract.includeMetrics}
                  onChange={(e) => handleOutputContractChange('includeMetrics', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                />
                {t('autoresearch.recipe.output.metrics') || 'Include Evaluation Metrics'}
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
                <input
                  type="checkbox"
                  checked={recipe.outputContract.includeArtifacts}
                  onChange={(e) => handleOutputContractChange('includeArtifacts', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                />
                {t('autoresearch.recipe.output.artifacts') || 'Include Created/Modified Artifacts'}
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
                <input
                  type="checkbox"
                  checked={recipe.outputContract.includeCommandsRun}
                  onChange={(e) => handleOutputContractChange('includeCommandsRun', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                />
                {t('autoresearch.recipe.output.commands') || 'Include Command Execution Log'}
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
                <input
                  type="checkbox"
                  checked={recipe.outputContract.includeFailureReason}
                  onChange={(e) => handleOutputContractChange('includeFailureReason', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                />
                {t('autoresearch.recipe.output.failure') || 'Include Detailed Failure Diagnostics'}
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer font-medium select-none py-1 font-sans">
                <input
                  type="checkbox"
                  checked={recipe.outputContract.includeRemainingRisks}
                  onChange={(e) => handleOutputContractChange('includeRemainingRisks', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-slate-900 focus:ring-slate-500"
                />
                {t('autoresearch.recipe.output.risks') || 'Include Remaining Risks / Future Directives'}
              </label>
            </div>
          )}

          {activeSection !== 'output' && (
            <div className="px-4 py-2.5 text-xs text-gray-600 bg-white">
              <p className="truncate">
                {Object.entries(recipe.outputContract)
                  .filter(([_, enabled]) => enabled)
                  .map(([name]) => {
                    switch (name) {
                      case 'includeMetrics': return t('autoresearch.recipe.output.metricsShort') || 'metrics';
                      case 'includeArtifacts': return t('autoresearch.recipe.output.artifactsShort') || 'artifacts';
                      case 'includeCommandsRun': return t('autoresearch.recipe.output.commandsShort') || 'commands';
                      case 'includeFailureReason': return t('autoresearch.recipe.output.failureShort') || 'failure reason';
                      case 'includeRemainingRisks': return t('autoresearch.recipe.output.risksShort') || 'remaining risks';
                      default: return name;
                    }
                  })
                  .join(', ') || 'metrics, artifacts, failure reason'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right sticky panel: Launch Cockpit */}
      <div className="sticky top-4 space-y-5 lg:w-[280px] w-full shrink-0 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        {/* Launch progress checklist */}
        <div className="space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 font-sans">
            {t('autoresearch.bootstrap.progressTitle') || '启动进度'}
          </p>
          <div className="space-y-2">
            {[
              { key: 'goal', label: t('autoresearch.recipe.researchGoal') || '研究目标', status: getSectionStatus('goal') },
              { key: 'references', label: t('autoresearch.recipe.references') || '参考资料', status: getSectionStatus('references') },
              { key: 'baseline', label: t('autoresearch.recipe.baselineAndMetric') || '基线与指标', status: getSectionStatus('baseline') },
              { key: 'workspace', label: t('autoresearch.recipe.workspace') || '工作区', status: getSectionStatus('workspace') },
              { key: 'verification', label: t('autoresearch.recipe.verification') || '验证命令', status: getSectionStatus('verification') },
              { key: 'ready', label: t('autoresearch.recipe.ready') || '就绪', status: isFormValid ? 'completed' : 'missing' },
            ].map((item, idx) => {
              const isOk = item.status === 'completed' || item.status === 'optional';
              const isWarn = item.status === 'placeholder';
              return (
                <div key={item.key} className="flex items-center gap-2 text-xs">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold text-[10px] ${
                    isOk
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : isWarn
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {idx + 1}
                  </span>
                  <span className={isOk ? 'text-slate-700 font-medium' : 'text-slate-400'}>
                    {item.label}
                  </span>
                  {isOk ? (
                    <span className="text-emerald-600 text-[10px] ml-auto">✓</span>
                  ) : isWarn ? (
                    <span className="text-blue-600 text-[10px] ml-auto">⋯</span>
                  ) : (
                    <span className="text-amber-600 text-[10px] ml-auto">⋯</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Recipe readiness summary */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/50 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {t('autoresearch.recipe.title') || '配置研究配方'}
          </p>
          <div className="space-y-1.5 text-xs text-slate-700">
            <div className="flex justify-between">
              <span className="text-slate-400">{t('autoresearch.recipe.requiredProgress') || '必填项'}:</span>
              <span className="font-semibold">{requiredCount} / 3</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{t('autoresearch.recipe.recipeProgress') || '配方项'}:</span>
              <span className="font-semibold">{totalCount} / 6</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{t('autoresearch.recipe.targetMetric') || '目标指标'}:</span>
              <span className="font-semibold truncate max-w-[120px]" title={recipe.baselineAndMetric.primaryMetric}>
                {recipe.baselineAndMetric.primaryMetric || '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{t('autoresearch.recipe.workspaceRoot') || '工作区目录'}:</span>
              <span className="font-semibold truncate max-w-[120px]" title={recipe.workspace.workDir}>
                {recipe.workspace.workDir ? recipe.workspace.workDir.split(/[\\/]/).pop() : '--'}
              </span>
            </div>
          </div>
          
          {/* Missing Requirements List */}
          {missingFields.length > 0 && (
            <div className="border-t border-slate-200/60 pt-2 space-y-1">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">
                {t('autoresearch.recipe.todoItems') || '待完成项'}:
              </span>
              <div className="space-y-0.5">
                {missingFields.map((f, i) => (
                  <span key={i} className="text-[10px] text-amber-700 block">⚠️ {f}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions panel */}
        <div className="space-y-2 pt-2 border-t border-gray-100">
          {/* Top missing required action button */}
          {!disabled && firstMissingAction && (
            <button
              type="button"
              onClick={() => setActiveSection(firstMissingAction!.section)}
              className="w-full py-2 px-3 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200/50 rounded-xl transition-all flex items-center justify-center gap-1.5 animate-fadeIn"
            >
              <span>⚠️</span> {firstMissingAction.label}
            </button>
          )}

          {/* Preview start prompt button */}
          <button
            type="button"
            onClick={() => setShowPromptPreview(true)}
            className="w-full py-2 px-3 text-xs font-semibold border border-slate-200 hover:border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5"
          >
            <span>🔍</span> {t('autoresearch.recipe.previewPrompt') || '预览启动 Prompt'}
          </button>

          {/* Start button */}
          <button
            type="button"
            disabled={disabled || !isFormValid}
            onClick={handleSubmit}
            className={`w-full py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
              disabled || !isFormValid
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/50'
                : 'bg-slate-900 hover:bg-slate-800 text-white hover:-translate-y-0.5 active:translate-y-0'
            }`}
          >
            <span>🚀</span> {t('autoresearch.recipe.startScaffolding') || '开始生成脚手架'}
          </button>
        </div>

        {/* Bootstrap Agent Profile Info (Read-only) */}
        <div className="border-t border-gray-100 pt-3 text-[10px] text-gray-500 space-y-1">
          <p className="font-bold text-gray-400 uppercase tracking-wider">
            {t('autoresearch.recipe.agentProfileTitle') || 'Bootstrap Agent Profile'}
          </p>
          <p className="leading-relaxed">
            {t('autoresearch.recipe.agentProfileDesc') || 'Runs in headless session with restricted tool set.'}
          </p>
        </div>

        {/* Advanced prompt blocks toggler */}
        <div className="border-t border-gray-100 pt-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[10px] font-semibold text-gray-400 hover:text-gray-900 self-start transition-colors flex items-center gap-1"
          >
            <span>{showAdvanced ? '▼' : '▶'}</span>
            <span>{t('autoresearch.recipe.advancedTitle') || '高级：Prompt 积木'}</span>
          </button>
          <p className="text-[9px] text-gray-400 leading-normal">
            {t('autoresearch.recipe.advancedDesc') || '通常不需要打开。用于手动微调最终启动 Prompt。'}
          </p>

          {showAdvanced && (
            <div className="mt-2 p-2 bg-gray-50 rounded-xl border border-gray-200 text-xs text-left max-w-full overflow-x-auto">
              <BlockComposer
                blocks={composerBlocks}
                onChange={setComposerBlocks}
                onSend={onSend}
                context={{
                  projectFolder: sshConfig?.mode === 'ssh' ? sshConfig.remoteWorkDir : undefined,
                  contextFiles: importedFiles.map((file) => file.path),
                }}
                disabled={disabled}
                defaultMode="agent"
                density="compact"
              />
            </div>
          )}
        </div>
      </div>

      {/* Prompt Preview Modal */}
      {showPromptPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl border border-gray-200 w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl p-6 m-4 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <span>🔍</span> {t('autoresearch.recipe.previewPrompt') || '预览启动 Prompt'}
              </h3>
              <button
                type="button"
                onClick={() => setShowPromptPreview(false)}
                className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-50 border border-gray-100 rounded-xl p-4 font-mono text-[11px] text-gray-800 whitespace-pre-wrap select-all">
              {compiledPrompt}
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100 mt-4">
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all active:scale-[0.98]"
              >
                {copySuccess ? (t('autoresearch.recipe.copied') || 'Copied! ✓') : (t('autoresearch.recipe.copyPrompt') || 'Copy Prompt')}
              </button>
              <button
                type="button"
                onClick={() => setShowPromptPreview(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-all active:scale-[0.98]"
              >
                {t('autoresearch.recipe.close') || 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
