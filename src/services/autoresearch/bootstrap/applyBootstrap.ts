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

  // CRITICAL: Write the receipt BEFORE mutating the store.
  //
  // AUDIT-FIX [audit-2-ar#6]: Bootstrap idempotency relies on the receipt
  // file being durable before any store mutation lands. The previous
  // order was store-mutate → seed/initFromBootstrap → writeTargetText
  // (receipt). If `writeTargetText` failed (network blip, SSH timeout,
  // full disk), the store had already been updated with the bootstrap's
  // successCriteria/primaryMetric but the receipt was missing. On next
  // launch the existingReceipt check would re-fire and overwrite any
  // user-edited values with the bootstrap defaults.
  //
  // The previous order was store-mutate → seed/initFromBootstrap →
  // writeTargetText(receipt). If `writeTargetText` failed (network
  // blip, SSH timeout, full disk), the store had already been
  // updated with the bootstrap's successCriteria/primaryMetric but
  // the receipt was missing. On next launch the existingReceipt
  // check would re-fire and overwrite any user-edited values with
  // the bootstrap defaults.
  //
  // New order:
  //   1. seedFromBootstrap / initFromBootstrap  (remote artifacts)
  //   2. writeTargetText(receipt)               ← idempotency marker FIRST
  //   3. mutate store                           ← only after marker is durable
  // If step 2 fails, the bootstrap will be re-applied on next launch
  // but seed/init are themselves idempotent (they're no-ops when the
  // session file / metrics already exist for this createdAt), so
  // re-applying is safe.
  await seedFromBootstrap(cfg, sessionId, parsed.data.plan, parsed.data.createdAt);
  await initFromBootstrap(cfg, sessionId, parsed.data.plan, parsed.data.createdAt);

  await writeTargetText({ ...cfg, remoteWorkDir: '' }, receiptPath, `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    bootstrapCreatedAt: parsed.data.createdAt,
    bootstrapPath,
    appliedAt: new Date().toISOString(),
  } satisfies BootstrapApplyReceipt, null, 2)}\n`);

  // Store mutations are now safe — the receipt is durable so the
  // existingReceipt check will skip this bootstrap on subsequent runs.
  const store = useAutoResearchStore.getState();
  store.setSuccessCriteria(parsed.data.plan.successCriteria);
  store.setPrimaryMetric(parsed.data.plan.primaryMetric);
  store.setBootstrapKind('conversational');

  const baseline = guessPrimaryBaseline(parsed.data.plan);
  if (baseline !== null) {
    store.setBestMetric(baseline);
  }

  const sessionPaths = getSessionRunPaths(cfg, sessionId);
  store.updateRunPaths({
    sessionFilePath: sessionPaths.sessionFilePath,
    livingDocPath: sessionPaths.livingDocPath,
  });

  return true;
}

export default applyBootstrapIfPresent;