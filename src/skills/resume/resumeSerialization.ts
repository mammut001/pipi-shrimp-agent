function escapeTypstCharacter(value: string): string {
  switch (value) {
    case '\\':
      return '\\\\';
    case '"':
      return '\\"';
    case '@':
      return '\\@';
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    case '\t':
      return '\\t';
    default:
      return value;
  }
}

function escapeTypstContentCharacter(value: string): string {
  switch (value) {
    case '\\':
      return '\\\\';
    case '@':
      return '\\@';
    case '#':
      return '\\#';
    case '[':
      return '\\[';
    case ']':
      return '\\]';
    case '*':
      return '\\*';
    case '_':
      return '\\_';
    default:
      return value;
  }
}

function escapeTomlCharacter(value: string): string {
  switch (value) {
    case '\\':
      return '\\\\';
    case '"':
      return '\\"';
    case '\b':
      return '\\b';
    case '\f':
      return '\\f';
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    case '\t':
      return '\\t';
    default:
      return value;
  }
}

function escapeByCodePoint(value: string, escapeCharacter: (character: string) => string): string {
  return Array.from(value).map((character) => escapeCharacter(character)).join('');
}

export function escapeTypstString(value: string): string {
  return escapeByCodePoint(value, escapeTypstCharacter);
}

export function escapeTypstContent(value: string): string {
  return escapeByCodePoint(value, escapeTypstContentCharacter);
}

export function toTomlString(value: string): string {
  return `"${escapeByCodePoint(value, escapeTomlCharacter)}"`;
}

export function toTomlArray(values: string[]): string {
  return `[${values.map((value) => toTomlString(value)).join(', ')}]`;
}

export function normalizeResumeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  if (/^(github|linkedin)\.com\//i.test(trimmed) || /^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}