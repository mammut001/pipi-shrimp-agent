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

  // Navigation
  'nav.chat': 'Chat',
  'nav.workflow': 'Workflow',
  'nav.browser': 'Browser',
  'nav.skill': 'Skill',
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
  'token.totalCostLabel': 'Total Estimated Cost',
  'token.totalInput': 'Total Input',
  'token.totalOutput': 'Total Output',
  'token.loading': 'Loading...',

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
  'workflow.keywordPlaceholder': 'Keyword (e.g. <PASS>)',
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
  'browser.returnToChat': 'Return to chat',
  'browser.returnToPreviousPage': 'Go back',
  'browser.expandToSplit': 'Expand to split',
  'browser.openNewWindow': 'Open new window',
  'browser.close': 'Close',
  'browser.openWindow': 'Open window',
  'browser.currentPage': 'Current page:',
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
  'browser.iHaveLoggedIn': 'I have logged in',
  'browser.forceContinue': 'Force continue',
  'browser.skipVerificationAndContinue': 'Skip verification and continue',
  'browser.operationBlocked': 'Operation blocked',
  'browser.pleaseCompleteOperationInBrowser': 'Please complete the necessary operations in the browser window, then try again.',
  'browser.recheck': 'Recheck',
  'browser.switchToManual': 'Switch to manual',
  'browser.pageReadyForAutomation': 'Page is ready, automation tasks can be executed',
  'browser.matchedSite': 'Matched site',
  'browser.unknownSite': 'Unknown',
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
  'chat.input.dragFilesHere': 'Drag files here',
  'chat.input.filesWillBeAddedToList': 'Files will be added to the list when released',
  'chat.input.removeFile': 'Remove file',
  'chat.input.confirmImportFiles': 'Confirm import {count} files',
  'chat.input.clearList': 'Clear list',
  'chat.input.or': 'or',
  'chat.input.selectFiles': 'Select files',
  'chat.input.pressEscToCancel': 'Press Esc to cancel',
  'chat.input.cancel': 'Cancel',

  // Sidebar
  'sidebar.newWorkflow': 'New Workflow',
  'sidebar.sessions': 'Sessions',
  'sidebar.workflows': 'Workflows',
  'sidebar.noWorkflows': 'No workflows yet',
  'sidebar.createFirst': 'Click the button above to create your first workflow',

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
};

export default enUS;
