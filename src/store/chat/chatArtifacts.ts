export interface ToolArtifactResult {
  id: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
}

export interface ArtifactDetectorModule {
  detectAndRegisterArtifacts: (context: {
    messageId: string;
    toolName: string;
    toolArgs: string;
    toolResultText: string;
    workDir?: string;
    outputDir?: string;
  }) => void | Promise<void>;
}

export async function registerArtifactsFromToolResults(
  loadDetector: () => Promise<ArtifactDetectorModule>,
  messageId: string,
  results: ToolArtifactResult[],
  workDir?: string | null,
  outputDir?: string | null,
): Promise<void> {
  const { detectAndRegisterArtifacts } = await loadDetector();

  for (const result of results) {
    await detectAndRegisterArtifacts({
      messageId,
      toolName: result.toolName || '',
      toolArgs: result.toolArgs || '',
      toolResultText: result.content,
      workDir: workDir || undefined,
      outputDir: outputDir || undefined,
    });
  }
}
