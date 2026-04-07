/**
 * Swarm Persistence Bridge
 *
 * Abstraction layer between the swarm repository and the actual storage backend.
 *
 * CURRENT PATH: LocalStoragePersistence (default)
 * FUTURE PATH:  TauriPersistence (Rust/SQLite via invoke)
 *
 * To switch backend, change the default in `createPersistence()`.
 * The repository layer calls this bridge — never localStorage directly.
 *
 * === Transitional Glue ===
 * - LocalStoragePersistence: existing behavior, no data loss
 * - TauriPersistence: minimal snapshot save/load, ready for SQLite
 * - Both implement the same SwarmPersistence interface
 */

import { invoke } from '@tauri-apps/api/core';
import type { SwarmSnapshot } from './types';

// =============================================================================
// Persistence interface
// =============================================================================

export interface SwarmPersistence {
  /** Save a snapshot to the backing store */
  save(snapshot: SwarmSnapshot): Promise<void>;
  /** Load the latest snapshot; returns null if none exists */
  load(): Promise<SwarmSnapshot | null>;
  /** Clear all persisted data */
  clear(): Promise<void>;
}

// =============================================================================
// Implementation 1: localStorage (CURRENT default)
// =============================================================================

const STORAGE_KEY = 'pipi-swarm-runtime-v1';

export class LocalStoragePersistence implements SwarmPersistence {
  async save(snapshot: SwarmSnapshot): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.error('[SwarmPersistence/localStorage] save failed:', e);
    }
  }

  async load(): Promise<SwarmSnapshot | null> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as SwarmSnapshot;
    } catch (e) {
      console.error('[SwarmPersistence/localStorage] load failed:', e);
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('[SwarmPersistence/localStorage] clear failed:', e);
    }
  }
}

// =============================================================================
// Implementation 2: Tauri/Rust SQLite (FUTURE)
// =============================================================================

export class TauriPersistence implements SwarmPersistence {
  async save(snapshot: SwarmSnapshot): Promise<void> {
    try {
      await invoke<void>('swarm_save_snapshot', { snapshot });
    } catch (e) {
      console.error('[SwarmPersistence/tauri] save failed:', e);
    }
  }

  async load(): Promise<SwarmSnapshot | null> {
    try {
      const result = await invoke<SwarmSnapshot | null>('swarm_load_snapshot');
      return result;
    } catch (e) {
      console.error('[SwarmPersistence/tauri] load failed:', e);
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await invoke<void>('swarm_clear_snapshot');
    } catch (e) {
      console.error('[SwarmPersistence/tauri] clear failed:', e);
    }
  }
}

// =============================================================================
// Factory: pick the active backend
// =============================================================================

/**
 * Change this to switch the persistence backend.
 *
 * CURRENT:  'localStorage' — stable, existing behavior
 * FUTURE:   'tauri' — SQLite via Rust invoke
 */
export type PersistenceBackend = 'localStorage' | 'tauri';

const ACTIVE_BACKEND: PersistenceBackend = 'localStorage';

export function createPersistence(): SwarmPersistence {
  switch (ACTIVE_BACKEND) {
    case 'tauri':
      console.log('[SwarmPersistence] Using Tauri/SQLite backend');
      return new TauriPersistence();
    case 'localStorage':
    default:
      return new LocalStoragePersistence();
  }
}

// =============================================================================
// Singleton instance used by the repository
// =============================================================================

let instance: SwarmPersistence | null = null;

export function getPersistence(): SwarmPersistence {
  if (!instance) {
    instance = createPersistence();
  }
  return instance;
}

/**
 * Reset the singleton (useful for tests or backend switching at runtime).
 */
export function resetPersistence(): void {
  instance = null;
}
