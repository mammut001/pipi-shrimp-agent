/**
 * 中文翻译
 */

import type { TranslationKeys } from '../types';

const zhCN: TranslationKeys = {
  // 通用
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.delete': '删除',
  'common.loading': '加载中...',
  'common.error': '错误',
  'common.success': '成功',
  'common.retry': '重试',
  'common.close': '关闭',
  'common.or': '或',
  'common.preview': '预览',
  'common.copy': '复制',

  // 导航
  'nav.chat': '对话',
  'nav.workflow': '工作流',
  'nav.browser': '浏览器',
  'nav.skill': '技能',
  'nav.settings': '设置',
  'nav.newChat': '新建对话',
  'nav.sessions': '对话列表',
  'nav.noSessions': '暂无对话',

  // 设置页面
  'settings.title': '设置',
  'settings.apiConfig': 'API 配置',
  'settings.apiProvider': 'API 提供商',
  'settings.apiKey': 'API 密钥',
  'settings.apiKeyPlaceholder': '输入您的 API 密钥',
  'settings.model': '模型',
  'settings.language': '语言',
  'settings.languageDescription': '选择界面语言',
  'settings.theme': '主题',
  'settings.workingDir': '工作目录',
  'settings.saveSettings': '保存设置',
  'settings.tokenStats': 'Token 使用统计',
  'settings.tokenStatsDescription': '查看您的 API token 消耗情况',

  // 聊天页面
  'chat.inputPlaceholder': '输入消息...',
  'chat.send': '发送',
  'chat.stop': '停止',
  'chat.thinking': '思考中...',
  'chat.aiThinking': 'AI 正在思考...',
  'chat.tokenUsage': 'Token 使用量',
  'chat.newSession': '新建对话',
  'chat.sessionTokenUsage': '本次会话',
  'chat.input': '输入',
  'chat.output': '输出',
  'chat.total': '总计',
  'chat.noMessages': '暂无消息',
  'chat.startConversation': '开始对话吧',

  // 工具执行
  'tool.executing': '正在执行工具...',
  'tool.completed': '执行完成',
  'tool.failed': '执行失败',
  'tool.permissionRequired': '需要权限',
  'tool.allow': '允许',
  'tool.deny': '拒绝',
  'tool.allowExecution': '允许执行',
  'tool.executionFailed': '执行失败',

  // 错误消息
  'error.apiKeyMissing': '请在设置中添加 API 密钥',
  'error.networkError': '网络错误，请检查网络连接',
  'error.timeout': '请求超时，请重试',
  'error.unknown': '未知错误',
  'error.messageHistoryEmpty': '消息历史为空，无法继续对话',
  'error.noApiConfig': '未找到 API 配置，请在设置中添加 API 密钥',

  // 权限模式
  'permission.standard': '标准模式',
  'permission.bypass': '自动执行',
  'permission.autoEdits': '自动编辑',
  'permission.planOnly': '仅规划',
  'permission.description': '选择 AI 的执行权限模式',

  // 时间
  'time.justNow': '刚刚',
  'time.minutesAgo': '分钟前',
  'time.hoursAgo': '小时前',
  'time.yesterday': '昨天',

  // Token 统计
  'token.daily': '每日',
  'token.monthly': '月度',
  'token.byModel': '按模型',
  'token.selectMonth': '选择月份',
  'token.noData': '暂无数据',
  'token.input': '输入',
  'token.output': '输出',
  'token.total': '总计',
  'token.cost': '费用',
  'token.estimatedCost': '预估费用',
  'token.totalCost': '总费用',
  'token.disclaimer': '⚠️ 费用估算仅供参考。实际费用可能因缓存、批量折扣等因素有所不同。请前往设置页面配置您的模型定价以获取更准确的估算。',
  'token.resetConfirm': '确定要重置所有token使用统计吗？此操作不可撤销。',
  'token.resetSuccess': 'Token使用统计已重置',
  'token.resetFailed': '重置失败',
  'token.usageStats': 'Token 使用统计',
  'token.viewConsumption': '查看您的 API token 消耗和费用估算',
  'token.resetStats': '重置统计',
  'token.allApiKeys': '全部 API Key',
  'token.totalCostLabel': '总费用估算',
  'token.totalInput': '总输入',
  'token.totalOutput': '总输出',
  'token.loading': '加载中...',

  // Session
  'session.bindWorkDir': '绑定工作目录',
  'session.unbindWorkDir': '解绑工作目录',
  'session.workDirBound': '已绑定工作目录',
  'session.noWorkDir': '未绑定工作目录',
  'session.deleteSession': '删除对话',
  'session.renameSession': '重命名对话',

  // Swarm Memory
  'swarm.memory.teamMemory': '团队记忆',
  'swarm.memory.agentMemory': 'Agent 记忆',
  'swarm.memory.initSuccess': '记忆已初始化',
  'swarm.memory.initFailed': '记忆初始化失败',
  'swarm.memory.extractionComplete': '记忆提取完成',
  'swarm.memory.extractionFailed': '记忆提取失败',
  'swarm.memory.noMemories': '尚无保存的记忆',

  // Workflow
  'workflow.title': '工作流',
  'workflow.newWorkflow': '新工作流',
  'workflow.clearCanvas': '清空',
  'workflow.clearCanvasConfirm': '确定要清空画布吗？此操作不可恢复。',
  'workflow.clearCanvasWarning': '工作流将直接使用当前 Agent Task 配置运行',
  'workflow.run': '运行',
  'workflow.stop': '停止',
  'workflow.running': '运行中...',
  'workflow.ready': '就绪',
  'workflow.agentTask': 'Agent 任务',
  'workflow.agentTaskLabel': '任务标签',
  'workflow.agentTaskLabelPlaceholder': '如：撰写架构优化文档',
  'workflow.agentTaskLabelHint': '这个短标题会显示在画布节点上。',
  'workflow.taskPrompt': '任务 Prompt',
  'workflow.taskPromptPlaceholder': '例如：请写一个关于 PiPi Shrimp 当前架构和优化方向的调研报告。',
  'workflow.taskPromptHint': '这里写这次具体想让它产出的内容。发送给模型时，会和下面的任务指令一起组合。',
  'workflow.taskInstruction': '任务指令',
  'workflow.taskInstructionPlaceholder': '例如：请你写一份详细的 PiPi Shrimp 架构优化文档，重点说明当前问题、改造方向、影响范围和分阶段实施建议。',
  'workflow.taskInstructionHint': '这段会直接注入到该 Agent 的执行提示词里，适合写这个节点的固定职责模板。',
  'workflow.upstreamInfo': '当前会接收上游「{name}」的输出，然后基于它继续工作。',
  'workflow.upstreamNone': '当前是入口节点，没有上游输入，会直接根据 Workflow 的目标启动。',
  'workflow.entryNode': '入口节点（无上游）',
  'workflow.waitingUpstream': '等待上游完成',
  'workflow.waitingUpstreamHint': '此 Agent 将在以上所有上游执行完成后才启动',
  'workflow.inputSource': '输入来源',
  'workflow.agentName': 'Agent 名称',
  'workflow.agentNamePlaceholder': '如：Full Stack Developer',
  'workflow.systemPrompt': '系统提示词',
  'workflow.systemPromptPlaceholder': 'Agent 的系统提示词...',
  'workflow.executionMode': '执行模式',
  'workflow.singleExecution': '单次执行',
  'workflow.multiExecution': '多轮执行',
  'workflow.maxRounds': '最大轮数:',
  'workflow.stopCondition': '停止条件:',
  'workflow.untilComplete': '直到完成',
  'workflow.untilError': '直到错误',
  'workflow.fixedRounds': '固定轮数',
  'workflow.outputRoutes': '输出路由',
  'workflow.addRoute': '+ 添加路由',
  'workflow.onComplete': '完成时',
  'workflow.onError': '错误时',
  'workflow.outputContains': '输出包含',
  'workflow.always': '总是',
  'workflow.keywordPlaceholder': '关键词 (如 <PASS>)',
  'workflow.selectTargetAgent': '选择目标 Agent',
  'workflow.condition': '条件',
  'workflow.target': '目标',
  'workflow.agentConfig': 'Agent 配置',
  'workflow.noUpstream': '无上游（入口节点）',
  'workflow.save': '保存',
  'workflow.cancel': '取消',
  'workflow.delete': '删除',
  'workflow.confirm': '确认',
  'workflow.template': '预设模板',
  'workflow.loadTemplate': '从模板加载...',
  'workflow.presetChain': 'A→B→C 预设',
  'workflow.openWorkDir': '打开工作目录',
  'workflow.notInWorkflowPage': '请先进入 Workflow 页面，再操作工作流画布',
  'workflow.noWorkflowRunning': '当前没有正在运行的工作流，无法打开工作目录',
  'workflow.cannotOpenDir': '无法打开目录: {error}',
  'workflow.confirmClearCanvas': '确认清空画布？',
  'workflow.clearCanvasDesc': '这将删除所有 Agent 和连接。此操作不可撤销。',
  'workflow.agentNode': 'Agent 节点',
  'workflow.rounds': '轮',
  'workflow.usingGlobalConfig': '使用全局配置',
  'workflow.addApiConfigFirst': '请先在设置中添加 API 配置',
  'workflow.getModelListFirst': '请先获取模型列表',
  'workflow.cancelAdd': '取消添加',
  'workflow.agentConfigTitle': 'Agent 配置',

  // Workflow Output Panel
  'workflow.output.realTime': '实时输出',
  'workflow.output.files': '文件',
  'workflow.output.openWorkDir': '打开工作目录',
  'workflow.output.noAgents': '添加 Agent 后将显示输出',
  'workflow.output.noOutput': '无输出',
  'workflow.output.waiting': '等待输出...',
  'workflow.output.noFiles': '暂无输出文件',
  'workflow.output.waitingForFiles': '等待文件生成...',
  'workflow.output.previewing': '← 预览中',
  'workflow.output.runAfter': '运行工作流后将在此展示输出文件',
  'workflow.output.noWorkDir': '当前还没有可打开的工作目录',
  'workflow.output.cannotOpenWorkDir': '无法打开工作目录: {error}',
  'workflow.output.agentCount': '{done}/{total} agents',

  // Workflow Run History
  'workflow.history.title': '执行历史',
  'workflow.history.empty': '暂无执行记录',

  // File Preview
  'workflow.filePreview.loading': '加载中...',
  'workflow.filePreview.readFailed': '读取失败: {error}',
  'workflow.filePreview.empty': '文件为空',
  'workflow.filePreview.back': '返回配置',

  // Browser Panel
  'browser.title': '浏览器',
  'browser.connect': '连接',
  'browser.disconnect': '断开',
  'browser.connecting': '连接中...',
  'browser.notConnected': '未连接',
  'browser.refresh': '刷新',
  'browser.url': 'URL',
  'browser.back': '后退',
  'browser.forward': '前进',
  'browser.home': '主页',
  'browser.status.uninitialized': '未初始化',
  'browser.status.opening': '正在打开',
  'browser.status.idle': '空闲',
  'browser.status.inspecting': '检查中',
  'browser.status.needsLogin': '需要登录',
  'browser.status.waitingUserResume': '等待确认',
  'browser.status.readyForAgent': '可执行任务',
  'browser.status.running': '执行中',
  'browser.status.blockedAuth': '认证被阻止',
  'browser.status.blockedCaptcha': '需要验证码',
  'browser.status.blockedManualStep': '需要手动确认',
  'browser.status.completed': '已完成',
  'browser.status.error': '错误',
  'browser.status.unknown': '未知',
  'browser.manualControl': '手动控制',
  'browser.agentControl': 'Agent 控制',
  'browser.windowOpened': '● 窗口已打开',
  'browser.returnToChat': '返回聊天',
  'browser.returnToPreviousPage': '返回上一页',
  'browser.expandToSplit': '展开到分屏',
  'browser.openNewWindow': '打开新窗口',
  'browser.close': '关闭',
  'browser.openWindow': '打开窗口',
  'browser.currentPage': '当前页面:',
  'browser.quickTasks': '快捷任务',
  'browser.hideHistory': '隐藏历史',
  'browser.showHistory': '查看历史',
  'browser.enterTaskInstruction': '输入任务指令 (例如: 点击登录按钮)',
  'browser.pleaseOpenBrowserFirst': '请先打开浏览器窗口',
  'browser.stop': '停止',
  'browser.resetStatus': '重置状态',
  'browser.execute': '执行',
  'browser.executionLog': '执行日志',
  'browser.clear': '清空',
  'browser.waitingForExecution': '等待任务执行...',
  'browser.pleaseCompleteLoginFirst': '请在浏览器窗口中完成登录后，点击下方按钮验证登录状态',
  'browser.refreshAndCheck': '刷新检查',
  'browser.iHaveLoggedIn': '我已登录',
  'browser.forceContinue': '强制继续',
  'browser.skipVerificationAndContinue': '跳过验证，直接继续执行',
  'browser.operationBlocked': '操作被阻止',
  'browser.pleaseCompleteOperationInBrowser': '请在浏览器窗口中完成必要的操作，然后重试。',
  'browser.recheck': '重新检查',
  'browser.switchToManual': '切换到手动',
  'browser.pageReadyForAutomation': '页面已就绪，可以执行自动化任务',
  'browser.matchedSite': '匹配站点',
  'browser.unknownSite': '未知',
  'browser.quickTask.extractHeadlines': '提取头条新闻标题',
  'browser.quickTask.findTechNews': '找出科技/AI相关新闻',
  'browser.quickTask.listCategories': '列出所有新闻分类',
  'browser.quickTask.findHotPosts': '找出热门帖子',
  'browser.quickTask.searchDiscussions': '搜索相关讨论',
  'browser.quickTask.extractComments': '提取评论概要',
  'browser.quickTask.findHotRepos': '找出热门仓库',
  'browser.quickTask.searchProjects': '搜索开源项目',
  'browser.quickTask.extractProjectInfo': '提取项目信息',
  'browser.quickTask.extractVideoTitle': '提取视频标题',
  'browser.quickTask.findRelatedRecommendations': '找出相关推荐',
  'browser.quickTask.getVideoDescription': '获取视频描述',
  'browser.quickTask.searchContacts': '搜索联系人',
  'browser.quickTask.sendTestMessage': '发送测试消息',
  'browser.quickTask.getRecentChats': '获取最近对话',
  'browser.quickTask.searchProducts': '搜索产品',
  'browser.quickTask.extractPriceInfo': '提取价格信息',
  'browser.quickTask.compareReviews': '比较产品评价',
  'browser.quickTask.extractMainContent': '提取页面主要内容',
  'browser.quickTask.findImportantInfo': '找出重要信息',
  'browser.quickTask.summarizePage': '总结页面要点',
  'browser.quickSite.cbc': 'CBC',
  'browser.quickSite.googleNews': 'Google News',
  'browser.quickSite.reddit': 'Reddit',
  'browser.quickSite.github': 'GitHub',
  'browser.quickSite.hn': 'HN',
  'browser.quickSite.twitter': 'Twitter',
  'browser.quickSite.youtube': 'YouTube',
  'browser.quickSite.whatsapp': 'WhatsApp',

  // Browser Mini Preview
  'browserMiniPreview.cannotRunMissingContext': '无法运行：缺少任务上下文。请从聊天中发起任务，或连接 Chrome 后在此输入 URL。',
  'browserMiniPreview.agentRunning': 'Agent 正在运行',
  'browserMiniPreview.enterTargetUrl': '输入目标 URL（如 example.com）',
  'browserMiniPreview.loginInWindow': '在窗口中登录',
  'browserMiniPreview.refreshAndCheck': '刷新检查',
  'browserMiniPreview.iHaveLoggedIn': '我已登录',
  'browserMiniPreview.skipVerification': '跳过验证，直接继续执行',
  'browserMiniPreview.forceContinue': '强制继续',

  // Skill Page
  'skill.title': '技能',
  'skill.marketplace': '技能市场',
  'skill.mySkills': '我的技能',
  'skill.noSkills': '暂无技能',
  'skill.install': '安装',
  'skill.uninstall': '卸载',
  'skill.backToChat': '返回聊天',
  'skill.addCustomSkill': '添加自定义 Skill',
  'skill.searchPlaceholder': '搜索 Skill...',
  'skill.edit': '编辑',
  'skill.delete': '删除',
  'skill.notFound': '未找到',
  'skill.tryOtherSearchTerms': '尝试其他搜索词',
  'skill.editSkill': '编辑 Skill',
  'skill.addCustomSkillModal': '添加自定义 Skill',
  'skill.name': '名称',
  'skill.namePlaceholder': '例如：PDF 分析器',
  'skill.description': '描述',
  'skill.descriptionPlaceholder': '例如：读取 PDF，提取文本、表格、元数据',
  'skill.iconPreview': '图标预览',
  'skill.iconPreviewHint': '鼠标悬停在技能卡片上可以看到编辑按钮',
  'skill.cancel': '取消',
  'skill.saveChanges': '保存修改',
  'skill.addSkill': '添加 Skill',

  // Skill Documentation Content
  'skill.pdf.name': 'PDF 分析器',
  'skill.pdf.description': '读取 PDF，提取文本、表格、元数据',
  'skill.pdf.documentation': `# PDF 分析器

智能 PDF 文档分析工具，可以：
- 提取文本内容
- 识别表格结构
- 获取文档元数据
- 处理多页文档

## 快速开始

选择 PDF 文件后，工具会自动分析文档结构并提取相关信息。

## 功能特性

- 支持扫描的 PDF（OCR）
- 表格识别和提取
- 元数据读取
- 批量处理`,

  'skill.docx.name': 'Word 文档',
  'skill.docx.description': '创建和编辑 Word 文档',
  'skill.docx.documentation': `# Word 文档处理器

创建和编辑 Microsoft Word 文档（.docx）

## 功能

- 创建新文档
- 添加段落、标题、列表
- 插入表格和图片
- 设置页面样式
- 导出为 PDF

## 使用示例

工具支持：
- 文本格式化（加粗、斜体、下划线）
- 页面设置（页边距、纸张大小）
- 页码和页眉页脚
- 目录生成`,

  'skill.xlsx.name': '数据统计',
  'skill.xlsx.description': '处理 CSV/JSON/Excel，生成报告',
  'skill.xlsx.documentation': `# 数据统计分析工具

处理电子表格数据，支持 CSV、JSON 和 Excel 格式。

## 功能

- 导入多种数据格式
- 数据清理和转换
- 统计分析和汇总
- 图表生成
- 报告输出

## 支持的操作

- 数据透视表
- 公式计算
- 条件格式化
- 数据验证
- 自动排序和筛选`,

  'skill.resume.name': '简历生成器',
  'skill.resume.description': '基于 Typst 的专业简历生成，一键排版',
  'skill.resume.documentation': `# 简历生成器

利用先进的 Typst 排版引擎，将你的经历转化为专业级的 PDF 简历。

## 功能特性
- **自动排版**：只需提供文字，AI 自动处理间距和对齐
- **Typst 引擎**：原生 Rust 渲染，速度极快且质量极高
- **现代设计**：内置经典、专业的简历模板`,

  'skill.skillCreator.name': 'Skill 创建器',
  'skill.skillCreator.description': '创建和优化自定义 skills',
  'skill.skillCreator.documentation': `# Skill 创建器

开发和优化自定义 skills

## 创建新 Skill

1. 点击"添加自定义 Skill"按钮
2. 输入 skill 名称和描述
3. 选择图标
4. 保存 skill

## 编辑 Skill

- 鼠标悬停在 skill 卡片上
- 点击编辑按钮修改信息
- 或点击删除按钮移除 skill

## Skill 最佳实践

- 命名清晰明了
- 描述详细准确
- 图标简洁易识别`,

  'skill.autoresearch.name': 'AutoResearch',
  'skill.autoresearch.description': '自动实验循环 — SSH 远程训练与指标驱动优化',
  'skill.autoresearch.documentation': `# AutoResearch

自主实验循环，用于 ML 训练迭代与超参数优化。

## 功能

- 通过 SSH 在远程 VPS 上执行训练命令
- 根据指标变化自动进入下一轮实验
- 记录实验日志，支持失败回滚（基于 git）
- 在右侧面板实时查看实验状态与输出

## 使用方式

1. 点击 **在 Chat 中打开** 进入 Chat 视图
2. 系统会打开 AutoResearch 面板并弹出配置弹窗
3. 完成 SSH 与实验参数后启动循环

## 架构

- 循环引擎每轮构建系统提示词
- Agent 使用 ssh_exec / ssh_upload_file 工具执行实验
- 解析结果并记录；改进的实验提交，失败的回滚`,
  'skill.autoresearch.openInChat': '在 Chat 中打开',

  // Typst Preview
  'typst.title': '文档预览',
  'typst.render': '渲染',
  'typst.rendering': '渲染中...',
  'typst.renderFailed': '渲染失败',
  'typst.download': '下载',

  // Permission Modal
  'permission.title': '权限请求',
  'permission.request': '请求权限',
  'permission.riskLevel': '风险等级',
  'permission.low': '低',
  'permission.medium': '中',
  'permission.high': '高',
  'permission.args': '参数',
  'permission.allow': '允许',
  'permission.deny': '拒绝',
  'permission.allowAll': '全部允许',
  'permission.denyAll': '全部拒绝',

  // Chat Input
  'chat.input.dropFiles': '拖拽文件到此处',
  'chat.input.attachFile': '附件',
  'chat.input.filesAddedToSession': '{count} 个文件已添加到当前 session',
  'chat.input.filesImported': '{count} 个文件已导入',
  'chat.input.filesSelected': '已选择文件',
  'chat.input.dragFilesHere': '拖放文件到此处',
  'chat.input.filesWillBeAddedToList': '松手后文件将添加到列表',
  'chat.input.removeFile': '移除文件',
  'chat.input.confirmImportFiles': '确认导入 {count} 个文件',
  'chat.input.clearList': '清空列表',
  'chat.input.or': '或',
  'chat.input.selectFiles': '选择文件',
  'chat.input.pressEscToCancel': '按 Esc 取消',
  'chat.input.cancel': '取消',

  // Sidebar
  'sidebar.newWorkflow': '新工作流',
  'sidebar.sessions': '会话列表',
  'sidebar.workflows': '工作流',
  'sidebar.noWorkflows': '暂无工作流',
  'sidebar.createFirst': '点击上方按钮创建第一个工作流',

  // Notification
  'notification.workflowCreated': '工作流已创建',
  'notification.workflowDeleted': '工作流已删除',
  'notification.workflowRenamed': '工作流已重命名',
  'notification.agentAdded': 'Agent 已添加',
  'notification.agentDeleted': 'Agent 已删除',
  'notification.connectionAdded': '连接已添加',
  'notification.connectionDeleted': '连接已删除',
  'notification.runStarted': '工作流开始运行',
  'notification.runCompleted': '工作流运行完成',
  'notification.runFailed': '工作流运行失败',
  'notification.stopped': '已停止',
};

export default zhCN;
