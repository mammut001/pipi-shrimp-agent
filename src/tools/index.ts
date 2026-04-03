/**
 * 工具模块导出
 */

// 基础类型
export * from './base/Tool';

// 核心组件
export { ToolRegistry, toolRegistry } from './core/ToolRegistry';
export { ToolExecutor } from './core/ToolExecutor';

// 内置工具
export { fileReadTool, FileReadTool } from './impl/FileReadTool';
export { FileWriteTool, fileWriteTool } from './impl/FileWriteTool';
export { FileEditTool, fileEditTool } from './impl/FileEditTool';
export { BashTool, bashTool } from './impl/BashTool';
export { GlobTool, globTool } from './impl/GlobTool';
export { GrepTool, grepTool } from './impl/GrepTool';
export { WebSearchTool, webSearchTool } from './impl/WebSearchTool';
export { WebFetchTool, webFetchTool } from './impl/WebFetchTool';
export { SkillTool, skillTool } from './impl/SkillTool';
export {
  TaskTool,
  TaskCreateTool, TaskGetTool, TaskListTool,
  TaskUpdateTool, TaskStopTool, TaskOutputTool,
  taskStore
} from './impl/TaskTool';
export { TodoWriteTool, todoWriteTool, todoStore } from './impl/TodoWriteTool';
export { ToolSearchTool, toolSearchTool } from './impl/ToolSearchTool';
export { AskUserQuestionTool, askUserQuestionTool } from './impl/AskUserQuestionTool';
export { BriefTool, briefTool } from './impl/BriefTool';
export { ConfigTool, configTool } from './impl/ConfigTool';
export { REPLTool, replTool } from './impl/REPLTool';
export { RemoteTriggerTool, remoteTriggerTool } from './impl/RemoteTriggerTool';
export { SleepTool, sleepTool } from './impl/SleepTool';
export { SyntheticOutputTool, syntheticOutputTool } from './impl/SyntheticOutputTool';
export { LSPTool, lspTool } from './impl/LSPTool';

import { toolRegistry } from './core/ToolRegistry';
import { fileReadTool } from './impl/FileReadTool';
import { fileWriteTool } from './impl/FileWriteTool';
import { fileEditTool } from './impl/FileEditTool';
import { globTool } from './impl/GlobTool';
import { grepTool } from './impl/GrepTool';
import { bashTool } from './impl/BashTool';
import { webSearchTool } from './impl/WebSearchTool';
import { webFetchTool } from './impl/WebFetchTool';
import { skillTool } from './impl/SkillTool';
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool, TaskStopTool, TaskOutputTool } from './impl/TaskTool';
import { todoWriteTool } from './impl/TodoWriteTool';
import { toolSearchTool } from './impl/ToolSearchTool';
import { askUserQuestionTool } from './impl/AskUserQuestionTool';
import { briefTool } from './impl/BriefTool';
import { configTool } from './impl/ConfigTool';
import { replTool } from './impl/REPLTool';
import { remoteTriggerTool } from './impl/RemoteTriggerTool';
import { sleepTool } from './impl/SleepTool';
import { syntheticOutputTool } from './impl/SyntheticOutputTool';
import { lspTool } from './impl/LSPTool';

/**
 * 注册所有内置工具到全局注册表
 */
export function registerAllTools(): void {
  const tools = [
    // File operations
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    globTool,
    grepTool,

    // Shell
    bashTool,
    // Shell
    bashTool,

    // Web
    webSearchTool,
    webFetchTool,

    // Skills
    skillTool,

    // Tasks (register each sub-tool individually)
    new TaskCreateTool(),
    new TaskGetTool(),
    new TaskListTool(),
    new TaskUpdateTool(),
    new TaskStopTool(),
    new TaskOutputTool(),

    // Todos
    todoWriteTool,

    // Tool management
    toolSearchTool,

    // User interaction
    askUserQuestionTool,
    briefTool,
    configTool,

    // Misc
    replTool,
    remoteTriggerTool,
    sleepTool,
    syntheticOutputTool,

    // LSP
    lspTool,
  ];

  for (const tool of tools) {
    toolRegistry.register(tool);
  }
}

