/**
 * AutoResearch Harness — Permission Defaults
 *
 * Maps AutoResearch modes to a default permission profile.
 * Self-improve mode is locked to workspace_write unless an explicit
 * override is provided.
 */

import type { PermissionProfile, PermissionProfileId } from './permissions';
import { PROFILE_CATALOG } from './permissions';

export type AutoResearchPermissionMode = 'ml_experiment' | 'repo_self_improve' | 'recovery';

export function defaultPermissionProfileForMode(
  mode: AutoResearchPermissionMode | string,
): PermissionProfile {
  switch (mode) {
    case 'ml_experiment':
    case 'repo_self_improve':
      return PROFILE_CATALOG.workspace_write;
    case 'recovery':
      return PROFILE_CATALOG.danger_full_access;
    default:
      return PROFILE_CATALOG.workspace_write;
  }
}

export function resolvePermissionProfileId(
  explicit: PermissionProfileId | string | null | undefined,
  mode: AutoResearchPermissionMode | string,
): PermissionProfileId {
  if (explicit && explicit in PROFILE_CATALOG) {
    return explicit as PermissionProfileId;
  }
  return defaultPermissionProfileForMode(mode).id;
}
