import { type WorkflowAgent } from '@/types/workflow';
import { workflowRunFileService } from '@/services/workflow/runFileService';
import {
  renderTranscriptFile,
  type WorkflowTranscriptEntry,
} from './transcript';
import { extractCodeBlockArtifacts } from './codeBlockArtifacts';
import { type WorkflowEngineDeps } from './engineDeps';

/** Host surface needed by run-directory persistence helpers. */
export interface RunPersistenceHost {
  workingDirectory: string;
  deps: WorkflowEngineDeps;
  shouldAcceptRunMutation(runId: string): boolean;
  getTranscriptEntries(agentId: string): WorkflowTranscriptEntry[];
}

export async function writeRunFile(
  host: RunPersistenceHost,
  relativePath: string,
  content: string,
): Promise<string | null> {
  if (!host.workingDirectory) return null;
  if (host.deps.writeRunFile) {
    return host.deps.writeRunFile(host.workingDirectory, relativePath, content);
  }

  if (host.deps.writeFile) {
    const absolutePath = workflowRunFileService.resolvePath(host.workingDirectory, relativePath);
    await host.deps.writeFile(absolutePath, content);
    return absolutePath;
  }

  return null;
}

export async function persistOutputCodeArtifacts(
  host: RunPersistenceHost,
  output: string,
): Promise<void> {
  if (!host.workingDirectory) return;
  const artifacts = extractCodeBlockArtifacts(output);
  for (const artifact of artifacts) {
    try {
      const savedPath = await writeRunFile(host, artifact.relativePath, artifact.content);
      // eslint-disable-next-line no-console
      console.info(`[workflow] Persisted code artifact: ${artifact.relativePath} -> ${savedPath ?? 'none'}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to persist output code artifact ${artifact.relativePath}:`, err);
    }
  }
}

export async function saveOutputToFile(
  host: RunPersistenceHost,
  agent: WorkflowAgent,
  artifactBaseName: string,
  output: string,
  runId: string,
): Promise<string | null> {
  if (!host.shouldAcceptRunMutation(runId)) return null;
  const content = `<!--
Agent: ${agent.name}
Executed: ${new Date(host.deps.now()).toLocaleString()}
Run ID: ${runId}
-->

${output}
`;
  const savedPath = await writeRunFile(host, `${artifactBaseName}-output.md`, content);
  // eslint-disable-next-line no-console
  console.info(`[workflow] Saved output file for agent "${agent.name}" (${agent.id}): ${savedPath ?? 'none'}`);
  return savedPath;
}

export async function saveTranscriptToFile(
  host: RunPersistenceHost,
  agent: WorkflowAgent,
  artifactBaseName: string,
  runId: string,
): Promise<string | null> {
  if (!host.shouldAcceptRunMutation(runId)) return null;
  const entries = host.getTranscriptEntries(agent.id);
  if (entries.length === 0) return null;
  const content = renderTranscriptFile(agent.id, runId, entries);
  const savedPath = await writeRunFile(host, `${artifactBaseName}-transcript.md`, content);
  // eslint-disable-next-line no-console
  console.info(`[workflow] Saved transcript file for agent "${agent.name}" (${agent.id}): ${savedPath ?? 'none'}`);
  return savedPath;
}
