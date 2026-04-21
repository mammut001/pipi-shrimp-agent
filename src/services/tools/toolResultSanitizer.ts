const MAX_MODEL_FIELD_LENGTH = 4000;
const MAX_MODEL_RESULT_LENGTH = 12000;

function looksLikeSvgOrXml(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('<svg')
    || trimmed.startsWith('<?xml')
    || (trimmed.startsWith('<') && trimmed.includes('</svg>'));
}

function summarizeLargeString(value: string, label: string): string {
  return `[omitted ${label}: ${value.length} chars]`;
}

function truncateForModel(value: string): string {
  if (value.length <= MAX_MODEL_RESULT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_MODEL_RESULT_LENGTH)}\n...[tool result truncated for model context: ${value.length - MAX_MODEL_RESULT_LENGTH} more chars]`;
}

function sanitizeValue(value: unknown, keyPath = ''): unknown {
  if (typeof value === 'string') {
    const key = keyPath.split('.').pop()?.toLowerCase() ?? '';

    if (key === 'svg' || key === 'svg_content' || key === 'svg_string' || looksLikeSvgOrXml(value)) {
      return summarizeLargeString(value, 'SVG/XML preview content');
    }

    if (value.length > MAX_MODEL_FIELD_LENGTH) {
      return summarizeLargeString(value, `${key || 'text'} field`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 50) {
      return `[omitted array: ${value.length} items]`;
    }

    return value.map((item, index) => sanitizeValue(item, `${keyPath}[${index}]`));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        sanitizeValue(child, keyPath ? `${keyPath}.${key}` : key),
      ]),
    );
  }

  return value;
}

export function sanitizeToolResultForModel(toolName: string | undefined, content: string): string {
  if (!content) {
    return content;
  }

  const trimmed = content.trim();

  if ((toolName === 'compile_typst_file' || toolName === 'render_typst_to_svg') && looksLikeSvgOrXml(trimmed)) {
    return `[${toolName} returned SVG/XML content omitted from model context: ${content.length} chars]`;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      const sanitized = sanitizeValue(parsed);

      if (toolName === 'compile_typst_file' && sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
        (sanitized as Record<string, unknown>).model_context_note =
          'Raw SVG preview content is omitted from model context. Use svg_path or generated artifacts for preview.';
      }

      return truncateForModel(JSON.stringify(sanitized));
    } catch {
      // Fall through to plain-text truncation.
    }
  }

  if (looksLikeSvgOrXml(trimmed)) {
    return summarizeLargeString(content, 'SVG/XML content');
  }

  return truncateForModel(content);
}