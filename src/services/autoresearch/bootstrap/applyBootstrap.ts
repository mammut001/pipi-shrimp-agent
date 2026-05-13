import { useAutoResearchStore, type SshConfig } from '@/store/autoresearchStore';
import { AutoResearchBootstrapResultSchema } from './schema';
import type { BootstrapPlan } from './types';
import { getSessionRunPaths, pathExistsOnTarget, readTargetText } from '@/services/autoresearch/runDir';
import { seedFromBootstrap } from '@/services/autoresearch/livingDoc';
import { initFromBootstrap } from '@/services/autoresearch/metricsStore';

export function getAutoResearchBootstrapResultPath(workDir: string): string {
  return `${workDir.replace(/[\\/]+$/, '')}/.pipi-shrimp/autoresearch.bootstrap.json`;
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

  return true;
}

export default applyBootstrapIfPresent;