import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const documentPreviewProseClassName = [
  'prose prose-stone prose-sm md:prose-base max-w-none',
  'prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-[#2f251a]',
  'prose-p:text-[#4f463d] prose-li:text-[#4f463d] prose-strong:text-[#2f251a]',
  'prose-a:text-[#0f766e] prose-a:no-underline hover:prose-a:text-[#115e59]',
  'prose-blockquote:border-l-[#d6d3d1] prose-blockquote:text-[#57534e]',
  'prose-hr:border-[#ece6dc]',
  'prose-table:text-[0.92em] prose-th:border-b prose-th:border-[#e7e1d7] prose-th:text-[#57534e]',
  'prose-td:border-b prose-td:border-[#f1ede6]',
  'prose-code:rounded prose-code:bg-[#f5f5f4] prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[#7c2d12]',
  'prose-code:before:hidden prose-code:after:hidden',
  'prose-pre:rounded-2xl prose-pre:border prose-pre:border-[#2c303a] prose-pre:bg-[#111827] prose-pre:shadow-none',
].join(' ');

export function MarkdownDocumentPreview({ body }: { body: string }) {
  return (
    <article className={documentPreviewProseClassName}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </article>
  );
}

export default MarkdownDocumentPreview;