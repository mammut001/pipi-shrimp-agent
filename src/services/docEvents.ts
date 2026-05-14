export const DOCS_CHANGED_EVENT = 'pipi:docs-changed';

export interface DocsChangedEventDetail {
  workDir: string;
  path: string;
}