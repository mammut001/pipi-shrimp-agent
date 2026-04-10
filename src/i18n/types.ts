/**
 * i18n 类型定义
 */

/** 支持的语言 */
export type Locale = 'zh-CN' | 'en-US';

/** 翻译键值对 */
export type TranslationKeys = {
  // 通用
  'common.confirm': string;
  'common.cancel': string;
  'common.save': string;
  'common.delete': string;
  'common.loading': string;
  'common.error': string;
  'common.success': string;
  'common.retry': string;
  'common.close': string;
  'common.or': string;
  'common.preview': string;
  'common.copy': string;

  // 导航
  'nav.chat': string;
  'nav.workflow': string;
  'nav.browser': string;
  'nav.skill': string;
  'nav.settings': string;
  'nav.newChat': string;
  'nav.sessions': string;
  'nav.noSessions': string;

  // 设置页面
  'settings.title': string;
  'settings.apiConfig': string;
  'settings.apiProvider': string;
  'settings.apiKey': string;
  'settings.apiKeyPlaceholder': string;
  'settings.model': string;
  'settings.language': string;
  'settings.languageDescription': string;
  'settings.theme': string;
  'settings.workingDir': string;
  'settings.saveSettings': string;
  'settings.tokenStats': string;
  'settings.tokenStatsDescription': string;

  // 聊天页面
  'chat.inputPlaceholder': string;
  'chat.send': string;
  'chat.stop': string;
  'chat.thinking': string;
  'chat.aiThinking': string;
  'chat.tokenUsage': string;
  'chat.newSession': string;
  'chat.sessionTokenUsage': string;
  'chat.input': string;
  'chat.output': string;
  'chat.total': string;
  'chat.noMessages': string;
  'chat.startConversation': string;

  // 工具执行
  'tool.executing': string;
  'tool.completed': string;
  'tool.failed': string;
  'tool.permissionRequired': string;
  'tool.allow': string;
  'tool.deny': string;
  'tool.allowExecution': string;
  'tool.executionFailed': string;

  // 错误消息
  'error.apiKeyMissing': string;
  'error.networkError': string;
  'error.timeout': string;
  'error.unknown': string;
  'error.messageHistoryEmpty': string;
  'error.noApiConfig': string;

  // 权限模式
  'permission.standard': string;
  'permission.bypass': string;
  'permission.autoEdits': string;
  'permission.planOnly': string;
  'permission.description': string;

  // 时间
  'time.justNow': string;
  'time.minutesAgo': string;
  'time.hoursAgo': string;
  'time.yesterday': string;

  // Token 统计
  'token.daily': string;
  'token.monthly': string;
  'token.byModel': string;
  'token.selectMonth': string;
  'token.noData': string;
  'token.input': string;
  'token.output': string;
  'token.total': string;
  'token.cost': string;
  'token.estimatedCost': string;
  'token.totalCost': string;
  'token.disclaimer': string;
  'token.resetConfirm': string;
  'token.resetSuccess': string;
  'token.resetFailed': string;
  'token.usageStats': string;
  'token.viewConsumption': string;
  'token.resetStats': string;
  'token.totalCostLabel': string;
  'token.totalInput': string;
  'token.totalOutput': string;
  'token.loading': string;

  // Session
  'session.bindWorkDir': string;
  'session.unbindWorkDir': string;
  'session.workDirBound': string;
  'session.noWorkDir': string;
  'session.deleteSession': string;
  'session.renameSession': string;

  // Swarm Memory
  'swarm.memory.teamMemory': string;
  'swarm.memory.agentMemory': string;
  'swarm.memory.initSuccess': string;
  'swarm.memory.initFailed': string;
  'swarm.memory.extractionComplete': string;
  'swarm.memory.extractionFailed': string;
  'swarm.memory.noMemories': string;

  // Workflow
  'workflow.title': string;
  'workflow.newWorkflow': string;
  'workflow.clearCanvas': string;
  'workflow.clearCanvasConfirm': string;
  'workflow.clearCanvasWarning': string;
  'workflow.run': string;
  'workflow.stop': string;
  'workflow.running': string;
  'workflow.ready': string;
  'workflow.agentTask': string;
  'workflow.agentTaskLabel': string;
  'workflow.agentTaskLabelPlaceholder': string;
  'workflow.agentTaskLabelHint': string;
  'workflow.taskPrompt': string;
  'workflow.taskPromptPlaceholder': string;
  'workflow.taskPromptHint': string;
  'workflow.taskInstruction': string;
  'workflow.taskInstructionPlaceholder': string;
  'workflow.taskInstructionHint': string;
  'workflow.upstreamInfo': string;
  'workflow.upstreamNone': string;
  'workflow.entryNode': string;
  'workflow.waitingUpstream': string;
  'workflow.waitingUpstreamHint': string;
  'workflow.inputSource': string;
  'workflow.agentName': string;
  'workflow.agentNamePlaceholder': string;
  'workflow.systemPrompt': string;
  'workflow.systemPromptPlaceholder': string;
  'workflow.executionMode': string;
  'workflow.singleExecution': string;
  'workflow.multiExecution': string;
  'workflow.maxRounds': string;
  'workflow.stopCondition': string;
  'workflow.untilComplete': string;
  'workflow.untilError': string;
  'workflow.fixedRounds': string;
  'workflow.outputRoutes': string;
  'workflow.addRoute': string;
  'workflow.onComplete': string;
  'workflow.onError': string;
  'workflow.outputContains': string;
  'workflow.always': string;
  'workflow.keywordPlaceholder': string;
  'workflow.selectTargetAgent': string;
  'workflow.condition': string;
  'workflow.target': string;
  'workflow.agentConfig': string;
  'workflow.noUpstream': string;
  'workflow.save': string;
  'workflow.cancel': string;
  'workflow.delete': string;
  'workflow.confirm': string;
  'workflow.template': string;
  'workflow.loadTemplate': string;
  'workflow.presetChain': string;
  'workflow.openWorkDir': string;
  'workflow.notInWorkflowPage': string;
  'workflow.noWorkflowRunning': string;
  'workflow.cannotOpenDir': string;
  'workflow.confirmClearCanvas': string;
  'workflow.clearCanvasDesc': string;
  'workflow.agentNode': string;
  'workflow.rounds': string;
  'workflow.usingGlobalConfig': string;
  'workflow.addApiConfigFirst': string;
  'workflow.getModelListFirst': string;
  'workflow.cancelAdd': string;
  'workflow.agentConfigTitle': string;

  // Workflow Output Panel
  'workflow.output.realTime': string;
  'workflow.output.files': string;
  'workflow.output.openWorkDir': string;
  'workflow.output.noAgents': string;
  'workflow.output.noOutput': string;
  'workflow.output.waiting': string;
  'workflow.output.noFiles': string;
  'workflow.output.waitingForFiles': string;
  'workflow.output.previewing': string;
  'workflow.output.runAfter': string;
  'workflow.output.noWorkDir': string;
  'workflow.output.cannotOpenWorkDir': string;
  'workflow.output.agentCount': string;

  // Workflow Run History
  'workflow.history.title': string;
  'workflow.history.empty': string;

  // File Preview
  'workflow.filePreview.loading': string;
  'workflow.filePreview.readFailed': string;
  'workflow.filePreview.empty': string;
  'workflow.filePreview.back': string;

  // Browser Panel
  'browser.title': string;
  'browser.connect': string;
  'browser.disconnect': string;
  'browser.connecting': string;
  'browser.notConnected': string;
  'browser.refresh': string;
  'browser.url': string;
  'browser.back': string;
  'browser.forward': string;
  'browser.home': string;
  'browser.quickSite.cbc': string;
  'browser.quickSite.googleNews': string;
  'browser.quickSite.reddit': string;
  'browser.quickSite.github': string;
  'browser.quickSite.hn': string;
  'browser.quickSite.twitter': string;
  'browser.quickSite.youtube': string;
  'browser.quickSite.whatsapp': string;
  'browser.status.uninitialized': string;
  'browser.status.opening': string;
  'browser.status.idle': string;
  'browser.status.inspecting': string;
  'browser.status.needsLogin': string;
  'browser.status.waitingUserResume': string;
  'browser.status.readyForAgent': string;
  'browser.status.running': string;
  'browser.status.blockedAuth': string;
  'browser.status.blockedCaptcha': string;
  'browser.status.blockedManualStep': string;
  'browser.status.completed': string;
  'browser.status.error': string;
  'browser.status.unknown': string;
  'browser.manualControl': string;
  'browser.agentControl': string;
  'browser.windowOpened': string;
  'browser.returnToChat': string;
  'browser.returnToPreviousPage': string;
  'browser.expandToSplit': string;
  'browser.openNewWindow': string;
  'browser.close': string;
  'browser.openWindow': string;
  'browser.currentPage': string;
  'browser.quickTasks': string;
  'browser.hideHistory': string;
  'browser.showHistory': string;
  'browser.enterTaskInstruction': string;
  'browser.pleaseOpenBrowserFirst': string;
  'browser.stop': string;
  'browser.resetStatus': string;
  'browser.execute': string;
  'browser.executionLog': string;
  'browser.clear': string;
  'browser.waitingForExecution': string;
  'browser.pleaseCompleteLoginFirst': string;
  'browser.refreshAndCheck': string;
  'browser.iHaveLoggedIn': string;
  'browser.forceContinue': string;
  'browser.skipVerificationAndContinue': string;
  'browser.operationBlocked': string;
  'browser.pleaseCompleteOperationInBrowser': string;
  'browser.recheck': string;
  'browser.switchToManual': string;
  'browser.pageReadyForAutomation': string;
  'browser.matchedSite': string;
  'browser.unknownSite': string;
  'browser.quickTask.extractHeadlines': string;
  'browser.quickTask.findTechNews': string;
  'browser.quickTask.listCategories': string;
  'browser.quickTask.findHotPosts': string;
  'browser.quickTask.searchDiscussions': string;
  'browser.quickTask.extractComments': string;
  'browser.quickTask.findHotRepos': string;
  'browser.quickTask.searchProjects': string;
  'browser.quickTask.extractProjectInfo': string;
  'browser.quickTask.extractVideoTitle': string;
  'browser.quickTask.findRelatedRecommendations': string;
  'browser.quickTask.getVideoDescription': string;
  'browser.quickTask.searchContacts': string;
  'browser.quickTask.sendTestMessage': string;
  'browser.quickTask.getRecentChats': string;
  'browser.quickTask.searchProducts': string;
  'browser.quickTask.extractPriceInfo': string;
  'browser.quickTask.compareReviews': string;
  'browser.quickTask.extractMainContent': string;
  'browser.quickTask.findImportantInfo': string;
  'browser.quickTask.summarizePage': string;

  // Browser Mini Preview
  'browserMiniPreview.cannotRunMissingContext': string;
  'browserMiniPreview.agentRunning': string;
  'browserMiniPreview.enterTargetUrl': string;
  'browserMiniPreview.loginInWindow': string;
  'browserMiniPreview.refreshAndCheck': string;
  'browserMiniPreview.iHaveLoggedIn': string;
  'browserMiniPreview.skipVerification': string;
  'browserMiniPreview.forceContinue': string;

  // Skill Page
  'skill.title': string;
  'skill.marketplace': string;
  'skill.mySkills': string;
  'skill.noSkills': string;
  'skill.install': string;
  'skill.uninstall': string;
  'skill.backToChat': string;
  'skill.addCustomSkill': string;
  'skill.searchPlaceholder': string;
  'skill.edit': string;
  'skill.delete': string;
  'skill.notFound': string;
  'skill.tryOtherSearchTerms': string;
  'skill.editSkill': string;
  'skill.addCustomSkillModal': string;
  'skill.name': string;
  'skill.namePlaceholder': string;
  'skill.description': string;
  'skill.descriptionPlaceholder': string;
  'skill.iconPreview': string;
  'skill.iconPreviewHint': string;
  'skill.cancel': string;
  'skill.saveChanges': string;
  'skill.addSkill': string;

  // Skill Documentation Content
  'skill.pdf.name': string;
  'skill.pdf.description': string;
  'skill.pdf.documentation': string;
  'skill.docx.name': string;
  'skill.docx.description': string;
  'skill.docx.documentation': string;
  'skill.xlsx.name': string;
  'skill.xlsx.description': string;
  'skill.xlsx.documentation': string;
  'skill.resume.name': string;
  'skill.resume.description': string;
  'skill.resume.documentation': string;
  'skill.skillCreator.name': string;
  'skill.skillCreator.description': string;
  'skill.skillCreator.documentation': string;

  // Typst Preview
  'typst.title': string;
  'typst.render': string;
  'typst.rendering': string;
  'typst.renderFailed': string;
  'typst.download': string;

  // Permission Modal
  'permission.title': string;
  'permission.request': string;
  'permission.riskLevel': string;
  'permission.low': string;
  'permission.medium': string;
  'permission.high': string;
  'permission.args': string;
  'permission.allow': string;
  'permission.deny': string;
  'permission.allowAll': string;
  'permission.denyAll': string;

  // Chat Input
  'chat.input.dropFiles': string;
  'chat.input.attachFile': string;
  'chat.input.filesAddedToSession': string;
  'chat.input.filesImported': string;
  'chat.input.filesSelected': string;
  'chat.input.dragFilesHere': string;
  'chat.input.filesWillBeAddedToList': string;
  'chat.input.removeFile': string;
  'chat.input.confirmImportFiles': string;
  'chat.input.clearList': string;
  'chat.input.or': string;
  'chat.input.selectFiles': string;
  'chat.input.pressEscToCancel': string;
  'chat.input.cancel': string;

  // Sidebar
  'sidebar.newWorkflow': string;
  'sidebar.sessions': string;
  'sidebar.workflows': string;
  'sidebar.noWorkflows': string;
  'sidebar.createFirst': string;

  // Notification
  'notification.workflowCreated': string;
  'notification.workflowDeleted': string;
  'notification.workflowRenamed': string;
  'notification.agentAdded': string;
  'notification.agentDeleted': string;
  'notification.connectionAdded': string;
  'notification.connectionDeleted': string;
  'notification.runStarted': string;
  'notification.runCompleted': string;
  'notification.runFailed': string;
  'notification.stopped': string;
};
