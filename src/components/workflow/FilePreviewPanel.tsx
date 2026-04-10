/**
 * FilePreviewPanel - File preview component for the right workflow panel
 *
 * Shows the content of a selected file with:
 * - File name header
 * - Syntax highlighted / plain text content
 */

import { useState, useEffect } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { workflowService } from '@/services/workflow';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { t } from '@/i18n';

const MD_EXTENSIONS = ['.md', '.markdown', '.txt'];
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.sh', '.yaml', '.yml', '.css', '.html'];

function getLanguage(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.'));
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.json': 'json', '.py': 'python',
    '.sh': 'bash', '.yaml': 'yaml', '.yml': 'yaml',
    '.css': 'css', '.html': 'html',
  };
  return map[ext] || 'text';
}

function isMarkdown(filename: string): boolean {
  return MD_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

function isCode(filename: string): boolean {
  return CODE_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext));
}

export function FilePreviewPanel() {
  const { selectedPreviewFile } = useWorkflowStore();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPreviewFile) return;
    setLoading(true);
    setError(null);
    workflowService.readFile(selectedPreviewFile)
      .then((result) => setContent(result.content))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedPreviewFile]);

  const filename = selectedPreviewFile ? selectedPreviewFile.split('/').pop() || selectedPreviewFile : '';
  const isMd = isMarkdown(filename);
  const isCodeFile = isCode(filename);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-sm font-medium text-gray-700 truncate" title={selectedPreviewFile ?? undefined}>
          {filename}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {t('workflow.filePreview.loading')}
          </div>
        )}
        {error && (
          <div className="p-4 text-red-500 text-sm">
            {t('workflow.filePreview.readFailed').replace('{error}', String(error))}
          </div>
        )}
        {!loading && !error && content && (
          <>
            {isMd ? (
              <div className="p-4 prose prose-sm max-w-none">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            ) : isCodeFile ? (
              <div className="text-sm">
                <SyntaxHighlighter
                  language={getLanguage(filename)}
                  style={oneDark}
                  customStyle={{ margin: 0, borderRadius: 0, fontSize: '12px' }}
                >
                  {content}
                </SyntaxHighlighter>
              </div>
            ) : (
              <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap break-all font-mono">
                {content}
              </pre>
            )}
          </>
        )}
        {!loading && !error && !content && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {t('workflow.filePreview.empty')}
          </div>
        )}
      </div>
    </div>
  );
}

export default FilePreviewPanel;
