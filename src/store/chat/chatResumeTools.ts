import { invoke } from '@tauri-apps/api/core';

type FileListEntry = {
  name: string;
  is_directory: boolean;
  path: string;
};

export const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const parentDirOf = (value: string): string => {
  const normalized = trimTrailingSlash(value);
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : normalized;
};

export const normalizeResumeWorkspacePath = (value: string, workDir: string): string => {
  const normalizedWorkDir = trimTrailingSlash(workDir);
  const normalizedValue = trimTrailingSlash(value);
  const absoluteResumeRoot = `${normalizedWorkDir}/resume`;

  if (normalizedValue === absoluteResumeRoot) {
    return normalizedWorkDir;
  }

  if (normalizedValue.startsWith(`${absoluteResumeRoot}/`)) {
    return `${normalizedWorkDir}/${normalizedValue.slice(absoluteResumeRoot.length + 1)}`;
  }

  if (normalizedValue === 'resume') {
    return normalizedWorkDir;
  }

  if (normalizedValue.startsWith('resume/')) {
    return `${normalizedWorkDir}/${normalizedValue.slice('resume/'.length)}`;
  }

  return value;
};

export function normalizeResumeWorkspaceToolArgs(
  toolName: string,
  toolArgs: string,
  workDir?: string | null,
  activeSkill?: string | null,
): string {
  if (!workDir || activeSkill !== 'resume') {
    return toolArgs;
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(toolArgs);
  } catch {
    return toolArgs;
  }

  let changed = false;
  const normalizedArgs: Record<string, unknown> = { ...parsedArgs };

  for (const key of ['path', 'file_path', 'output_dir']) {
    const rawValue = normalizedArgs[key];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      continue;
    }

    const normalizedValue = normalizeResumeWorkspacePath(rawValue, workDir);
    if (normalizedValue !== rawValue) {
      normalizedArgs[key] = normalizedValue;
      changed = true;
    }
  }

  if (!changed) {
    return toolArgs;
  }

  console.info('[resume] Flattened nested resume workspace path', {
    toolName,
    originalArgs: parsedArgs,
    normalizedArgs,
  });

  return JSON.stringify(normalizedArgs);
}

export async function findNestedResumeTyp(workDir: string): Promise<string | null> {
  try {
    const entries = await invoke<FileListEntry[]>('list_files', { path: workDir });
    const visibleDirs = entries.filter((entry) => entry.is_directory && !entry.name.startsWith('.'));
    const candidates: string[] = [];

    for (const dir of visibleDirs) {
      const candidate = `${trimTrailingSlash(dir.path)}/resume.typ`;
      const exists = await invoke<boolean>('path_exists', { path: candidate, workDir });
      if (exists) {
        candidates.push(candidate);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    return candidates.find((candidate) => candidate.endsWith('/resume/resume.typ')) ?? candidates[0];
  } catch {
    return null;
  }
}

export async function normalizeCompileTypstArgs(toolArgs: string, workDir?: string | null): Promise<string> {
  if (!workDir) {
    return toolArgs;
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(toolArgs);
  } catch {
    return toolArgs;
  }

  const rawFilePath = typeof parsedArgs.file_path === 'string' ? parsedArgs.file_path : '';
  const rawOutputDir = typeof parsedArgs.output_dir === 'string' ? parsedArgs.output_dir : '';
  if (!rawFilePath || !rawOutputDir) {
    return toolArgs;
  }

  let filePath = rawFilePath;
  let outputDir = rawOutputDir;
  let changed = false;

  try {
    const fileExists = await invoke<boolean>('path_exists', { path: filePath, workDir });
    if (!fileExists) {
      const nestedResumeTyp = await findNestedResumeTyp(workDir);
      if (nestedResumeTyp) {
        filePath = nestedResumeTyp;
        changed = true;
      }
    }
  } catch {
    return toolArgs;
  }

  const normalizedWorkDir = trimTrailingSlash(workDir);
  const fileDir = parentDirOf(filePath);
  if (fileDir && trimTrailingSlash(outputDir) === normalizedWorkDir && trimTrailingSlash(fileDir) !== normalizedWorkDir) {
    outputDir = fileDir;
    changed = true;
  }

  if (!changed) {
    return toolArgs;
  }

  console.info('[resume] Normalized compile_typst_file args', {
    originalFilePath: rawFilePath,
    normalizedFilePath: filePath,
    originalOutputDir: rawOutputDir,
    normalizedOutputDir: outputDir,
  });

  return JSON.stringify({
    ...parsedArgs,
    file_path: filePath,
    output_dir: outputDir,
  });
}
