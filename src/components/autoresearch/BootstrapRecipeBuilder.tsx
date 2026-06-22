import React, { useState, useEffect, useCallback } from 'react';
import { t, getCurrentLocale } from '@/i18n';
import { useSettingsStore } from '@/store';
import type { SshConfig } from '@/store/autoresearchStore';
import { open } from '@tauri-apps/plugin-dialog';
import type { Recipe } from './bootstrapRecipePrompt';
import { buildBootstrapPromptFromRecipe } from './bootstrapRecipePrompt';
import { type ComposerBlock } from '@/components/chatInput/blocks/types';

import {
  getRecipeReadiness,
  getRecipeNextAction,
  isGoalPlaceholder,
} from './recipe/recipeReadiness';
import {
  formatTaskTypeLabel,
  formatDirectionLabel,
  formatWorkspaceSummary,
  formatOutputContractSummary,
} from './recipe/recipeFormatting';

import { RecipeSectionCard } from './recipe/RecipeSectionCard';
import { ResearchGoalSection } from './recipe/sections/ResearchGoalSection';
import { ReferencesSection } from './recipe/sections/ReferencesSection';
import { BaselineMetricSection } from './recipe/sections/BaselineMetricSection';
import { WorkspaceSection } from './recipe/sections/WorkspaceSection';
import { VerificationSection } from './recipe/sections/VerificationSection';
import { OutputContractSection } from './recipe/sections/OutputContractSection';
import { RecipeCockpitPanel } from './recipe/RecipeCockpitPanel';
import { PromptPreviewDialog } from './recipe/PromptPreviewDialog';

export {
  formatTaskTypeLabel,
  formatDirectionLabel,
  formatWorkspaceSummary,
  formatOutputContractSummary,
} from './recipe/recipeFormatting';

