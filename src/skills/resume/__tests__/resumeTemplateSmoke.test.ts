import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  escapeTypstContent,
  escapeTypstString,
  normalizeResumeUrl,
  toTomlArray,
  toTomlString,
} from '../resumeSerialization';

const tempDirs: string[] = [];

const PROJECT_TMP_DIR = path.resolve(process.cwd(), 'src/skills/resume/__tests__/.tmp');

function projectTmpDir(): string {
  return PROJECT_TMP_DIR;
}

beforeAll(() => {
  mkdirSync(projectTmpDir(), { recursive: true });
});

function createWorkDir(prefix: string): string {
  const workDir = mkdtempSync(path.join(projectTmpDir(), prefix));
  tempDirs.push(workDir);
  return workDir;
}

function resolveWithinWorkDir(workDir: string, relativePath: string): string {
  const absoluteWorkDir = path.resolve(workDir);
  const resolvedPath = path.resolve(workDir, relativePath);
  const relativeToWorkDir = path.relative(absoluteWorkDir, resolvedPath);

  if (relativeToWorkDir.startsWith('..') || path.isAbsolute(relativeToWorkDir)) {
    throw new Error(`Attempted to escape workDir: ${relativePath}`);
  }

  return resolvedPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const workDir = tempDirs.pop();
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Best-effort: never let cleanup mask the actual test failure.
      }
    }
  }
});

afterAll(() => {
  try {
    rmSync(PROJECT_TMP_DIR, { recursive: true, force: true });
  } catch {
    // Best-effort sweep; failures here are non-fatal.
  }
});

describe('resume template smoke fixtures', () => {
  it('writes a minimal basic-resume file with escaped special characters', () => {
    const workDir = createWorkDir('resume-basic-');
    const filePath = resolveWithinWorkDir(workDir, 'resume.typ');
    const content = `#import "@preview/basic-resume:0.2.9": *\n\n#show: resume.with(\n  author: "${escapeTypstString('Jane \"JJ\" Doe')}",\n  email: "${escapeTypstString('user@example.com')}",\n  github: "${escapeTypstString(normalizeResumeUrl('github.com/jjdoe'))}",\n)\n\n== Projects\n- ${escapeTypstContent('Built #[AI] assistant *safely* with _tests_ and C:\\notes')}\n`;

    writeFileSync(filePath, content, 'utf8');

    expect(filePath.startsWith(path.resolve(workDir))).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('user\\@example.com');
    expect(readFileSync(filePath, 'utf8')).toContain('Jane \\\"JJ\\\" Doe');
    expect(readFileSync(filePath, 'utf8')).toContain('Built \\#\\[AI\\] assistant \\*safely\\* with \\_tests\\_ and C:\\\\notes');
  });

  it('writes a minimal fallback Chinese file without escaping outside workDir', () => {
    const workDir = createWorkDir('resume-fallback-');
    const filePath = resolveWithinWorkDir(workDir, 'resume.typ');
    const content = `#section-title("${escapeTypstString('工作经历')}")\n#entry("${escapeTypstString('某科技公司')} — ${escapeTypstString('后端工程师')}", "2023 - 至今")[\n  - ${escapeTypstContent('主导搜索链路优化，延迟降低 [X%]，并负责上线落地')}\n]\n`;

    writeFileSync(filePath, content, 'utf8');

    expect(filePath.startsWith(path.resolve(workDir))).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toContain('主导搜索链路优化，延迟降低 \\[X%\\]，并负责上线落地');
  });

  it('writes a TOML-driven nabcv fixture with deterministic quoting', () => {
    const workDir = createWorkDir('resume-nabcv-');
    const tomlPath = resolveWithinWorkDir(workDir, 'cv.toml');
    const typPath = resolveWithinWorkDir(workDir, 'resume.typ');
    const tomlContent = `[cv]\nname = ${toTomlString('张三')}\nheadline = ${toTomlString('Senior "Platform" Engineer')}\nemail = ${toTomlString('user@example.com')}\nsummary = ${toTomlString('第一行\n第二行')}\n\n[[cv.skills]]\ngroup = ${toTomlString('Core')}\nitems = ${toTomlString('TypeScript, Rust, Typst')}\n\n[cv.meta]\nlinks = ${toTomlArray([normalizeResumeUrl('github.com/example'), 'https://example.com'])}\n`;
    const typContent = '#import "@preview/nabcv:0.1.0": cv\n#let cd = toml("cv.toml").cv\n#show: cv.with(name: cd.name)\n';

    writeFileSync(tomlPath, tomlContent, 'utf8');
    writeFileSync(typPath, typContent, 'utf8');

    expect(readFileSync(tomlPath, 'utf8')).toContain('"user@example.com"');
    expect(readFileSync(tomlPath, 'utf8')).toContain('"Senior \\"Platform\\" Engineer"');
    expect(readFileSync(tomlPath, 'utf8')).toContain('"第一行\\n第二行"');
    expect(readFileSync(tomlPath, 'utf8')).toContain('["https://github.com/example", "https://example.com"]');
  });

  it.skip('runs local typst compile smoke for resume templates', () => {
    expect(true).toBe(true);
  });
});