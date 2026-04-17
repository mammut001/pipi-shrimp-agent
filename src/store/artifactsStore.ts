/**
 * Artifacts store — manages generated file previews shown in the right panel.
 *
 * Each ArtifactItem represents a previewable file produced by a tool invocation.
 * Items are grouped by the message that created them.
 */

import { create } from 'zustand';

// ============= Types =============

export type ArtifactFileType = 'image' | 'pdf' | 'code' | 'text' | 'svg' | 'unknown';

export interface ArtifactItem {
  id: string;
  /** Display name (e.g. "resume.pdf") */
  name: string;
  /** Absolute path on disk (for Tauri asset serving) */
  filePath: string;
  /** Web-accessible URL (for <img>, convertFileSrc, etc.) */
  url: string;
  /** Thumbnail URL — may be the same as url for images */
  thumbnailUrl?: string;
  /** File type category */
  fileType: ArtifactFileType;
  /** MIME type if known */
  mimeType?: string;
  /** Owning message ID */
  messageId: string;
  /** Timestamp */
  createdAt: number;
}

export interface ArtifactsState {
  /** All artifact items, keyed by item id */
  items: ArtifactItem[];
  /** Whether the artifacts panel is open */
  panelOpen: boolean;
  /** Currently previewed item id (large preview) */
  activeItemId: string | null;
  /** Message ID whose artifacts are currently shown */
  activeMessageId: string | null;

  // Actions
  addArtifact: (item: Omit<ArtifactItem, 'id' | 'createdAt'>) => string;
  addArtifacts: (items: Omit<ArtifactItem, 'id' | 'createdAt'>[]) => void;
  removeArtifact: (id: string) => void;
  clearMessageArtifacts: (messageId: string) => void;

  openPanel: (messageId: string, itemId?: string) => void;
  closePanel: () => void;
  setActiveItem: (id: string) => void;

  /** Get artifacts belonging to a specific message */
  getMessageArtifacts: (messageId: string) => ArtifactItem[];
}

// ============= Store =============

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  items: [],
  panelOpen: false,
  activeItemId: null,
  activeMessageId: null,

  addArtifact: (item) => {
    const id = crypto.randomUUID();
    const full: ArtifactItem = { ...item, id, createdAt: Date.now() };
    set((s) => ({ items: [...s.items, full] }));
    return id;
  },

  addArtifacts: (items) => {
    const now = Date.now();
    const full = items.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      createdAt: now,
    }));
    set((s) => ({ items: [...s.items, ...full] }));
  },

  removeArtifact: (id) =>
    set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  clearMessageArtifacts: (messageId) =>
    set((s) => ({ items: s.items.filter((i) => i.messageId !== messageId) })),

  openPanel: (messageId, itemId) => {
    const items = get().items.filter((i) => i.messageId === messageId);
    set({
      panelOpen: true,
      activeMessageId: messageId,
      activeItemId: itemId ?? items[0]?.id ?? null,
    });
  },

  closePanel: () =>
    set({ panelOpen: false, activeItemId: null, activeMessageId: null }),

  setActiveItem: (id) => set({ activeItemId: id }),

  getMessageArtifacts: (messageId) =>
    get().items.filter((i) => i.messageId === messageId),
}));
