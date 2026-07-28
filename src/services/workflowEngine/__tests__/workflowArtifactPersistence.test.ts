import { describe, expect, it, jest } from '@jest/globals';
import { extractCodeBlockArtifacts, WorkflowEngine } from '../engine';
import { useWorkflowStore } from '@/store/workflowStore';
import type { WorkflowInstance } from '@/types/workflow';

describe('Workflow Artifact Persistence & Tool Protocol Protocol', () => {
  it('extracts code block artifacts with filename annotations', () => {
    const text = `
I have designed the scaffold and configuration:

\`\`\`python 02_scaffold.py
def main():
    print("Scaffold initialized")

if __name__ == "__main__":
    main()
\`\`\`

\`\`\`json 02_scaffold.json
{
  "name": "scaffold",
  "version": "1.0.0"
}
\`\`\`

### IMPLEMENTATION_NOTES.md
\`\`\`markdown
# Implementation Notes
- Step 1 complete
- Step 2 in progress
\`\`\`
`;

    const artifacts = extractCodeBlockArtifacts(text);
    expect(artifacts).toHaveLength(3);
    expect(artifacts[0].relativePath).toBe('02_scaffold.py');
    expect(artifacts[0].content).toContain('def main():');

    expect(artifacts[1].relativePath).toBe('02_scaffold.json');
    expect(artifacts[1].content).toContain('"name": "scaffold"');

    expect(artifacts[2].relativePath).toBe('IMPLEMENTATION_NOTES.md');
    expect(artifacts[2].content).toContain('# Implementation Notes');
  });

  it('persists output code artifacts to workDir during WorkflowEngine execution', async () => {
    const writtenFiles = new Map<string, string>();

    const instance: WorkflowInstance = {
      id: 'inst-1',
      name: 'Test Workflow',
      projectGoal: 'Test scaffold file persistence',
      maxGoalIterations: 3,
      agents: [
        {
          id: 'agent-1',
          name: 'Builder Agent',
          status: 'idle',
          outputRoutes: [],
          execution: { mode: 'single' },
        },
      ],
      connections: [],
      workflowRuns: [],
      activeRunId: null,
      dirtyAgentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    useWorkflowStore.setState({
      instances: [instance],
      currentInstanceId: 'inst-1',
      isRunning: false,
      runningAgentId: null,
    });

    const engine = new WorkflowEngine({
      createRunDirectory: async (runId) => `/tmp/test-run-${runId}`,
      writeRunFile: async (workDir, relativePath, content) => {
        writtenFiles.set(relativePath, content);
        return `${workDir}/${relativePath}`;
      },
      now: () => 1700000000000,
      runAgent: async () => `
Here are the generated project files:

\`\`\`python 02_scaffold.py
print("created 02_scaffold.py")
\`\`\`

\`\`\`json 02_scaffold.json
{
  "project": "pipi-shrimp-scaffold"
}
\`\`\`

### IMPLEMENTATION_NOTES.md
\`\`\`markdown
# Implementation Notes
All files initialized successfully.
\`\`\`
`,
    });

    await engine.start();

    // Verify all 3 files (02_scaffold.py, 02_scaffold.json, IMPLEMENTATION_NOTES.md) were persisted to workDir
    expect(writtenFiles.has('02_scaffold.py')).toBe(true);
    expect(writtenFiles.get('02_scaffold.py')).toContain('print("created 02_scaffold.py")');

    expect(writtenFiles.has('02_scaffold.json')).toBe(true);
    expect(writtenFiles.get('02_scaffold.json')).toContain('"project": "pipi-shrimp-scaffold"');

    expect(writtenFiles.has('IMPLEMENTATION_NOTES.md')).toBe(true);
    expect(writtenFiles.get('IMPLEMENTATION_NOTES.md')).toContain('# Implementation Notes');
  });
});
