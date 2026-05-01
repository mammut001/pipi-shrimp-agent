import fs from 'fs';

let file = fs.readFileSync('src/services/artifactDetector.ts', 'utf8');

file = file.replace(/export function detectAndRegisterArtifacts\(messageId: string, toolResultText: string\): void \{[\s\S]*?\}/, 
`export interface ArtifactDetectionContext {
  messageId: string;
  toolName: string;
  toolArgs: string;
  toolResultText: string;
  workDir?: string;
  outputDir?: string;
}

export async function detectAndRegisterArtifacts(ctx: ArtifactDetectionContext): Promise<void> {
  const { messageId, toolName, toolResultText, workDir } = ctx;

  const validTools = ['write_file', 'render_typst_to_pdf', 'compile_typst_file', 'execute_command', 'Skill', 'skill', 'execute_skill'];
  if (!validTools.includes(toolName)) {
    return;
  }

  const paths = extractFilePaths(toolResultText);
  if (paths.length === 0) return;

  const allowedExtensions = ['pdf', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'html'];

  const filteredPaths = paths.filter(p => {
    // Must be under workDir
    if (workDir && !p.startsWith(workDir)) {
      return false;
    }
    const ext = p.split('.').pop()?.toLowerCase() ?? '';
    // If it's write_file, maybe allow md, but let's be conservative as requested: "favor .pdf, .svg, .png... avoid ts, rs, md by default unless directly created"
    // To keep it simple, only register visual files or explicitly stated file types
    if (!allowedExtensions.includes(ext) && toolName !== 'write_file') {
      return false;
    }
    // write_file can register whatever it wrote, but we can extract it precisely later if needed.
    // Let's just enforce the extensions for now.
    if (!allowedExtensions.includes(ext)) {
      return false;
    }
    return true;
  });

  if (filteredPaths.length > 0) {
    registerFileArtifacts(messageId, filteredPaths);
  }
}`);

fs.writeFileSync('src/services/artifactDetector.ts', file);
