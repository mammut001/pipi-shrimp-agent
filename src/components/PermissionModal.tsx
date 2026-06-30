/**
 * PermissionModal - Permission request dialog component
 *
 * Features:
 * - Display tool name
 * - Show input parameters (truncated to 1000 chars)
 * - Operation description
 * - Approve/Deny buttons
 */

import { useState } from 'react';
import type { PermissionRequest } from '@/types/ui';
import { t } from '@/i18n';
import { coerceRenderableText } from '@/utils/coerceRenderableText';

/**
 * Props for PermissionModal component
 */
interface PermissionModalProps {
  /** The permission request to display */
  permission: PermissionRequest;
  /** Callback when permission is approved */
  onApprove: () => void;
  /** Callback when permission is denied */
  onDeny: () => void;
}

/**
 * Truncate text to specified length
 */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * Permission modal dialog component
 */
export function PermissionModal({ permission, onApprove, onDeny }: PermissionModalProps) {
  const truncatedInput = truncateText(permission.toolInput, 1000);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop - no click-to-dismiss to prevent accidental denial */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal Content */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-yellow-600"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t('permission.title')}
              </h2>
              <p className="text-sm text-gray-500">
                {t('permission.subtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {/* Tool Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('permission.tool')}
            </label>
            <div className="px-3 py-2 bg-gray-100 rounded-lg font-mono text-sm text-gray-900">
              {permission.toolName}
            </div>
          </div>

          {/* Description */}
          {permission.description && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('common.description')}
              </label>
              <p className="text-sm text-gray-600">{coerceRenderableText(permission.description)}</p>
            </div>
          )}

          {(permission.commandPreview || permission.workingDirectory || permission.source || permission.riskReason) && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {permission.commandPreview && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Command
                  </label>
                  <div className="px-3 py-2 bg-gray-100 rounded-lg font-mono text-xs text-gray-900 break-all">
                    {permission.commandPreview}
                  </div>
                </div>
              )}
              {permission.workingDirectory && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Work Dir
                  </label>
                  <div className="px-3 py-2 bg-gray-100 rounded-lg font-mono text-xs text-gray-900 break-all">
                    {permission.workingDirectory}
                  </div>
                </div>
              )}
              {permission.source && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Source
                  </label>
                  <div className="px-3 py-2 bg-gray-100 rounded-lg text-xs text-gray-900">
                    {permission.source}
                  </div>
                </div>
              )}
              {permission.riskReason && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Risk Reason
                  </label>
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    {coerceRenderableText(permission.riskReason)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowAdvancedDetails((prev) => !prev)}
              className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              {showAdvancedDetails
                ? t('permission.hideAdvancedDetails')
                : t('permission.showAdvancedDetails')}
            </button>

            {showAdvancedDetails && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('permission.inputParameters')}
                </label>
                <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                    {truncatedInput}
                  </pre>
                  {permission.toolInput.length > 1000 && (
                    <p className="text-xs text-gray-400 mt-2">
                      {t('permission.truncated')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onDeny}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            {t('tool.deny')}
          </button>
          <button
            onClick={onApprove}
            className="px-4 py-2 text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors font-medium"
          >
            {t('tool.allow')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PermissionModal;
