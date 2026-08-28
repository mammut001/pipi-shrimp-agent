import React, { useState, useEffect, useCallback } from 'react';
import { t, getCurrentLocale } from '@/i18n';
import { useSettingsStore } from '@/store';
import type { SshConfig } from '@/store/autoresearchStore';
import { open } from '@tauri-apps/plugin-dialog';
import type { Recipe } from './bootstrapRecipePrompt';
import { buildBootstrapPromptFromRecipe } from './bootstrapRecipePrompt';

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

export function formatMetricSummary(
  metric: string,
  direction: 'higher' | 'lower',
  baselineValue: string | undefined,
  locale: string,
): string {
  const dirLabel = formatDirectionLabel(direction, locale);
  const baselineText = baselineValue || (locale === 'zh-CN' ? '未指定' : 'none');
  if (locale === 'zh-CN') {
    return `主指标：${metric}，${dirLabel}，当前基线 ${baselineText}`;
  }
  return `Primary metric: ${metric}, ${dirLabel}, current baseline ${baselineText}`;
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
      addImportedFiles(paths.map((path) => ({
        name: path.split(/[\\/]/).pop() || path,
        path,
      })));
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    }
  }, [addImportedFiles]);

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

  const handleGoalChange = (value: Partial<Recipe['researchGoal']>) => {
    onChange({
      ...recipe,
      researchGoal: { ...recipe.researchGoal, ...value, source: 'user' },
    });
  };

  const handleMetricChange = (value: Partial<Recipe['baselineAndMetric']>) => {
    onChange({
      ...recipe,
      baselineAndMetric: { ...recipe.baselineAndMetric, ...value },
    });
  };

  const handleWorkspaceChange = (value: Partial<Recipe['workspace']>) => {
    onChange({
      ...recipe,
      workspace: { ...recipe.workspace, ...value },
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

  const handleRemoveCommand = (command: string) => {
    onChange({
      ...recipe,
      verification: {
        ...recipe.verification,
        commands: recipe.verification.commands.filter((item) => item !== command),
      },
    });
  };

  const handleOutputContractChange = (
    field: keyof Recipe['outputContract'],
    checked: boolean,
  ) => {
    onChange({
      ...recipe,
      outputContract: {
        ...recipe.outputContract,
        [field]: checked,
      },
    });
  };

  // The structured Recipe is now the only AutoResearch bootstrap source of
  // truth. Historical recipe fields remain untouched for compatibility, but
  // the removed Prompt-block editor can no longer create a second competing
  // launch prompt.
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
    onSend(compiledPrompt);
  };

  const readiness = getRecipeReadiness(recipe);
  const nextAction = getRecipeNextAction(readiness);
  const locale = getCurrentLocale();

  return (
    <div className="grid grid-cols-1 items-start gap-6 font-sans lg:grid-cols-[1fr_280px]">
      <div className="w-full max-w-[920px] space-y-3">
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
              {isGoalPlaceholder(recipe.researchGoal.goalText, recipe.researchGoal.source)
                ? (t('autoresearch.recipe.confirmGoal') || '请确认目标')
                : (recipe.researchGoal.goalText || 'No goal set yet')}
            </span>
          }
        >
          <ResearchGoalSection recipe={recipe} onChange={handleGoalChange} />
        </RecipeSectionCard>

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
                : `${t('autoresearch.recipe.references')}: ${importedFiles.map((file) => file.name).join(', ')}`}
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
                    locale,
                  )
                : (t('autoresearch.recipe.notConfigured') || 'Not configured')}
            </p>
          }
        >
          <BaselineMetricSection recipe={recipe} onChange={handleMetricChange} />
        </RecipeSectionCard>

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
            <span className="truncate pr-4 font-sans text-gray-600">
              {formatWorkspaceSummary(recipe.workspace, locale)}
            </span>
          }
        >
          <WorkspaceSection recipe={recipe} sshConfig={sshConfig} onChange={handleWorkspaceChange} />
        </RecipeSectionCard>

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
          <OutputContractSection
            outputContract={recipe.outputContract}
            onChange={handleOutputContractChange}
          />
        </RecipeSectionCard>
      </div>

      <RecipeCockpitPanel
        recipe={recipe}
        readiness={readiness}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        disabled={disabled}
        onShowPromptPreview={() => setShowPromptPreview(true)}
        onSubmit={handleSubmit}
      />

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
