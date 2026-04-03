import { Tool } from '../base/Tool';

/**
 * 工具注册表
 * 负责工具的注册、查找、执行
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private deferredTools: Set<string> = new Set();

  /**
   * 注册一个工具
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);

    // 注册别名
    if (tool.aliases) {
      for (const alias of tool.aliases) {
        this.tools.set(alias, tool);
      }
    }

    // 标记延迟加载的工具
    if (tool.shouldDefer) {
      this.deferredTools.add(tool.name);
    }
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values()).filter(
      (tool, index, arr) => arr.findIndex(t => t.name === tool.name) === index
    );
  }

  /**
   * 获取延迟加载的工具
   */
  getDeferredTools(): Tool[] {
    return Array.from(this.deferredTools).map(name => this.tools.get(name)!);
  }

  /**
   * 获取立即可用的工具 (非延迟)
   */
  getImmediateTools(): Tool[] {
    return this.getAll().filter(tool => !tool.shouldDefer);
  }

  /**
   * 搜索工具
   */
  search(query: string, maxResults: number = 5): Tool[] {
    const normalizedQuery = query.toLowerCase().trim();

    // 处理 select: 前缀
    if (normalizedQuery.startsWith('select:')) {
      const toolName = normalizedQuery.replace('select:', '');
      const tool = this.tools.get(toolName);
      return tool ? [tool] : [];
    }

    // 关键词匹配
    const scored = this.getAll().map(tool => {
      let score = 0;

      // 名称匹配
      if (tool.name.toLowerCase().includes(normalizedQuery)) {
        score += 10;
        if (tool.name.toLowerCase() === normalizedQuery) {
          score += 20;
        }
      }

      // 别名匹配
      if (tool.aliases?.some(a => a.toLowerCase().includes(normalizedQuery))) {
        score += 5;
      }

      // searchHint 匹配
      if (tool.searchHint?.toLowerCase().includes(normalizedQuery)) {
        score += 3;
      }

      return { tool, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(s => s.tool);
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 移除工具
   */
  unregister(name: string): void {
    const tool = this.tools.get(name);
    if (tool) {
      this.tools.delete(name);
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          this.tools.delete(alias);
        }
      }
      this.deferredTools.delete(name);
    }
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.tools.clear();
    this.deferredTools.clear();
  }
}

/**
 * 全局工具注册表实例
 */
export const toolRegistry = new ToolRegistry();
