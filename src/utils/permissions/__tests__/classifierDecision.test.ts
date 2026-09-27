import { describe, expect, it } from '@jest/globals';
import { PermissionClassifier } from '../classifierDecision';

const classifier = new PermissionClassifier();
const classify = (toolName: string, args: Record<string, unknown>) => (
  classifier.classifyPermission({ toolName, arguments: args })
);

describe('PermissionClassifier risk scoring', () => {
  it('approves read-only project tools with plain arguments', async () => {
    for (const toolName of ['read_file', 'list_files', 'search_files', 'path_exists']) {
      const decision = await classify(toolName, { path: '/home/user/project/src/main.rs' });
      expect({ toolName, approved: decision.approved, risk: decision.riskLevel })
        .toEqual({ toolName, approved: true, risk: 'low' });
    }
  });

  it('rates suspicious arguments as riskier than plain ones', async () => {
    const plain = await classify('read_file', { path: '/home/user/project/Cargo.toml' });
    const system = await classify('read_file', { path: '/etc/shadow' });
    const traversal = await classify('read_file', { path: '../../../.ssh/id_rsa' });

    const score = (decision: typeof plain) => decision.metadata?.riskScore as number;
    expect(score(system)).toBeGreaterThan(score(plain));
    expect(score(traversal)).toBeGreaterThan(score(plain));
    expect(system.approved).toBe(false);
    expect(traversal.approved).toBe(false);
  });

  it('still asks before writes', async () => {
    const decision = await classify('write_file', { path: '/home/user/project/out.txt' });
    expect(decision.approved).toBe(false);
  });
});
