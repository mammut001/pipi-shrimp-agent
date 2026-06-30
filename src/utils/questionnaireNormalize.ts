import type { QuestionnaireField } from '@/types/ui';
import { coerceRenderableText, normalizeSelectOption } from './coerceRenderableText';

const QUESTIONNAIRE_FIELD_TYPES = new Set<QuestionnaireField['type']>([
  'text',
  'textarea',
  'select',
  'boolean',
]);

function normalizeFieldType(value: unknown): QuestionnaireField['type'] {
  return typeof value === 'string' && QUESTIONNAIRE_FIELD_TYPES.has(value as QuestionnaireField['type'])
    ? (value as QuestionnaireField['type'])
    : 'text';
}

export function normalizeQuestionnaireFields(fields: unknown): QuestionnaireField[] {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.map((raw, index) => {
    const field = raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {};

    const normalized: QuestionnaireField = {
      id: coerceRenderableText(field.id, `field-${index + 1}`),
      label: coerceRenderableText(field.label, `Field ${index + 1}`),
      type: normalizeFieldType(field.type),
      required: Boolean(field.required),
    };

    if (typeof field.placeholder === 'string') {
      normalized.placeholder = field.placeholder;
    }

    if (Array.isArray(field.options)) {
      normalized.options = field.options
        .map((option) => normalizeSelectOption(option))
        .filter((option) => option.length > 0);
    }

    return normalized;
  });
}