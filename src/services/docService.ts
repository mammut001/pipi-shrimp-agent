import { invoke } from '@tauri-apps/api/core';

export interface DocMeta {
  number: string;
  filename: string;
  title: string;
  created: string;
  updated: string | null;
  tags: string[];
  summary: string | null;
  path: string;
}

export interface DocContent {
  meta: DocMeta;
  body: string;
}

export interface DocResult {
  number: string;
  filename: string;
  path: string;
  index_updated: boolean;
}

export interface CreateDocOptions {
  title: string;
  body: string;
  tags?: string[];
  related?: string[];
  summary?: string;
}

export async function getNextDocNumber(workDir: string): Promise<string> {
  return invoke<string>('get_next_doc_number', { workDir });
}

export async function createDoc(
  workDir: string,
  options: CreateDocOptions
): Promise<DocResult> {
  return invoke<DocResult>('create_doc', {
    workDir,
    title: options.title,
    body: options.body,
    tags: options.tags ?? null,
    related: options.related ?? null,
    summary: options.summary ?? null,
  });
}

export async function listDocs(workDir: string): Promise<DocMeta[]> {
  return invoke<DocMeta[]>('list_docs', { workDir });
}

export async function readDoc(workDir: string, number: string): Promise<DocContent> {
  return invoke<DocContent>('read_doc', { workDir, number });
}

export async function deleteDoc(workDir: string, number: string): Promise<boolean> {
  return invoke<boolean>('delete_doc', { workDir, number });
}

export async function updateDocIndex(workDir: string): Promise<string> {
  return invoke<string>('update_doc_index', { workDir });
}

export async function updateDoc(
  workDir: string,
  number: string,
  options: Partial<CreateDocOptions>
): Promise<DocResult> {
  return invoke<DocResult>('update_doc', {
    workDir,
    number,
    title: options.title ?? null,
    body: options.body ?? null,
    tags: options.tags ?? null,
    related: options.related ?? null,
    summary: options.summary ?? null,
  });
}

export async function openFileExternal(path: string): Promise<void> {
  return invoke<void>('open_file_external', { path });
}

export async function openFileWithApp(path: string, appName: string): Promise<void> {
  return invoke<void>('open_file_with_app', { path, appName });
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}
