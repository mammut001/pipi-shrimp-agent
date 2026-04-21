import type {
  BrowserActionTarget,
  BrowserInteractiveElement,
  BrowserPageState,
} from '@/types/browserPageState';

const MAX_INLINE_TEXT = 96;

const compactText = (value: string | null | undefined, maxLength = MAX_INLINE_TEXT): string => {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const readNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return undefined;
};

export const getBrowserElementLabel = (element: BrowserInteractiveElement): string => {
  return compactText(
    element.name ||
      element.text_hint ||
      element.selector_hint ||
      element.tag_name ||
      element.role ||
      `element ${element.index}`,
  );
};

export const getBrowserElementStatus = (element: BrowserInteractiveElement): string => {
  const parts: string[] = [element.is_visible ? 'visible' : 'hidden'];

  if (element.is_clickable) {
    parts.push('clickable');
  }

  if (element.is_editable) {
    parts.push('editable');
  }

  return parts.join(' ');
};

export const describeBrowserElementForAgent = (element: BrowserInteractiveElement): string => {
  const parts = [
    `[id=${element.index} backend_node_id=${element.backend_node_id}]`,
    element.role || element.tag_name || 'element',
    `"${getBrowserElementLabel(element)}"`,
  ];

  if (element.tag_name) {
    parts.push(`<${element.tag_name}>`);
  }

  const status = getBrowserElementStatus(element);
  if (status) {
    parts.push(status);
  }

  if (element.selector_hint) {
    parts.push(`selector=${compactText(element.selector_hint, 64)}`);
  }

  if (element.href) {
    parts.push(`href=${compactText(element.href, 80)}`);
  }

  return parts.join(' ');
};

export const formatBrowserPageStateForPrompt = (
  pageState: BrowserPageState,
  maxElements = 24,
): string => {
  const lines = [
    `URL: ${pageState.url}`,
    `Title: ${pageState.title}`,
    `Navigation ID: ${pageState.navigation_id}`,
    `Frame Count: ${pageState.frame_count}`,
    `Warnings: ${pageState.warnings.length > 0 ? pageState.warnings.join(', ') : 'none'}`,
    'Interactive Elements:',
  ];

  if (pageState.elements.length === 0) {
    lines.push('- none');
    return lines.join('\n');
  }

  pageState.elements.slice(0, maxElements).forEach((element) => {
    lines.push(`- ${describeBrowserElementForAgent(element)}`);
  });

  if (pageState.elements.length > maxElements) {
    lines.push(`- ... ${pageState.elements.length - maxElements} more elements omitted`);
  }

  return lines.join('\n');
};

export const resolveBrowserActionTarget = (
  pageState: BrowserPageState | null,
  payload: Record<string, unknown> | null | undefined,
): BrowserActionTarget | null => {
  if (!payload) {
    return null;
  }

  const backendNodeId = readNumber(payload.backend_node_id ?? payload.backendNodeId);
  const elementId = readNumber(payload.element_id ?? payload.elementId ?? payload.id);
  const navigationId = pageState?.navigation_id;

  if (backendNodeId != null) {
    const matched = pageState?.elements.find((element) => element.backend_node_id === backendNodeId);
    return {
      backendNodeId,
      elementId: matched?.index ?? elementId,
      navigationId,
    };
  }

  if (elementId == null) {
    return null;
  }

  const matched = pageState?.elements.find((element) => element.index === elementId);
  return {
    elementId,
    backendNodeId: matched?.backend_node_id,
    navigationId,
  };
};

export const describeBrowserActionTarget = (target: BrowserActionTarget): string => {
  if (target.elementId != null && target.backendNodeId != null) {
    return `element ${target.elementId} / backend_node_id ${target.backendNodeId}`;
  }

  if (target.backendNodeId != null) {
    return `backend_node_id ${target.backendNodeId}`;
  }

  if (target.elementId != null) {
    return `element ${target.elementId}`;
  }

  return 'unknown target';
};