import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Get list of all git-tracked files.
// Fail soft: print a warning and continue with an empty list so this
// report never breaks a build or CI run.
let files = [];
try {
  const filesOutput = execSync('git ls-files', { encoding: 'utf-8' });
  files = filesOutput.split('\n').map(f => f.trim()).filter(Boolean);
} catch (err) {
  console.error(`[complexity-report] warning: git ls-files failed (${err.message}). Running with empty file list.`);
}

const includedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.rs']);
const ignoredDirs = ['node_modules/', 'dist/', 'target/', 'build/', 'coverage/'];

const targetFiles = files.filter(file => {
  const ext = path.extname(file);
  if (!includedExtensions.has(ext)) return false;
  const normFile = file.replace(/\\/g, '/');
  return !ignoredDirs.some(dir => normFile.includes(dir));
});

const fileStats = targetFiles.map(file => {
  try {
    const filePath = path.resolve(process.cwd(), file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const loc = content.split('\n').length;
    const isTest = file.includes('__tests__') || file.includes('.test.') || file.includes('.spec.');
    return { file, loc, isTest };
  } catch (err) {
    return null;
  }
}).filter(Boolean);

const sourceFilesSorted = fileStats.filter(f => !f.isTest).sort((a, b) => b.loc - a.loc);
const testFilesSorted = fileStats.filter(f => f.isTest).sort((a, b) => b.loc - a.loc);

const over500 = fileStats.filter(f => f.loc > 500 && f.loc <= 800).sort((a, b) => b.loc - a.loc);
const over800 = fileStats.filter(f => f.loc > 800).sort((a, b) => b.loc - a.loc);

function getRiskLevel(loc) {
  if (loc < 300) return 'low';
  if (loc <= 500) return 'watch';
  if (loc <= 800) return 'split soon';
  return 'requires refactor plan';
}

const dirSummary = {};
fileStats.forEach(f => {
  const dir = path.dirname(f.file).replace(/\\/g, '/');
  if (!dirSummary[dir]) {
    dirSummary[dir] = { loc: 0, fileCount: 0 };
  }
  dirSummary[dir].loc += f.loc;
  dirSummary[dir].fileCount += 1;
});
const dirSummaryList = Object.entries(dirSummary)
  .map(([dir, data]) => ({ dir, ...data }))
  .sort((a, b) => b.loc - a.loc);

let md = '# Codebase Complexity LOC Report\n\n';

md += '## Directory LOC Summary\n\n';
md += '| Directory | Total LOC | File Count |\n';
md += '| --- | --- | --- |\n';
dirSummaryList.forEach(d => {
  md += `| ${d.dir} | ${d.loc} | ${d.fileCount} |\n`;
});
md += '\n';

md += '## Files Requiring Refactor Plan (>800 LOC)\n\n';
if (over800.length === 0) {
  md += '*None*\n\n';
} else {
  md += '| File | LOC | Type | Suggested Action |\n';
  md += '| --- | --- | --- | --- |\n';
  over800.forEach(f => {
    md += `| ${f.file} | ${f.loc} | ${f.isTest ? 'Test' : 'Source'} | Requires refactor plan |\n`;
  });
  md += '\n';
}

md += '## Files to Split Soon (500-800 LOC)\n\n';
if (over500.length === 0) {
  md += '*None*\n\n';
} else {
  md += '| File | LOC | Type | Suggested Action |\n';
  md += '| --- | --- | --- | --- |\n';
  over500.forEach(f => {
    md += `| ${f.file} | ${f.loc} | ${f.isTest ? 'Test' : 'Source'} | Split soon |\n`;
  });
  md += '\n';
}

md += '## Top 40 Largest Source Files\n\n';
md += '| Rank | File | LOC | Risk Level |\n';
md += '| --- | --- | --- | --- |\n';
sourceFilesSorted.slice(0, 40).forEach((f, i) => {
  md += `| ${i + 1} | ${f.file} | ${f.loc} | ${getRiskLevel(f.loc)} |\n`;
});
md += '\n';

md += '## Top 20 Largest Test Files\n\n';
md += '| Rank | File | LOC | Risk Level |\n';
md += '| --- | --- | --- | --- |\n';
testFilesSorted.slice(0, 20).forEach((f, i) => {
  md += `| ${i + 1} | ${f.file} | ${f.loc} | ${getRiskLevel(f.loc)} |\n`;
});
md += '\n';

console.log(md);
