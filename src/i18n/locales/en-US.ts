/**
 * English Translation
 */

import type { TranslationKeys } from '../types';

const enUS: TranslationKeys = {
  // Common
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.success': 'Success',
  'common.retry': 'Retry',
  'common.close': 'Close',
  'common.or': 'or',
  'common.preview': 'Preview',
  'common.copy': 'Copy',
  'common.add': 'Add',
  'common.create': 'Create',
  'common.change': 'Change',
  'common.edit': 'Edit',
  'common.hide': 'Hide',
  'common.show': 'Show',
  'common.clear': 'Clear',
  'common.open': 'Open',
  'common.move': 'Move',
  'common.none': 'None',
  'common.all': 'All',
  'common.search': 'Search',
  'common.select': 'Select',
  'common.check': 'Check',
  'common.export': 'Export',
  'common.reset': 'Reset',
  'common.light': 'Light',
  'common.dark': 'Dark',
  'common.description': 'Description',
  'common.name': 'Name',
  'common.tool': 'Tool',
  'common.inputParameters': 'Input Parameters',
  'common.requiredField': 'This field is required',

  // Artifacts
  'artifacts.singleFileGenerated': '{count} file generated',
  'artifacts.multipleFilesGenerated': '{count} files generated',

  // AutoResearch
  'autoresearch.selectExperimentForDetails': 'Select an experiment on the left to view details',
  'autoresearch.experiment': 'Experiment',
  'autoresearch.experimentShort': 'Exp',
  'autoresearch.hypothesis': 'Hypothesis',
  'autoresearch.change': 'Change',
  'autoresearch.result': 'Result',
  'autoresearch.reasoning': 'Reasoning',
  'autoresearch.notAvailable': 'N/A',
  'autoresearch.emptyValue': '—',
  'autoresearch.secondsShort': 's',
  'autoresearch.statusImproved': 'Improved',
  'autoresearch.statusNotImproved': 'Not Improved',
  'autoresearch.statusFailed': 'Failed',
  'autoresearch.statusReflectionFailed': 'Reflection failed',
  'autoresearch.reflectionParseFailed': 'Reflection parse failed',
  'autoresearch.reflectionReason': 'Reflection reason',
  'autoresearch.failedToResolveSessionFilePath': 'Failed to resolve AutoResearch session file path: {message}',
  'autoresearch.setupTitle': 'AutoResearch Setup',
  'autoresearch.setupDescription': 'Run the loop on this Mac locally or on a remote machine via SSH. Password auth requires sshpass.',
  'autoresearch.modeLocal': 'Local',
  'autoresearch.modeRemote': 'Remote SSH (Linux)',
  'autoresearch.hostPlaceholder': 'Host (e.g. 192.168.1.10 or connect.westd.seetacloud.com)',
  'autoresearch.userPlaceholder': 'User (default: root)',
  'autoresearch.portPlaceholder': 'Port',
  'autoresearch.authAgent': 'Auth: Agent (~/.ssh/config or authorized_keys)',
  'autoresearch.authPassword': 'Auth: Password (sshpass)',
  'autoresearch.authKey': 'Auth: Private key',
  'autoresearch.passwordPlaceholder': 'Password (kept in memory only)',
  'autoresearch.sshKeyPathPlaceholder': 'SSH key path (e.g. ~/.ssh/id_rsa)',
  'autoresearch.localWorkDirPlaceholder': 'Local work dir (absolute path)',
  'autoresearch.chooseDirectory': 'Choose...',
  'autoresearch.remoteWorkDirPlaceholder': 'Remote work dir (default: ~/autoresearch)',
  'autoresearch.experimentDirPlaceholder': 'Experiment project directory',
  'autoresearch.testConnection': 'Test connection',
  'autoresearch.connectionTesting': 'Testing connection...',
  'autoresearch.connectionTestRequired': 'Run a successful connection test before starting AutoResearch.',
  'autoresearch.metricNamePlaceholder': 'Metric name (e.g. val_bpb)',
  'autoresearch.lowerIsBetter': 'Lower is better',
  'autoresearch.higherIsBetter': 'Higher is better',
  'autoresearch.maxIterationsPlaceholder': 'Max iterations (default: 50)',
  'autoresearch.maxIterationsShortPlaceholder': 'max',
  'autoresearch.prefillDefaults': 'Prefilled from AutoResearch defaults.',
  'autoresearch.prefillLastUsed': 'Prefilled from your last run.',
  'autoresearch.resetToDefaults': 'Reset to defaults',
  'autoresearch.start': 'Start AutoResearch',
  'autoresearch.starting': 'Starting AutoResearch...',
  'autoresearch.validationHostRequired': 'SSH host is required.',
  'autoresearch.validationUserRequired': 'SSH user is required.',
  'autoresearch.validationPasswordRequired': 'SSH password is required for password auth.',
  'autoresearch.validationKeyPathRequired': 'SSH key path is required for key auth.',
  'autoresearch.validationWorkdirRequired': 'Workdir is required.',
  'autoresearch.validationExperimentDirRequired': 'Experiment directory is required.',
  'autoresearch.validationMetricRequired': 'Metric name is required.',
  'autoresearch.validationBaselineNumber': 'Baseline must be a number.',
  'autoresearch.loopStateIdle': 'Idle',
  'autoresearch.loopStateRunning': 'Running',
  'autoresearch.loopStatePaused': 'Paused',
  'autoresearch.loopStateStopped': 'Stopped',
  'autoresearch.loopStateError': 'Error',
  'autoresearch.best': 'Best',
  'autoresearch.consecutiveFailures': '{count} consecutive failure(s)',
  'autoresearch.setupAndStart': 'Setup & Start',
  'autoresearch.pause': 'Pause',
  'autoresearch.stop': 'Stop',
  'autoresearch.resume': 'Resume',
  'autoresearch.newSession': 'New Session',
  'autoresearch.emptyIdle': 'Configure and start an experiment session.',
  'autoresearch.emptyWaiting': 'Waiting for first experiment...',
  'autoresearch.terminalTitle': 'Experiment Terminal',
  'autoresearch.hideTerminal': 'Hide terminal',
  'autoresearch.showTerminal': 'Show terminal',
  'autoresearch.detail.autoResearch': 'Auto Research',
  'autoresearch.detail.demo': 'Demo',
  'autoresearch.detail.fullReport': 'Full report',
  'autoresearch.detail.open': 'Open',
  'autoresearch.detail.backToRuns': 'Back to Runs',
  'autoresearch.detail.backToDashboard': 'Back to Dashboard',
  'autoresearch.detail.close': 'Close',
  'autoresearch.detail.demoNotice': 'Demo preview is shown because no AutoResearch run with iterations is selected yet.',
  'autoresearch.detail.metricHistory': 'Metric History',
  'autoresearch.detail.iterationsTitle': 'Iterations',
  'autoresearch.detail.iterationsSubtitle': 'Compact benchmark deltas for each candidate run.',
  'autoresearch.detail.noIterations': 'No iterations recorded yet.',
  'autoresearch.detail.noParsedMetricPoints': 'No parsed metric points yet.',
  'autoresearch.detail.baseline': 'Baseline',
  'autoresearch.detail.best': 'Best',
  'autoresearch.detail.iterationAxis': 'iteration',
  'autoresearch.detail.keepBreakthrough': 'keep / breakthrough',
  'autoresearch.detail.discard': 'discard',
  'autoresearch.detail.failedNoMetric': 'failed/no metric',
  'autoresearch.liveOutput.copy': 'Copy',
  'autoresearch.liveOutput.download': 'Download .log',
  'autoresearch.recentEvents.copyAll': 'Copy All',
  'autoresearch.recentEvents.copyOne': 'Copy',
  'autoresearch.model.unknownProvider': 'Unknown provider',
  'autoresearch.model.unknownModel': 'Unknown model',
  'autoresearch.model.unknownCompact': 'Unknown provider · Unknown model',
  'autoresearch.preflight.notGitRepoTitle': 'Experiment directory is not a Git repository.',
  'autoresearch.preflight.notGitRepoDescription': 'AutoResearch needs Git to create snapshots, inspect diffs, and track changes.',
  'autoresearch.preflight.requiredFiles': 'Required files:',
  'screenshot.unavailable': 'Screenshot unavailable.',
  'screenshot.invalid': 'Screenshot data is invalid.',

  // Navigation
  'nav.chat': 'Chat',
  'nav.workflow': 'Workflow',
  'nav.browser': 'Browser',
  'nav.skill': 'Skill',
  'nav.diagnostics': 'Diagnostics',
  'nav.settings': 'Settings',
  'nav.newChat': 'New Chat',
  'nav.sessions': 'Sessions',
  'nav.noSessions': 'No sessions yet',

  // Settings page
  'settings.title': 'Settings',
  'settings.apiConfig': 'API Configuration',
  'settings.apiProvider': 'API Provider',
  'settings.apiKey': 'API Key',
  'settings.apiKeyPlaceholder': 'Enter your API key',
  'settings.model': 'Model',
  'settings.language': 'Language',
  'settings.languageDescription': 'Select interface language',
  'settings.theme': 'Theme',
  'settings.workingDir': 'Working Directory',
  'settings.saveSettings': 'Save Settings',
  'settings.tokenStats': 'Token Usage Statistics',
  'settings.tokenStatsDescription': 'View your API token consumption',

  // Diagnostics
  'diagnostics.dbHealth': 'Database Health',
  'diagnostics.dbHealthDescription': 'Inspect the live database, exported backups, and migration readiness.',
  'diagnostics.schemaVersion': 'Schema Version',
  'diagnostics.fileSize': 'Database Size',
  'diagnostics.walSize': 'WAL Size',
  'diagnostics.lastMigration': 'Last Migration',
  'diagnostics.integrityCheck': 'Integrity Check',
  'diagnostics.backupCount': 'Backups',
  'diagnostics.exportBackup': 'Export Backup',
  'diagnostics.openDataDirectory': 'Open Data Directory',
  'diagnostics.backupList': 'Backup List',
  'diagnostics.restoreBackup': 'Restore Backup',
  'diagnostics.restoreConfirm': 'Restore Database Backup',
  'diagnostics.restoreConfirmDescription': 'Type CONFIRM before restoring a backup. The app will reload after a successful restore.',
  'diagnostics.restorePlaceholder': 'Type CONFIRM to continue',
  'diagnostics.refresh': 'Refresh',
  'diagnostics.noBackups': 'No backups available yet.',
  'diagnostics.createdAt': 'Created',
  'diagnostics.size': 'Size',
  'diagnostics.actions': 'Actions',
  'diagnostics.loadFailed': 'Failed to load database diagnostics.',
  'diagnostics.exportSuccess': 'Database backup exported.',
  'diagnostics.exportFailed': 'Failed to export database backup.',
  'diagnostics.openDirectorySuccess': 'Opened the data directory.',
  'diagnostics.openDirectoryFailed': 'Failed to open the data directory.',
  'diagnostics.restoreSuccess': 'Database restored from backup. Reloading the app...',
  'diagnostics.restoreFailed': 'Failed to restore the selected backup.',
  'diagnostics.notAvailable': 'Not available',
  'diagnostics.path': 'Data Path',
  'diagnostics.title': 'Diagnostics',
  'diagnostics.description': 'Inspect runtime signals and review task activity across chat, workflow, swarm, telegram, and browser sources.',
  'diagnostics.sectionLabel': 'Runtime Diagnostics',
  'diagnostics.tasksPanelTitle': 'Diagnostics Tasks Panel',
  'diagnostics.tasksPanelDescription': 'Track task state transitions across the five runtime task sources and cancel tasks that expose a cancellation action.',
  'diagnostics.noTasks': 'No tasks match the current filters.',
  'diagnostics.kindFilter': 'Kind Filter',
  'diagnostics.stateFilter': 'State Filter',
  'diagnostics.cancelTask': 'Cancel',
  'diagnostics.noAction': 'No actions',
  'diagnostics.table.id': 'ID',
  'diagnostics.table.kind': 'Kind',
  'diagnostics.table.state': 'State',
  'diagnostics.table.source': 'Source',
  'diagnostics.table.created': 'Created',
  'diagnostics.table.updated': 'Updated',
  'diagnostics.table.actions': 'Actions',
  'diagnostics.taskKind.chat': 'Chat',
  'diagnostics.taskKind.workflow': 'Workflow',
  'diagnostics.taskKind.swarm': 'Swarm',
  'diagnostics.taskKind.telegram': 'Telegram',
  'diagnostics.taskKind.browser': 'Browser',
  'diagnostics.taskState.created': 'Created',
  'diagnostics.taskState.running': 'Running',
  'diagnostics.taskState.completed': 'Completed',
  'diagnostics.taskState.failed': 'Failed',
  'diagnostics.taskState.cancelled': 'Cancelled',

  // Chat page
  'chat.inputPlaceholder': 'Type a message...',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.thinking': 'Thinking...',
  'chat.aiThinking': 'AI is thinking...',
  'chat.tokenUsage': 'Token Usage',
  'chat.newSession': 'New Chat',
  'chat.sessionTokenUsage': 'This session',
  'chat.input': 'Input',
  'chat.output': 'Output',
  'chat.total': 'Total',
  'chat.noMessages': 'No messages yet',
  'chat.startConversation': 'Start a conversation',
  'chat.workspaceView': 'Workspace View',
  'chat.workspaceViewDescription': 'Switch between live chat and a document-focused workspace preview.',
  'chat.conversationPanel': 'Conversation',
  'chat.conversationPanelDescription': 'Keep the chat thread visible while reading generated documents.',
  'chat.emptyStatePrompt': 'What can I help you with today?',
  'chat.tokensUnit': 'tokens',
  'chat.newChatTitle': 'New Chat',
  'chat.selectProject': 'Select Project',
  'chat.noProjectRoot': 'No project (root)',
  'chat.projectPickerDescription': 'Choose a project for this chat, continue without one, or cancel.',
  'chat.projectPickerEmpty': 'No projects available yet. You can still start a chat without a project.',
  'chat.openChatFolder': 'Open chat folder',
  'chat.openSourceFolder': 'Open source folder',
  'chat.openOutputFolder': 'Open output folder',
  'chat.changeWorkDirectory': 'Change work directory',
  'chat.removeWorkDirectory': 'Remove work directory',
  'chat.bindWorkFolder': 'Bind work folder',
  'chat.binding': 'Binding...',
  'chat.addImage': 'Add image',
  'chat.imageAttachment': 'Image attachment',
  'chat.imagesAdded': 'Images added',
  'chat.imagesAddFailed': 'Failed to add images',
  'chat.terminal': 'Terminal',
  'chat.showTerminal': 'Show Terminal',
  'chat.hideTerminal': 'Hide Terminal',
  'chat.enterHint': 'Press Enter to send',
  'chat.newLineHint': 'Shift + Enter for new line',
  'chat.showEarlierMessages': 'Show {count} earlier messages',

  // Tool execution
  'tool.executing': 'Executing tool...',
  'tool.completed': 'Completed',
  'tool.failed': 'Failed',
  'tool.permissionRequired': 'Permission Required',
  'tool.allow': 'Allow',
  'tool.deny': 'Deny',
  'tool.allowExecution': 'Allow Execution',
  'tool.executionFailed': 'Execution Failed',

  // Error messages
  'error.apiKeyMissing': 'Please add an API key in Settings',
  'error.networkError': 'Network error, please check your connection',
  'error.timeout': 'Request timeout, please retry',
  'error.unknown': 'Unknown error',
  'error.messageHistoryEmpty': 'Message history is empty, cannot continue conversation',
  'error.noApiConfig': 'No API configuration found, please add an API key in Settings',

  // Permission modes
  'permission.standard': 'Standard',
  'permission.bypass': 'Bypass',
  'permission.autoEdits': 'Auto Edits',
  'permission.planOnly': 'Plan Only',
  'permission.description': 'Select AI execution permission mode',

  // Time
  'time.justNow': 'Just now',
  'time.minutesAgo': 'minutes ago',
  'time.hoursAgo': 'hours ago',
  'time.yesterday': 'Yesterday',

  // Token statistics
  'token.daily': 'Daily',
  'token.monthly': 'Monthly',
  'token.byModel': 'By Model',
  'token.selectMonth': 'Select Month',
  'token.noData': 'No data yet',
  'token.input': 'Input',
  'token.output': 'Output',
  'token.total': 'Total',
  'token.cost': 'Cost',
  'token.estimatedCost': 'Estimated cost',
  'token.totalCost': 'Total cost',
  'token.disclaimer': '⚠️ Cost estimates are for reference only. Actual costs may vary due to caching, bulk discounts, and other factors. Please configure model pricing in Settings for more accurate estimates.',
  'token.resetConfirm': 'Are you sure you want to reset all token usage statistics? This action cannot be undone.',
  'token.resetSuccess': 'Token usage statistics have been reset.',
  'token.resetFailed': 'Reset failed',
  'token.usageStats': 'Token Usage Statistics',
  'token.viewConsumption': 'View your API token consumption and cost estimates',
  'token.resetStats': 'Reset Stats',
  'token.allApiKeys': 'All API Keys',
  'token.totalCostLabel': 'Total Estimated Cost',
  'token.totalInput': 'Total Input',
  'token.totalOutput': 'Total Output',
  'token.loading': 'Loading...',
  'token.tokens': 'tokens',

  // Session
  'session.bindWorkDir': 'Bind Work Directory',
  'session.unbindWorkDir': 'Unbind Work Directory',
  'session.workDirBound': 'Work directory bound',
  'session.noWorkDir': 'No work directory',
  'session.deleteSession': 'Delete Session',
  'session.renameSession': 'Rename Session',

  // Swarm Memory
  'swarm.memory.teamMemory': 'Team Memory',
  'swarm.memory.agentMemory': 'Agent Memory',
  'swarm.memory.initSuccess': 'Memory initialized',
  'swarm.memory.initFailed': 'Failed to initialize memory',
  'swarm.memory.extractionComplete': 'Memory extraction complete',
  'swarm.memory.extractionFailed': 'Memory extraction failed',
  'swarm.memory.noMemories': 'No memories saved yet',

  // Workflow
  'workflow.title': 'Workflow',
  'workflow.newWorkflow': 'New Workflow',
  'workflow.clearCanvas': 'Clear',
  'workflow.clearCanvasConfirm': 'Are you sure you want to clear the canvas? This cannot be undone.',
  'workflow.clearCanvasWarning': 'The workflow will run using the current Agent Task configuration',
  'workflow.run': 'Run',
  'workflow.stop': 'Stop',
  'workflow.running': 'Running...',
  'workflow.ready': 'Ready',
  'workflow.agentTask': 'Agent Task',
  'workflow.agentTaskLabel': 'Task Label',
  'workflow.agentTaskLabelPlaceholder': 'e.g. Write architecture doc',
  'workflow.agentTaskLabelHint': 'This short title will be displayed on the canvas node.',
  'workflow.taskPrompt': 'Task Prompt',
  'workflow.taskPromptPlaceholder': 'e.g. Write a research report about the current project architecture.',
  'workflow.taskPromptHint': 'Write what this agent should produce in this specific run. It will be combined with the task instruction below.',
  'workflow.taskInstruction': 'Task Instruction',
  'workflow.taskInstructionPlaceholder': 'e.g. Write a detailed architecture optimization document...',
  'workflow.taskInstructionHint': 'This will be injected into the agent\'s system prompt as a fixed responsibility template.',
  'workflow.upstreamInfo': 'Will receive output from "{name}" and continue based on it.',
  'workflow.upstreamNone': 'Entry node with no upstream input. Will start directly based on the Workflow goal.',
  'workflow.entryNode': 'Entry node (no upstream)',
  'workflow.waitingUpstream': 'Waiting for upstream',
  'workflow.waitingUpstreamHint': 'This agent will start only after all upstream agents complete',
  'workflow.inputSource': 'Input Source',
  'workflow.agentName': 'Agent Name',
  'workflow.agentNamePlaceholder': 'e.g. Full Stack Developer',
  'workflow.systemPrompt': 'System Prompt',
  'workflow.systemPromptPlaceholder': 'Agent system prompt...',
  'workflow.executionMode': 'Execution Mode',
  'workflow.singleExecution': 'Single Run',
  'workflow.multiExecution': 'Multi-round',
  'workflow.maxRounds': 'Max Rounds:',
  'workflow.stopCondition': 'Stop Condition:',
  'workflow.untilComplete': 'Until Complete',
  'workflow.untilError': 'Until Error',
  'workflow.fixedRounds': 'Fixed Rounds',
  'workflow.outputRoutes': 'Output Routes',
  'workflow.addRoute': '+ Add Route',
  'workflow.onComplete': 'On Complete',
  'workflow.onError': 'On Error',
  'workflow.outputContains': 'Output Contains',
  'workflow.always': 'Always',
  'workflow.keywordPlaceholder': 'Keyword (e.g. [[REVIEW_PASS]] or /regex/)',
  'workflow.missingOutputRouteWarning': 'Missing explicit output route',
  'workflow.missingOutputRouteHint': 'This agent mentions routing markers {markers} in its prompt, but no outputContains route matches them. Add explicit routes to avoid silent workflow termination.',
  'workflow.selectTargetAgent': 'Select Target Agent',
  'workflow.condition': 'Condition',
  'workflow.target': 'Target',
  'workflow.agentConfig': 'Agent Config',
  'workflow.noUpstream': 'No upstream (entry node)',
  'workflow.save': 'Save',
  'workflow.cancel': 'Cancel',
  'workflow.delete': 'Delete',
  'workflow.confirm': 'Confirm',
  'workflow.template': 'Preset Templates',
  'workflow.loadTemplate': 'Load from template...',
  'workflow.presetChain': 'A→B→C Preset',
  'workflow.openWorkDir': 'Open Work Directory',
  'workflow.notInWorkflowPage': 'Please enter the Workflow page first',
  'workflow.noWorkflowRunning': 'No workflow is currently running',
  'workflow.cannotOpenDir': 'Cannot open directory: {error}',
  'workflow.confirmClearCanvas': 'Confirm Clear Canvas?',
  'workflow.clearCanvasDesc': 'This will delete all agents and connections. This cannot be undone.',
  'workflow.agentNode': 'Agent Node',
  'workflow.rounds': 'rounds',
  'workflow.usingGlobalConfig': 'Using global config',
  'workflow.addApiConfigFirst': 'Please add API config in Settings first',
  'workflow.getModelListFirst': 'Please get model list first',
  'workflow.cancelAdd': 'Cancel Add',
  'workflow.agentConfigTitle': 'Agent Config',
  'workflow.agentRole': 'Role',
  'workflow.modelConfig': 'Provider / Model',
  'workflow.roleRecommendation': 'Recommended: {providers} · {models}',
  'workflow.applyRecommendation': 'Apply Recommendation',
  'workflow.useMatchingProviderConfig': 'Auto-match provider config',
  'workflow.selectProvider': 'Select provider',
  'workflow.selectModel': 'Select model',
  'workflow.notifyOnComplete': 'Notify on Complete',
  'workflow.notifyOnCompleteEmpty': 'No other agents available',
  'workflow.retryPolicy': 'Retry Policy',
  'workflow.retryMaxAttempts': 'Max attempts',
  'workflow.retryBackoffMs': 'Backoff (ms)',
  'workflow.retryFallbackConfigs': 'Fallback configs',
  'workflow.routeMatch.includes': 'Contains match',
  'workflow.routeMatch.regex': 'Regex match',
  'workflow.role.writer': 'Writer',
  'workflow.role.coder': 'Coder',
  'workflow.role.tester': 'Tester',
  'workflow.role.reviewer': 'Reviewer',
  'workflow.role.security': 'Security',
  'workflow.role.devops': 'DevOps',
  'workflow.role.data-analyst': 'Data Analyst',
  'workflow.role.translator': 'Translator',
  'workflow.role.goal-evaluator': 'Goal Evaluator',
  'workflow.role.custom': 'Custom',
  'workflow.roleHint.writer.reason': 'Best for deep reasoning and long-form writing',
  'workflow.roleHint.coder.reason': 'Good fit for code generation quality',
  'workflow.roleHint.tester.reason': 'Optimized for fast, lower-cost regression loops',
  'workflow.roleHint.reviewer.reason': 'Strong at strict review and issue finding',
  'workflow.roleHint.security.reason': 'Better for deep security reasoning',
  'workflow.roleHint.devops.reason': 'Fits deployment, CI, and configuration work',
  'workflow.roleHint.dataAnalyst.reason': 'Fits structured analysis and summarization',
  'workflow.roleHint.translator.reason': 'Good for terminology consistency and translation quality',
  'workflow.roleHint.goalEvaluator.reason': 'Needs stricter judgment for goal completion',
  'workflow.roleHint.custom.reason': 'Choose a model based on your custom responsibilities',
  'workflow.goalPanel.projectGoal': 'Project Goal',
  'workflow.goalPanel.projectGoalPlaceholder': 'Describe the final outcome this workflow must deliver.',
  'workflow.goalPanel.successCriteria': 'Success Criteria',
  'workflow.goalPanel.successCriteriaPlaceholder': 'Describe how the workflow should decide the goal is reached.',
  'workflow.goalPanel.goalEvaluator': 'Goal Evaluator Agent',
  'workflow.goalPanel.builtinEvaluator': 'Use built-in rules / built-in prompt',
  'workflow.goalPanel.maxIterations': 'Max Goal Iterations',
  'workflow.goalPanel.projectGoalRequired': 'Set a project goal before running the workflow',
  'workflow.goalPanel.expandConfig': 'Expand Config',
  'workflow.goalPanel.collapseConfig': 'Collapse Config',
  'workflow.goalStatus.reached': 'Reached',
  'workflow.goalStatus.notReached': 'Not Reached',
  'workflow.goalStatus.inProgress': 'In Progress',
  'workflow.goalStatus.noMissingItems': 'No missing items',
  'workflow.canvas.emptyState': 'Add agents to display the workflow canvas here',

  // Workflow Output Panel
  'workflow.output.realTime': 'Real-time Output',
  'workflow.output.files': 'Files',
  'workflow.output.openWorkDir': 'Open Work Directory',
  'workflow.output.noAgents': 'Add agents to see output',
  'workflow.output.noOutput': 'No output',
  'workflow.output.waiting': 'Waiting for output...',
  'workflow.output.noFiles': 'No output files',
  'workflow.output.waitingForFiles': 'Waiting for files...',
  'workflow.output.previewing': '← Previewing',
  'workflow.output.runAfter': 'Output files will appear here after running the workflow',
  'workflow.output.noWorkDir': 'No work directory available yet',
  'workflow.output.cannotOpenWorkDir': 'Cannot open work directory: {error}',
  'workflow.output.agentCount': '{done}/{total} agents',
  'workflow.output.expand': 'Expand',
  'workflow.output.collapse': 'Collapse',

  // Workflow Run History
  'workflow.history.title': 'Run History',
  'workflow.history.empty': 'No run history yet',

  // File Preview
  'workflow.filePreview.loading': 'Loading...',
  'workflow.filePreview.readFailed': 'Read failed: {error}',
  'workflow.filePreview.empty': 'File is empty',
  'workflow.filePreview.back': 'Back to Config',

  // Browser Panel
  'browser.title': 'Browser',
  'browser.connect': 'Connect',
  'browser.disconnect': 'Disconnect',
  'browser.connecting': 'Connecting...',
  'browser.notConnected': 'Not connected',
  'browser.refresh': 'Refresh',
  'browser.url': 'URL',
  'browser.back': 'Back',
  'browser.forward': 'Forward',
  'browser.home': 'Home',
  'browser.status.uninitialized': 'Uninitialized',
  'browser.status.opening': 'Opening',
  'browser.status.idle': 'Idle',
  'browser.status.inspecting': 'Inspecting',
  'browser.status.needsLogin': 'Needs login',
  'browser.status.waitingUserResume': 'Waiting for confirmation',
  'browser.status.readyForAgent': 'Ready for task',
  'browser.status.running': 'Running',
  'browser.status.blockedAuth': 'Auth blocked',
  'browser.status.blockedCaptcha': 'Captcha required',
  'browser.status.blockedManualStep': 'Manual step required',
  'browser.status.completed': 'Completed',
  'browser.status.error': 'Error',
  'browser.status.unknown': 'Unknown',
  'browser.manualControl': 'Manual control',
  'browser.agentControl': 'Agent control',
  'browser.windowOpened': '● Window opened',
  'browser.showAdvancedInfo': 'Show advanced info',
  'browser.hideAdvancedInfo': 'Hide advanced info',
  'browser.returnToChat': 'Return to chat',
  'browser.returnToPreviousPage': 'Go back',
  'browser.expandToSplit': 'Expand to split',
  'browser.openNewWindow': 'Open new window',
  'browser.close': 'Close',
  'browser.openWindow': 'Open browser',
  'browser.currentPage': 'Current page:',
  'browser.statusSummary': 'Current status',
  'browser.currentTask': 'Current task',
  'browser.recentActivity': 'Recent activity',
  'browser.noActiveTask': 'No active task',
  'browser.noBrowserSurface': 'No browser surface yet',
  'browser.loginRequired': 'Login or a manual step is required first',
  'browser.loggedIn': 'Logged in',
  'browser.notLoggedIn': 'Not logged in',
  'browser.pendingPageMetadata': 'Pending page metadata',
  'browser.collapseToMini': 'Collapse to mini',
  'browser.quickSites': 'Quick sites',
  'browser.quickTasks': 'Quick tasks',
  'browser.hideHistory': 'Hide history',
  'browser.showHistory': 'Show history',
  'browser.enterTaskInstruction': 'Enter task instruction (e.g. Click login button)',
  'browser.pleaseOpenBrowserFirst': 'Please open browser window first',
  'browser.stop': 'Stop',
  'browser.resetStatus': 'Reset status',
  'browser.execute': 'Execute',
  'browser.executionLog': 'Execution log',
  'browser.clear': 'Clear',
  'browser.waitingForExecution': 'Waiting for task execution...',
  'browser.pleaseCompleteLoginFirst': 'Please complete login in the browser window, then click the button below to verify',
  'browser.refreshAndCheck': 'Refresh & check',
  'browser.continueCheck': 'Continue checking',
  'browser.iHaveLoggedIn': 'Continue after login',
  'browser.forceContinue': 'Force continue',
  'browser.executeAfterLogin': 'Continue after login',
  'browser.executeAfterManualStep': 'Continue after manual step',
  'browser.logs': 'Logs',
  'browser.debug': 'Debug',
  'browser.copyAll': 'Copy all',
  'browser.copied': 'Copied',
  'browser.observability': 'Observability',
  'browser.skipVerificationAndContinue': 'Skip verification and continue',
  'browser.operationBlocked': 'Operation blocked',
  'browser.pleaseCompleteOperationInBrowser': 'Please complete the necessary operations in the browser window, then try again.',
  'browser.recheck': 'Recheck',
  'browser.switchToManual': 'Switch to manual',
  'browser.pageReadyForAutomation': 'Page is ready, automation tasks can be executed',
  'browser.matchedSite': 'Matched site',
  'browser.unknownSite': 'Unknown',
  'browser.advancedDetails': 'Advanced details',
  'browser.inspectionDetails': 'Inspection details',
  'browser.authState': 'Auth state',
  'browser.controlMode': 'Control mode',
  'browser.currentStatus': 'Internal status',
  'browser.siteSafety': 'Execution safety',
  'browser.safeForAgent': 'Safe for automation',
  'browser.notSafeForAgent': 'Not safe for automation',
  'browser.noInspectionResult': 'No inspection result yet',
  'browser.pageTitle': 'Page title',
  'browser.blockReasonDebug': 'Block reason',
  'browser.matchedSignals': 'Matched signals',
  'browser.notice.openWindowFirstTitle': 'Open a page first',
  'browser.notice.openWindowFirstDescription': 'Enter or paste a URL, open the page, and then run the task. Your task text will be kept.',
  'browser.notice.taskContextRequiredTitle': 'Task context is required',
  'browser.notice.taskContextRequiredDescription': 'Start a browser task from chat first, or connect CDP and enter a target URL.',
  'browser.notice.enterTargetUrlTitle': 'Enter a target URL first',
  'browser.notice.enterTargetUrlDescription': 'After connecting CDP, enter a target URL before running the task.',
  'browser.guidance.openWindowTitle': 'Open a page first',
  'browser.guidance.openWindowDescription': 'Enter or paste a URL, then open the page. Once it is open, you can type a task and the panel will inspect automatically before running it.',
  'browser.guidance.openingTitle': 'Opening the page',
  'browser.guidance.openingDescription': 'The browser window is starting. Wait a moment before running a task.',
  'browser.guidance.idleTitle': 'The page is open and ready for your next task',
  'browser.guidance.idleDescription': 'Type a task and click run. The panel will inspect the page automatically before deciding whether it can proceed.',
  'browser.guidance.inspectingTitle': 'Inspecting the page',
  'browser.guidance.inspectingDescription': 'The panel is checking whether the current page is safe to automate. You should not need to click Inspect manually.',
  'browser.guidance.needsLoginTitle': 'You need to finish login first',
  'browser.guidance.needsLoginDescription': 'Complete login or verification in the browser window. Your task text will stay in the input, and you can continue once the page is ready.',
  'browser.guidance.readyTitle': 'Ready to run your task',
  'browser.guidance.readyDescription': 'The page is ready. Enter a task and run it directly.',
  'browser.guidance.runningTitle': 'Task is running',
  'browser.guidance.runningDescription': 'Execution has started and the input is temporarily locked. Use Stop if you need to interrupt it.',
  'browser.guidance.blockedAuthTitle': 'Login needs attention',
  'browser.guidance.blockedAuthDescription': 'The current page likely needs a fresh login. Complete it in the browser, then continue checking.',
  'browser.guidance.blockedCaptchaTitle': 'Captcha must be completed first',
  'browser.guidance.blockedCaptchaDescription': 'Automation is blocked by a captcha. Complete it in the page, then continue checking.',
  'browser.guidance.blockedManualStepTitle': 'A manual step is required first',
  'browser.guidance.blockedManualStepDescription': 'This flow is waiting for a step only you can complete in the page. Finish it there, then continue.',
  'browser.guidance.completedTitle': 'Task completed',
  'browser.guidance.completedDescription': 'You can type the next task and run again without dealing with internal state names.',
  'browser.guidance.errorTitle': 'The task did not start cleanly or did not finish successfully',
  'browser.guidance.errorDescription': 'Your task text stays unless execution already started. Fix the page state and try again, or open advanced info for details.',
  'browser.quickTask.extractHeadlines': 'Extract headline news titles',
  'browser.quickTask.findTechNews': 'Find tech/AI news',
  'browser.quickTask.listCategories': 'List all news categories',
  'browser.quickTask.findHotPosts': 'Find hot posts',
  'browser.quickTask.searchDiscussions': 'Search related discussions',
  'browser.quickTask.extractComments': 'Extract comment summaries',
  'browser.quickTask.findHotRepos': 'Find hot repositories',
  'browser.quickTask.searchProjects': 'Search open source projects',
  'browser.quickTask.extractProjectInfo': 'Extract project information',
  'browser.quickTask.extractVideoTitle': 'Extract video title',
  'browser.quickTask.findRelatedRecommendations': 'Find related recommendations',
  'browser.quickTask.getVideoDescription': 'Get video description',
  'browser.quickTask.searchContacts': 'Search contacts',
  'browser.quickTask.sendTestMessage': 'Send test message',
  'browser.quickTask.getRecentChats': 'Get recent conversations',
  'browser.quickTask.searchProducts': 'Search products',
  'browser.quickTask.extractPriceInfo': 'Extract price information',
  'browser.quickTask.compareReviews': 'Compare product reviews',
  'browser.quickTask.extractMainContent': 'Extract main page content',
  'browser.quickTask.findImportantInfo': 'Find important information',
  'browser.quickTask.summarizePage': 'Summarize page key points',
  'browser.quickSite.cbc': 'CBC',
  'browser.quickSite.googleNews': 'Google News',
  'browser.quickSite.reddit': 'Reddit',
  'browser.quickSite.github': 'GitHub',
  'browser.quickSite.hn': 'HN',
  'browser.quickSite.twitter': 'Twitter',
  'browser.quickSite.youtube': 'YouTube',
  'browser.quickSite.whatsapp': 'WhatsApp',

  // Browser Mini Preview
  'browserMiniPreview.cannotRunMissingContext': 'Cannot run: Missing task context. Please initiate a task from chat, or connect Chrome and enter a URL here.',
  'browserMiniPreview.agentRunning': 'Agent is running',
  'browserMiniPreview.enterTargetUrl': 'Enter target URL (e.g. example.com)',
  'browserMiniPreview.loginInWindow': 'Login in window',
  'browserMiniPreview.refreshAndCheck': 'Refresh and check',
  'browserMiniPreview.iHaveLoggedIn': 'I have logged in',
  'browserMiniPreview.skipVerification': 'Skip verification and continue',
  'browserMiniPreview.forceContinue': 'Force continue',

  // Browser Bridge (chat progress messages)
  'browserBridge.status.opening': 'Opening browser',
  'browserBridge.status.inspecting': 'Inspecting page',
  'browserBridge.status.needsLogin': 'Waiting for login',
  'browserBridge.status.waitingUserResume': 'Waiting for user',
  'browserBridge.status.readyForAgent': 'Page ready',
  'browserBridge.status.running': 'Executing task',
  'browserBridge.status.completed': 'Task completed',
  'browserBridge.status.error': 'Task error',
  'browserBridge.status.blockedAuth': 'Auth blocked',
  'browserBridge.status.blockedCaptcha': 'Captcha encountered',
  'browserBridge.status.blockedManualStep': 'Manual step required',
  'browserBridge.statusMessage.opening': 'Opening browser and preparing the target site...',
  'browserBridge.statusMessage.inspecting': 'Inspecting page status...',
  'browserBridge.statusMessage.needsLogin': 'Target site is open. Please complete login, then click "I have logged in" to continue.',
  'browserBridge.statusMessage.waitingUserResume': 'Waiting for you to complete login. Click "I have logged in" after logging in.',
  'browserBridge.statusMessage.readyForAgent': 'Page is ready. I can continue executing the browser task.',
  'browserBridge.statusMessage.running': 'Executing the task in the browser...',
  'browserBridge.statusMessage.blockedAuth': 'Session expired or login required again. Please complete login first.',
  'browserBridge.statusMessage.blockedCaptcha': 'A CAPTCHA or manual verification step was encountered. Please complete it in the browser.',
  'browserBridge.statusMessage.blockedManualStep': 'This step requires manual confirmation. Please complete the operation in the browser.',
  'browserBridge.statusMessage.completed': 'Browser task completed.',
  'browserBridge.statusMessage.error': 'Browser task encountered an error. Please check the browser window.',
  'browserBridge.statusMessage.default': 'Processing browser task...',
  'browserBridge.progressHeaderComplete': '🌐 **Browser Task** · ✅ Completed',
  'browserBridge.progressHeaderInProgress': '🌐 **Browser Task** · ⏳ In progress',
  'browserBridge.complexity.simple': 'simple task',
  'browserBridge.complexity.medium': 'medium complexity task',
  'browserBridge.complexity.complex': 'complex task',
  'browserBridge.initialMessage': 'I will open {profile} {complexity}.',
  'browserBridge.taskCompletedNoResult': '(Browser task completed, but no content was retrieved. The page may be empty or the task did not return data.)',
  'browserBridge.defaultTaskDescription': 'Execute browser task',
  'browserBridge.browseTaskDescription': 'Browse web content',

  // Skill Page
  'skill.title': 'Skills',
  'skill.marketplace': 'Marketplace',
  'skill.mySkills': 'My Skills',
  'skill.noSkills': 'No skills yet',
  'skill.install': 'Install',
  'skill.uninstall': 'Uninstall',
  'skill.backToChat': 'Back to chat',
  'skill.addCustomSkill': 'Add custom Skill',
  'skill.searchPlaceholder': 'Search Skills...',
  'skill.edit': 'Edit',
  'skill.delete': 'Delete',
  'skill.notFound': 'Not found',
  'skill.tryOtherSearchTerms': 'Try other search terms',
  'skill.editSkill': 'Edit Skill',
  'skill.addCustomSkillModal': 'Add custom Skill',
  'skill.name': 'Name',
  'skill.namePlaceholder': 'e.g. PDF Analyzer',
  'skill.description': 'Description',
  'skill.descriptionPlaceholder': 'e.g. Read PDF, extract text, tables, metadata',
  'skill.iconPreview': 'Icon preview',
  'skill.iconPreviewHint': 'Hover over skill card to see edit button',
  'skill.cancel': 'Cancel',
  'skill.saveChanges': 'Save changes',
  'skill.addSkill': 'Add Skill',

  // Skill Documentation Content
  'skill.pdf.name': 'PDF Analyzer',
  'skill.pdf.description': 'Read PDF, extract text, tables, metadata',
  'skill.pdf.documentation': `# PDF Analyzer

Intelligent PDF document analysis tool that can:
- Extract text content
- Recognize table structures
- Get document metadata
- Process multi-page documents

## Quick Start

After selecting a PDF file, the tool will automatically analyze the document structure and extract relevant information.

## Features

- Support for scanned PDFs (OCR)
- Table recognition and extraction
- Metadata reading
- Batch processing`,

  'skill.resume.name': 'Resume Generator',
  'skill.resume.description': 'Professional Typst-based resume generation with one-click layout',
  'skill.resume.documentation': `# Resume Generator

Leverage the powerful Typst typesetting engine to transform your experience into a professional-grade PDF resume.

## Features
- **Automatic Layout**: Provide text, and the AI handles spacing, alignment, and formatting automatically.
- **Typst Engine**: Native Rust-based rendering for extreme speed and high fidelity.
- **Modern Design**: Built-in classic and professional resume templates.`,

  'skill.docx.name': 'Word Document',
  'skill.docx.description': 'Create and edit Word documents',
  'skill.docx.documentation': `# Word Document Processor

Create and edit Microsoft Word documents (.docx)

## Features

- Create new documents
- Add paragraphs, headings, lists
- Insert tables and images
- Set page styles
- Export to PDF

## Usage Examples

The tool supports:
- Text formatting (bold, italic, underline)
- Page setup (margins, paper size)
- Page numbers and headers/footers
- Table of contents generation`,

  'skill.xlsx.name': 'Data Statistics',
  'skill.xlsx.description': 'Process CSV/JSON/Excel, generate reports',
  'skill.xlsx.documentation': `# Data Statistics Analysis Tool

Process spreadsheet data, supports CSV, JSON and Excel formats.

## Features

- Import multiple data formats
- Data cleaning and transformation
- Statistical analysis and summary
- Chart generation
- Report output

## Supported Operations

- Pivot tables
- Formula calculations
- Conditional formatting
- Data validation
- Auto sort and filter`,

  'skill.skillCreator.name': 'Skill Creator',
  'skill.skillCreator.description': 'Create and optimize custom skills',
  'skill.skillCreator.documentation': `# Skill Creator

Develop and optimize custom skills

## Create New Skill

1. Click "Add Custom Skill" button
2. Enter skill name and description
3. Select icon
4. Save skill

## Edit Skill

- Hover over skill card
- Click edit button to modify information
- Or click delete button to remove skill

## Skill Best Practices

- Clear and explicit naming
- Detailed and accurate description
- Simple and recognizable icons`,

  'skill.autoresearch.name': 'AutoResearch',
  'skill.autoresearch.description': 'Autonomous experiment loop with SSH remote training & metric-driven optimization',
  'skill.autoresearch.documentation': `# AutoResearch

Autonomous experiment loop for iterative ML training and hyperparameter optimization.

## Capabilities

- Run training commands on a remote VPS via SSH
- Automatically iterate based on metric improvements
- Log experiments and support failure rollback (git-based)
- Real-time status and live output in the right panel

## How to Use

1. Click **Open in Chat** to enter the Chat view
2. The AutoResearch panel opens and a Setup modal appears
3. Configure SSH connection and experiment parameters, then start the loop

## Architecture

- The loop engine builds a system prompt each iteration
- The agent uses ssh_exec / ssh_upload_file tools to run experiments
- Results are parsed and logged; improved experiments are committed, failures are rolled back`,
  'skill.autoresearch.openInChat': 'Open in Chat',
  'skill.webResearch.name': 'Web Research',
  'skill.webResearch.description': 'Research live websites with PageState navigation, extraction, and source-backed summaries.',
  'skill.webResearch.documentation': `# Web Research

Research a topic in a live browser using the PageState-aware browser toolchain.

## Best For

- Comparing information across public websites
- Following search results to the primary source
- Summarizing page content with the source URL preserved

## Preferred Tool Loop

- browser_navigate
- browser_get_page
- browser_click / browser_type / browser_press_key
- browser_wait
- browser_extract_content or browser_get_text

## Demo Prompts

- Research the current release notes for Tauri 2 and summarize the top 3 changes.
- Find the official documentation page for Chromiumoxide screenshot capture and extract the key API details.
- Open a product page, identify the price and delivery text, and report both with the source URL.

## Validation Flow

1. Open the target page or a search engine.
2. Re-read browser_get_page after each meaningful DOM change.
3. Extract only the page needed to answer the question.
4. Return a concise answer plus the title and URL.
`,
  'skill.formFill.name': 'Form Fill',
  'skill.formFill.description': 'Fill web forms with backend_node_id targeting, verification reads, and guarded submission.',
  'skill.formFill.documentation': `# Form Fill

Fill structured browser forms while re-checking PageState before risky actions.

## Best For

- Checkout and signup forms
- Support or application forms
- Multi-step flows that change after typing

## Preferred Tool Loop

- browser_get_page
- browser_type
- browser_click
- browser_wait
- browser_get_page again before submit

## Demo Prompts

- Open the checkout demo, fill the card field with a test number, and stop before submission.
- Find the login form, type the provided email, and confirm which field is still empty.
- Fill every required field you can confidently identify, then list exactly what changed.

## Guardrails

- Confirm the current page state before each risky click.
- Stop before irreversible submission unless the user explicitly asks to continue.
- Report uncertain or missing fields instead of guessing.
`,

  // Typst Preview
  'typst.title': 'Document Preview',
  'typst.render': 'Render',
  'typst.rendering': 'Rendering...',
  'typst.renderFailed': 'Render failed',
  'typst.download': 'Download',

  // Permission Modal
  'permission.title': 'Permission Request',
  'permission.request': 'Permission Request',
  'permission.riskLevel': 'Risk Level',
  'permission.low': 'Low',
  'permission.medium': 'Medium',
  'permission.high': 'High',
  'permission.args': 'Arguments',
  'permission.allow': 'Allow',
  'permission.deny': 'Deny',
  'permission.allowAll': 'Allow All',
  'permission.denyAll': 'Deny All',

  // Chat Input
  'chat.input.dropFiles': 'Drop files here',
  'chat.input.attachFile': 'Attach',
  'chat.input.filesAddedToSession': '{count} files added to current session',
  'chat.input.filesImported': '{count} files imported',
  'chat.input.filesSelected': 'Files selected',
  'chat.input.filesCount': '{count} files',
  'chat.input.dragFilesHere': 'Drag files here',
  'chat.input.filesWillBeAddedToList': 'Files will be added to the list when released',
  'chat.input.removeFile': 'Remove file',
  'chat.input.confirmImportFiles': 'Confirm import {count} files',
  'chat.input.clearList': 'Clear list',
  'chat.input.or': 'or',
  'chat.input.selectFiles': 'Select files',
  'chat.input.pressEscToCancel': 'Press Esc to cancel',
  'chat.input.cancel': 'Cancel',

  // Browser Intent
  'browserIntent.confirmTitle': 'It looks like you want to work with a webpage. Use browser mode?',
  'browserIntent.useBrowser': 'Use browser mode',
  'browserIntent.sendNormally': 'Send as a normal message',

  // Questionnaire
  'questionnaire.submit': 'Submit',
  'questionnaire.selectPlaceholder': 'Select...',

  // Sidebar
  'sidebar.newWorkflow': 'New Workflow',
  'sidebar.sessions': 'Sessions',
  'sidebar.workflows': 'Workflows',
  'sidebar.noWorkflows': 'No workflows yet',
  'sidebar.createFirst': 'Click the button above to create your first workflow',
  'sidebar.localUser': 'Local User',
  'sidebar.accountSuffix': 'Account',
  'sidebar.noApiConfig': 'No API Config',
  'sidebar.justNow': 'Just now',
  'sidebar.minutesAgo': 'm ago',
  'sidebar.hoursAgo': 'h ago',
  'sidebar.daysAgo': 'd ago',
  'sidebar.chatFallback': 'Chat',
  'sidebar.select': 'Select',
  'sidebar.selecting': 'Selecting',
  'sidebar.exitSelection': 'Exit selection',
  'sidebar.selected': 'selected',
  'sidebar.searchChats': 'Search chats...',
  'sidebar.searchWorkflows': 'Search workflows...',
  'sidebar.noResults': 'No results',
  'sidebar.noConversations': 'No conversations yet',
  'sidebar.projects': 'Projects',
  'sidebar.newProject': 'New Project',
  'sidebar.projectName': 'Project name',
  'sidebar.newProjectTitle': 'New Project',
  'sidebar.moveChat': 'Move Chat',
  'sidebar.selectChat': 'Select Chat',
  'sidebar.selectChatPlaceholder': 'Select a chat...',
  'sidebar.moveToProject': 'Move to Project',
  'sidebar.deleteChat': 'Delete Chat',
  'sidebar.deleteChats': 'Delete Chats',
  'sidebar.deleteWorkflow': 'Delete Workflow',
  'sidebar.deleteWorkflows': 'Delete Workflows',
  'sidebar.deleteConversationConfirm': 'Are you sure you want to delete this conversation? This action cannot be undone.',
  'sidebar.deleteConversationsConfirm': 'Are you sure you want to delete the selected conversations? This action cannot be undone.',
  'sidebar.deleteWorkflowConfirm': 'Are you sure you want to delete this workflow? All agents, connections, and run history will be lost. This action cannot be undone.',
  'sidebar.deleteWorkflowsConfirm': 'Are you sure you want to delete the selected workflows? All agents, connections, and run history will be lost. This action cannot be undone.',
  'sidebar.doubleClickToRename': 'Double-click to rename',
  'sidebar.moveToProjectAction': 'Move to project',
  'sidebar.deleteChatAction': 'Delete chat',
  'sidebar.newProjectAction': 'New Project',
  'sidebar.deleteProject': 'Delete Project',
  'sidebar.deleteProjectConfirm': 'Are you sure you want to delete this project and all its conversations?',
  'sidebar.noProjectsYet': 'No projects yet',
  'sidebar.untitledWorkflow': 'Untitled Workflow',
  'sidebar.agentsLabel': 'agents',
  'sidebar.runsLabel': 'runs',

  // Permission Modal Extended
  'permission.subtitle': 'The AI assistant wants to use a tool',
  'permission.tool': 'Tool',
  'permission.inputParameters': 'Input Parameters',
  'permission.truncated': 'Showing the first 1000 characters only',
  'permission.showAdvancedDetails': 'Show advanced details',
  'permission.hideAdvancedDetails': 'Hide advanced details',
  'permission.deniedMessage': 'Permission denied',

  // Settings Extended
  'settings.subtitle': 'Configure your PiPi Shrimp Agent preferences',
  'settings.apiConfigurations': 'API Configurations',
  'settings.addNew': 'Add New',
  'settings.active': 'Active',
  'settings.clickToActivate': 'Click to activate',
  'settings.editConfiguration': 'Edit Configuration',
  'settings.newConfiguration': 'New Configuration',
  'settings.name': 'Name',
  'settings.nameRequired': 'Name is required',
  'settings.modelRequired': 'Model is required',
  'settings.configNamePlaceholder': 'My Anthropic API',
  'settings.provider': 'Provider',
  'settings.baseUrl': 'Base URL',
  'settings.hideApiKey': 'Hide API key',
  'settings.showApiKey': 'Show API key',
  'settings.fetchModels': 'Fetch models',
  'settings.fetchingModels': 'Fetching...',
  'settings.modelPricing': 'Model Pricing',
  'settings.defaultAvailable': 'Default available',
  'settings.configure': 'Configure',
  'settings.pricingDescription': 'Set custom pricing for accurate cost estimation. Leave empty to use defaults.',
  'settings.inputPricePerMillion': 'Input ($/1M tokens)',
  'settings.outputPricePerMillion': 'Output ($/1M tokens)',
  'settings.useDefault': 'Use Default',
  'settings.clearCustom': 'Clear Custom',
  'settings.estimatedCostPerThousand': 'Estimated cost per 1K tokens',
  'settings.testConnection': 'Test Connection',
  'settings.testingConnection': 'Testing...',
  'settings.test': 'Test',
  'settings.save': 'Save',
  'settings.add': 'Add',
  'settings.saving': 'Saving...',
  'settings.agentBehavior': 'Agent Behavior',
  'settings.maxToolLoopRounds': 'Max Tool Loop Rounds',
  'settings.maxToolLoopRoundsDescription': 'Maximum number of tool-call rounds per message. Higher values allow the AI to chain more tool calls before responding.',
  'settings.promptTemplates': 'Prompt Templates',
  'settings.exportJson': 'Export JSON',
  'settings.resetTemplate': 'Reset',
  'settings.cached': 'cached',
  'settings.dynamic': 'dynamic',
  'settings.chars': 'chars',
  'settings.tokensEstimate': 'tokens (est.)',
  'settings.tokenAnalysis': 'Token Analysis',
  'settings.appearance': 'Appearance',
  'settings.connectionSuccessful': 'Connection successful!',
  'settings.connectionTestPassed': 'API connection test passed',
  'settings.connectionTestFailed': 'Connection test failed',
  'settings.foundModels': 'Found models',
  'settings.failedToFetchModels': 'Failed to fetch models',
  'settings.loadedDefaultPricing': 'Loaded default pricing',
  'settings.noDefaultPricing': 'No default pricing available',
  'settings.usingDefaultPricing': 'Using default pricing',
  'settings.configUpdated': 'Configuration updated',
  'settings.configAdded': 'Configuration added',
  'settings.configRemoved': 'Configuration removed',
  'settings.failedToSaveConfig': 'Failed to save config',
  'settings.switchedToConfig': 'Switched config',
  'settings.saved': 'Settings saved',
  'settings.failedToSave': 'Failed to save settings',
  'settings.promptExported': 'Prompt exported to clipboard',
  'settings.resetToDefaultTemplate': 'Reset to default template',

  // MCP
  'mcp.title': 'MCP Servers',
  'mcp.connected': 'connected',
  'mcp.description': 'Model Context Protocol servers extend the agent with additional tools.',
  'mcp.addServer': 'Add Server',
  'mcp.loading': 'Loading…',
  'mcp.noServers': 'No MCP servers configured.',
  'mcp.addFirstServer': 'Add your first server',
  'mcp.tools': 'tools',
  'mcp.connecting': 'Connecting…',
  'mcp.disconnect': 'Disconnect',
  'mcp.connect': 'Connect',

  // Telegram
  'telegram.title': 'Telegram Integration',
  'telegram.description': 'Connect your bot to receive and send messages',
  'telegram.tokenRequired': 'Token is required',
  'telegram.invalidToken': 'Invalid token',
  'telegram.enterBotToken': 'Please enter a bot token',
  'telegram.connectedSuccess': 'Connected to Telegram!',
  'telegram.failedToConnect': 'Failed to connect',
  'telegram.disconnectedInfo': 'Disconnected from Telegram',
  'telegram.connected': 'Connected',
  'telegram.connecting': 'Connecting...',
  'telegram.disconnected': 'Disconnected',
  'telegram.botToken': 'Bot Token',
  'telegram.check': 'Check',
  'telegram.checking': 'Checking...',
  'telegram.validTokenFor': 'Valid token for',
  'telegram.quickSetup': 'Quick Setup',
  'telegram.setupStep1': 'Open Telegram and search for @BotFather',
  'telegram.setupStep2': 'Send /newbot to create a new bot',
  'telegram.setupStep3': 'Follow the instructions and copy your bot token',
  'telegram.setupStep4': 'Paste the token above and click "Check" to validate',
  'telegram.setupStep5': 'Click "Connect" to start receiving messages',
  'telegram.connect': 'Connect',
  'telegram.clear': 'Clear',
  'telegram.disconnect': 'Disconnect',
  'telegram.connectedFeatures': 'Connected Features',
  'telegram.featureSendMessages': 'Send messages to any chat',
  'telegram.featureReceiveMessages': 'Receive messages from users',
  'telegram.featureRealtimeNotifications': 'Real-time message notifications',

  // Browser Inspection
  'browser.authState.authenticated': 'Authenticated',
  'browser.authState.authRequired': 'Login required',
  'browser.authState.mfaRequired': 'Two-factor verification required',
  'browser.authState.captchaRequired': 'Captcha required',
  'browser.authState.expired': 'Session expired',
  'browser.authState.unauthenticated': 'Not signed in',
  'browser.authState.unknown': 'Unknown',
  'browser.blockReason.loginRequired': 'Login required to continue',
  'browser.blockReason.captchaRequired': 'Captcha must be completed',
  'browser.blockReason.mfaRequired': 'Two-factor verification must be completed',
  'browser.blockReason.manualConfirmationRequired': 'Manual confirmation required',
  'browser.blockReason.unsupportedPage': 'Unsupported page',
  'browser.blockReason.rateLimited': 'Too many requests. Please try again later.',
  'browser.blockReason.unknown': 'Blocked for an unknown reason',
  'browser.blockReason.default': 'Operation blocked',
  'browser.recommendation.authRequired': 'This site requires login. Please sign in first, then click the button below to continue.',
  'browser.recommendation.mfaRequired': 'This site requires additional verification. Complete it before continuing.',
  'browser.recommendation.captchaRequired': 'A captcha was detected. Complete it in the browser window, then continue.',
  'browser.recommendation.expired': 'The login session has expired. Please sign in again before continuing.',
  'browser.recommendation.unauthenticated': 'You are not signed in. Please log in first before continuing.',
  'browser.recommendation.default': 'This page is not ready for automation yet. Please check the browser window.',
  'browser.recommendation.safe': 'The page looks good. You can start automation tasks now.',
  'browser.taskCompleted': 'Task completed',
  'browser.taskFailed': 'Task failed',

  // Notification
  'notification.workflowCreated': 'Workflow created',
  'notification.workflowDeleted': 'Workflow deleted',
  'notification.workflowRenamed': 'Workflow renamed',
  'notification.agentAdded': 'Agent added',
  'notification.agentDeleted': 'Agent deleted',
  'notification.connectionAdded': 'Connection added',
  'notification.connectionDeleted': 'Connection deleted',
  'notification.runStarted': 'Workflow started',
  'notification.runCompleted': 'Workflow completed',
  'notification.runFailed': 'Workflow failed',
  'notification.stopped': 'Stopped',

  // Error Boundary
  'errorBoundary.title': 'Something went wrong',
  'errorBoundary.description': 'An unexpected error occurred. You can try reloading the page or go back to the chat.',
  'errorBoundary.reload': 'Reload',
  'errorBoundary.backToChat': 'Back to Chat',
  'errorBoundary.tryBackToChat': 'Try Back to Chat',
  'errorBoundary.copyDiagnostics': 'Copy Diagnostics',
  'errorBoundary.copySuccess': 'Copied to clipboard ✓',

  // Settings - Test Connection Enhanced
  'settings.testConnectionSuccess': 'Connection successful! {provider} / {model}, latency {latency}ms',
  'settings.testConnectionLatency': 'Latency',
  'settings.testConnectionErrorNetwork': 'Network connection failed. Please check your network and Base URL.',
  'settings.testConnectionErrorAuth': 'Authentication failed. Please check your API Key.',
  'settings.testConnectionErrorModel': 'Model not available. Please check the model name or verify it requires additional permissions.',
  'settings.testConnectionErrorBaseUrl': 'Base URL format is invalid. Please check your API address.',
  'settings.testConnectionErrorTimeout': 'Connection timed out. Please check your network or try again later.',
  'settings.testConnectionErrorUnknown': 'Connection test failed. Please check your configuration and try again.',

  // Browser Agent Log Messages
  'browserAgent.log.taskCompleted': 'Task completed! Final URL: {url}',
  'browserAgent.log.taskFailed': 'Task failed: {error}',
  'browserAgent.log.screenshotError': 'Screenshot error: {error}',
  'browserAgent.log.openingBrowser': 'Opening embedded browser: {url}',
  'browserAgent.log.browserOpened': 'Embedded browser opened ({profile})',
  'browserAgent.log.openWindowFailed': 'Failed to open window: {error}',
  'browserAgent.log.closingBrowser': 'Closing embedded browser',
  'browserAgent.log.browserClosed': 'Embedded browser closed',
  'browserAgent.log.closeWindowFailed': 'Failed to close window: {error}',
  'browserAgent.log.windowNotOpen': 'Browser window is not open',
  'browserAgent.log.checkingPageStatus': 'Checking page status...',
  'browserAgent.log.pageStillLoading': 'Page still loading, retrying in 2 seconds...',
  'browserAgent.log.pageCheckFailed': 'Page check failed ({error}), will try to execute directly',
  'browserAgent.log.loginRequired': 'Login required, please complete login to continue',
  'browserAgent.log.captchaDetected': 'CAPTCHA detected, please complete verification first',
  'browserAgent.log.completeLoginInBrowser': 'Please complete login in the browser',
  'browserAgent.log.clickAfterLogin': 'After logging in, click the "I\'m logged in" button to continue',
  'browserAgent.log.statusNotAllowed': 'Current status ({status}) does not allow task execution. Please complete login check first.',
  'browserAgent.log.configureApiFirst': 'Please configure API settings first',
  'browserAgent.log.startExecuting': 'Starting task: {task}',
  'browserAgent.log.executionFailed': 'Execution failed: {error}',
  'browserAgent.log.taskStopped': 'Task stopped',
  'browserAgent.log.loginVerified': 'Login verified, ready to execute tasks',
  'browserAgent.log.loginVerifyFailed': 'Login verification failed, please confirm you are logged in',
  'browserAgent.log.skippingLoginCheck': 'Skipping login check, continuing directly...',
  'browserAgent.log.readyForTask': 'Ready to execute new task',
  'browserAgent.log.executingTask': 'Executing task...',
  'browserAgent.log.resumingTask': 'Resuming task execution...',
  'browserAgent.log.taskBlocked': 'Current task is blocked, please resolve the issue first',
  'browserAgent.log.noLoginRequired': 'No login required, starting task directly',
  'browserAgent.log.loginNotificationTitle': 'Login Required',
  'browserAgent.log.loginNotificationBody': 'Browser opened {siteId}, please complete login and click "I\'m logged in" to continue',
  'browserAgent.log.checkingDuplicate': 'Checking, skipping duplicate request...',
  'browserAgent.log.pageLoggedIn': 'Page is logged in, ready for automation',
  'browserAgent.log.cdpModeStart': '[CDP Mode] Starting: {task}',
  'browserAgent.log.cdpModeComplete': '[CDP Mode] Task completed: {result}',
  'browserAgent.log.cdpModeConnecting': '[CDP Mode] Connecting to external Chrome...',
  'browserAgent.log.needLoginOrVerify': 'Page requires login or verification ({authState}), cannot execute task',
  'browserAgent.log.pageNotSafe': 'Page did not pass safety check, cannot execute task',
  'browserAgent.log.statusError': 'Status error: {status}',
  'browserAgent.log.verifyingLogin': 'Verifying login status...',
  'browserAgent.log.noPendingTask': 'No pending task to execute',
  'browserAgent.log.stoppingTask': 'Stopping task...',
  'browserAgent.log.targetWebsite': 'target website',
  'browserAgent.log.taskBlockedError': 'Task blocked, please resolve login or CAPTCHA issue first',
  'browserAgent.log.noRunningTask': 'No task is currently running',
  'browserAgent.log.taskRunningCannotSwitch': 'Cannot switch mode while task is running',
  'browserAgent.log.switchedToManual': 'Switched to manual control mode',
  'browserAgent.log.completeLoginFirst': 'Please complete login first',
  'browserAgent.log.pageNotSuitable': 'Current page state is not suitable for automation',
  'browserAgent.log.switchedToAgent': 'Switched to Agent control mode',
  'browserAgent.log.taskBlockedWithReason': 'Task blocked: {reason}',
  'browserAgent.log.taskSavedForLater': 'Task saved, can be resumed after login',
  'browserAgent.log.alreadyExecutable': 'Status is already executable, no reset needed',
  'browserAgent.log.stateReset': 'Status reset, ready to execute new task',
  'browserAgent.log.browserModeSwitch': 'Browser switched to {mode} mode',
  'browserAgent.log.alreadyExpanded': 'Browser is already in expanded mode',
  'browserAgent.log.expandedToMain': 'Browser expanded to main workspace',
  'browserAgent.log.alreadyMini': 'Browser is already in mini mode',
  'browserAgent.log.dockedToPanel': 'Browser docked to right panel',
  'browserAgent.log.openPageFirst': 'Please open a web page first',
  'browserAgent.log.showMiniBrowser': 'Show mini browser',
  'browserAgent.log.hideBrowser': 'Hide browser',
  'browser.failureRecovery': 'Browser task failed',
  'browser.retryLastAction': 'Retry last action',
  'browser.continueFromCurrentPage': 'Continue from current page',
  'browser.takeOver': 'Take over browser',
  'browser.copyDiagnostics': 'Copy diagnostics',
  'browser.failedAction': 'Failed action',
};

export default enUS;
