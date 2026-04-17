/**
 * QuestionnaireCard - Interactive form overlay for collecting structured data from the user.
 *
 * Renders when the AI invokes the AskUserQuestion tool with structured fields.
 * On submit, the form data is serialized to JSON and fed back as a tool result.
 */

import { useState, useCallback } from 'react';
import type { QuestionnaireData, QuestionnaireField } from '@/types/ui';

interface QuestionnaireCardProps {
  data: QuestionnaireData;
  onSubmit: (response: string) => void;
  onCancel: () => void;
}

export function QuestionnaireCard({ data, onSubmit, onCancel }: QuestionnaireCardProps) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const field of data.fields) {
      init[field.id] = field.type === 'boolean' ? false : '';
    }
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateField = useCallback((id: string, value: string | boolean) => {
    setValues(prev => ({ ...prev, [id]: value }));
    setErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    // Validate required fields
    const newErrors: Record<string, string> = {};
    for (const field of data.fields) {
      if (field.required) {
        const val = values[field.id];
        if (val === '' || val === undefined || val === null) {
          newErrors[field.id] = 'This field is required';
        }
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSubmit(JSON.stringify(values));
  }, [data.fields, values, onSubmit]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Card */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{data.title}</h2>
              <p className="text-sm text-gray-500">{data.description}</p>
            </div>
          </div>
        </div>

        {/* Body - scrollable */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {data.fields.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              value={values[field.id]}
              error={errors[field.id]}
              onChange={(val) => updateField(field.id, val)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors font-medium"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/** Individual field renderer */
function FieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: QuestionnaireField;
  value: string | boolean;
  error?: string;
  onChange: (val: string | boolean) => void;
}) {
  const labelEl = (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );

  const errorEl = error ? (
    <p className="mt-1 text-xs text-red-500">{error}</p>
  ) : null;

  const baseInputClass =
    'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-colors';
  const inputClass = error
    ? `${baseInputClass} border-red-300 bg-red-50`
    : `${baseInputClass} border-gray-300 bg-white`;

  switch (field.type) {
    case 'text':
      return (
        <div>
          {labelEl}
          <input
            type="text"
            value={value as string}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
          {errorEl}
        </div>
      );

    case 'textarea':
      return (
        <div>
          {labelEl}
          <textarea
            value={value as string}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            className={inputClass}
          />
          {errorEl}
        </div>
      );

    case 'select':
      return (
        <div>
          {labelEl}
          <select
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          >
            <option value="">{field.placeholder || 'Select...'}</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {errorEl}
        </div>
      );

    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          <label className="text-sm font-medium text-gray-700">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {errorEl}
        </div>
      );

    default:
      return null;
  }
}

export default QuestionnaireCard;
