import type { Artifact } from '../../types/chat';

export function createBrowserResultMessages(originalQuery: string): Array<{ role: 'user'; content: string }> {
  return [
    { role: 'user', content: originalQuery || '请根据浏览器获取到的数据回答问题。' },
  ];
}

export function appendBrowserResultToSystemPrompt(
  baseSystemPrompt: string,
  originalQuery: string,
  browserResult: string,
  sessionWorkDir?: string,
): string {
  let systemPrompt = baseSystemPrompt;

  if (sessionWorkDir) {
    systemPrompt += `\n\n## Working Directory\n\nYour working directory: \`${sessionWorkDir}\``;
  }

  return `${systemPrompt}\n\n---\n## 浏览器代理任务结果\n用户的问题是："${originalQuery}"\n\n浏览器代理获取到的数据：\n${browserResult}\n\n请根据以上数据，用自然的语言直接回答用户的问题。不要提及"浏览器代理"或内部流程，直接给出结果即可。`;
}

export function mapBrowserResponseArtifacts(
  artifacts: Array<{ type: string; content: string; title?: string; language?: string }> | undefined,
  createId: () => string,
): Artifact[] | undefined {
  return artifacts?.map((artifact) => ({
    id: createId(),
    type: artifact.type as Artifact['type'],
    content: artifact.content,
    title: artifact.title,
    language: artifact.language,
  }));
}
