import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { AutoResearchBootstrapResultSchema } from './schema';
import type { BootstrapPlan } from './types';
import {
  getSessionRunPaths,
  pathExistsOnTarget,
  readTargetText,
  writeTargetText,
} from '@/services/autoresearch/runDir';
import { seedFromBootstrap } from '@/services/autoresearch/livingDoc';
import { initFromBootstrap } from '@/services/autoresearch/metricsStore';

interface BootstrapApplyReceipt {
  schemaVersion: 1;
  sessionId: string;
  bootstrapCreatedAt: string;
  bootstrapPath: string;
  appliedAt: string;
}

export function getAutoResearchBootstrapResultPath(workDir: string): string {
  return `${workDir.replace(/[\\/]+$/, '')}/.pipi-shrimp/autoresearch.bootstrap.json`;
}

function getAutoResearchBootstrapReceiptPath(cfg: SshConfig, sessionId: string): string {
  return `${getSessionRunPaths(cfg, sessionId).sessionDir}/bootstrap.applied.json`;
}

function parseBootstrapApplyReceipt(raw: string | null): BootstrapApplyReceipt | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BootstrapApplyReceipt>;
    if (
      parsed.schemaVersion === 1
      && typeof parsed.sessionId === 'string'
      && typeof parsed.bootstrapCreatedAt === 'string'
      && typeof parsed.bootstrapPath === 'string'
      && typeof parsed.appliedAt === 'string'
    ) {
      return parsed as BootstrapApplyReceipt;
    }
  } catch {
    return null;
  }

  return null;
}

function guessPrimaryBaseline(plan: BootstrapPlan): number | null {
  const targetMetric = plan.primaryMetric.trim().toLowerCase();
  for (const baseline of plan.baselines) {
    for (const metric of baseline.reportedMetrics) {
      if (metric.name.trim().toLowerCase() === targetMetric) {
        return metric.value;
      }
    }
  }
  return plan.baselines[0]?.reportedMetrics[0]?.value ?? null;
}

export async function applyBootstrapIfPresent(cfg: SshConfig, sessionId: string): Promise<boolean> {
  const workDir = cfg.remoteWorkDir?.trim();
  if (!workDir) {
    return false;
  }

  const bootstrapPath = getAutoResearchBootstrapResultPath(workDir);
  const receiptPath = getAutoResearchBootstrapReceiptPath(cfg, sessionId);
  const exists = await pathExistsOnTarget({ ...cfg, remoteWorkDir: '' }, bootstrapPath);
  if (!exists) {
    return false;
  }

  const raw = await readTargetText({ ...cfg, remoteWorkDir: '' }, bootstrapPath);
  if (!raw) {
    return false;
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(raw);
  } catch {
    return false;
  }

  const parsed = AutoResearchBootstrapResultSchema.safeParse(parsedContent);
  if (!parsed.success || parsed.data.status !== 'ready') {
    return false;
  }

  const existingReceipt = parseBootstrapApplyReceipt(
    await readTargetText({ ...cfg, remoteWorkDir: '' }, receiptPath),
  );
  if (existingReceipt?.bootstrapCreatedAt === parsed.data.createdAt) {
    return false;
  }

  const store = useAutoResearchStore.getState();
  store.setSuccessCriteria(parsed.data.plan.successCriteria);
  store.setPrimaryMetric(parsed.data.plan.primaryMetric);
  store.setBootstrapKind('conversational');

  const baseline = guessPrimaryBaseline(parsed.data.plan);
  if (baseline !== null) {
    store.setBestMetric(baseline);
  }

  await seedFromBootstrap(cfg, sessionId, parsed.data.plan, parsed.data.createdAt);
  await initFromBootstrap(cfg, sessionId, parsed.data.plan, parsed.data.createdAt);

  const sessionPaths = getSessionRunPaths(cfg, sessionId);
  store.updateRunPaths({
    sessionFilePath: sessionPaths.sessionFilePath,
    livingDocPath: sessionPaths.livingDocPath,
  });

  await writeTargetText({ ...cfg, remoteWorkDir: '' }, receiptPath, `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    bootstrapCreatedAt: parsed.data.createdAt,
    bootstrapPath,
    appliedAt: new Date().toISOString(),
  } satisfies BootstrapApplyReceipt, null, 2)}\n`);

  return true;
}

export default applyBootstrapIfPresent;