export function formatMetricSummary(metric: string, direction: 'higher' | 'lower', baselineValue: string | undefined, locale: string): string {
  const dirLabel = formatDirectionLabel(direction, locale);
  const baselineText = baselineValue || (locale === 'zh-CN' ? '未指定' : 'none');
  if (locale === 'zh-CN') {
    return `主指标：${metric}，${dirLabel}，当前基线 ${baselineText}`;
  } else {
    return `Primary metric: ${metric}, ${dirLabel}, current baseline ${baselineText}`;
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

  const readiness = getRecipeReadiness(recipe);
  const nextAction = getRecipeNextAction(readiness);
  const locale = getCurrentLocale();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start font-sans">
      {/* Left Column: Recipe Sections */}
      <div className="space-y-3 max-w-[920px] w-full">
        {/* Section 1: Research Goal */}
        <RecipeSectionCard
          id="goal"
          number={1}
          emoji="🎯"
          title={t('autoresearch.recipe.researchGoal') || '研究目标'}
          status={readiness.sectionStatus.goal}
          statusLabel={
            readiness.sectionStatus.goal === 'completed'
              ? (t('autoresearch.recipe.completed') || '已完成')
              : readiness.sectionStatus.goal === 'placeholder'
              ? (t('autoresearch.recipe.confirmGoal') || '请确认目标')
              : (t('autoresearch.recipe.missing') || '缺失')
          }
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          firstMissingSection={nextAction.section}
          collapsedSummary={
            <span className="truncate pr-4 font-sans">
              <span className="font-semibold text-gray-700">{formatTaskTypeLabel(recipe.researchGoal.taskType, locale)}:</span>{' '}
              {isGoalPlaceholder(recipe.researchGoal.goalText, recipe.researchGoal.source) ? (t('autoresearch.recipe.confirmGoal') || '请确认目标') : (recipe.researchGoal.goalText || 'No goal set yet')}
            </span>
          }
        >
          <ResearchGoalSection recipe={recipe} onChange={handleGoalChange} />
        </RecipeSectionCard>

        {/* Section 2: References */}
        <RecipeSectionCard
          id="references"
          number={2}
          emoji="📚"
          title={t('autoresearch.recipe.references') || '参考资料'}
          status="optional"
          statusLabel={t('autoresearch.recipe.optional') || '可选'}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          firstMissingSection={nextAction.section}
          collapsedSummary={
            <p className="truncate font-sans">
              {importedFiles.length === 0
                ? (t('autoresearch.recipe.noFiles') || '暂未添加参考文件。')
                : `${t('autoresearch.recipe.references')}: ${importedFiles.map((f) => f.name).join(', ')}`}
            </p>
          }
        >
          <ReferencesSection
            recipe={recipe}
            locale={locale}
            importedFiles={importedFiles}
            onAddFiles={handleAddFilesLocal}
            onRemoveFile={removeImportedFile}
          />
        </RecipeSectionCard>

        {/* Section 3: Baseline & Metric */}
        <RecipeSectionCard
          id="baseline"
          number={3}
          emoji="📊"
          title={t('autoresearch.recipe.baselineAndMetric') || '基线与指标'}
          status={readiness.sectionStatus.baseline}
          statusLabel={
            readiness.sectionStatus.baseline === 'completed'
              ? (t('autoresearch.recipe.completed') || '已完成')
              : (t('autoresearch.recipe.missing') || '缺失')
          }
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          firstMissingSection={nextAction.section}
          collapsedSummary={
            <p className="truncate font-sans">
              {recipe.baselineAndMetric.primaryMetric
                ? formatMetricSummary(
                    recipe.baselineAndMetric.primaryMetric,
                    recipe.baselineAndMetric.direction,
                    recipe.baselineAndMetric.baselineValue,
                    locale
                  )
                : (t('autoresearch.recipe.notConfigured') || 'Not configured')}
            </p>
          }
        >
          <BaselineMetricSection recipe={recipe} onChange={handleMetricChange} />
        </RecipeSectionCard>

        {/* Section 4: Workspace */}
        <RecipeSectionCard
          id="workspace"
          number={4}
          emoji="📁"
          title={t('autoresearch.recipe.workspace') || '工作区'}
          status={readiness.sectionStatus.workspace}
          statusLabel={
            readiness.sectionStatus.workspace === 'completed'
              ? (t('autoresearch.recipe.completed') || '已完成')
              : (t('autoresearch.recipe.missing') || '缺失')
          }
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          firstMissingSection={nextAction.section}
          collapsedSummary={
            <span className="truncate pr-4 text-gray-600 font-sans">
              {formatWorkspaceSummary(recipe.workspace, locale)}
            </span>
          }
        >
          <WorkspaceSection recipe={recipe} sshConfig={sshConfig} onChange={handleWorkspaceChange} />
        </RecipeSectionCard>

        {/* Section 5: Verification */}
        <RecipeSectionCard
          id="verification"
          number={5}
          emoji="✅"
          title={t('autoresearch.recipe.verification') || '验证命令'}
          status="optional"
          statusLabel={t('autoresearch.recipe.optional') || '可选'}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          firstMissingSection={nextAction.section}
          collapsedSummary={
            <p className="truncate font-sans">
              {recipe.verification.commands.length === 0
                ? `0 ${t('autoresearch.recipe.verification') || '个验证命令'}`
                : `${recipe.verification.commands.length} ${t('autoresearch.recipe.verification') || '个验证命令'}`}
            </p>
          }
        >
          <VerificationSection
            commands={recipe.verification.commands}
            newCommand={newCommand}
            setNewCommand={setNewCommand}
            onAddCommand={handleAddCommand}
            onRemoveCommand={handleRemoveCommand}
          />
        </RecipeSectionCard>

        {/* Section 6: Output Contract */}
        <RecipeSectionCard
          id="output"
          number={6}
          emoji="📄"
          title={t('autoresearch.recipe.outputContract') || '输出要求'}
          status="optional"
          statusLabel={t('autoresearch.recipe.optional') || '可选'}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          firstMissingSection={nextAction.section}
          collapsedSummary={
            <p className="truncate font-sans">
              {formatOutputContractSummary(recipe.outputContract, locale)}
            </p>
          }
        >
          <OutputContractSection outputContract={recipe.outputContract} onChange={handleOutputContractChange} />
        </RecipeSectionCard>
      </div>

      {/* Right Column: Launch Cockpit */}
      <RecipeCockpitPanel
        recipe={recipe}
        readiness={readiness}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        disabled={disabled}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        composerBlocks={composerBlocks}
        setComposerBlocks={setComposerBlocks}
        sshConfig={sshConfig}
        importedFiles={importedFiles}
        onSend={onSend}
        onShowPromptPreview={() => setShowPromptPreview(true)}
        onSubmit={handleSubmit}
      />

      {/* Prompt Preview Modal */}
      <PromptPreviewDialog
        isOpen={showPromptPreview}
        onClose={() => setShowPromptPreview(false)}
        compiledPrompt={compiledPrompt}
        copySuccess={copySuccess}
        onCopyPrompt={handleCopyPrompt}
      />
    </div>
  );
}
