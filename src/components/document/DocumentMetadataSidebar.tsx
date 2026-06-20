import type { ReactNode } from 'react';
import { DocumentTagList } from './DocumentTagList';

export interface DocumentMetadataSection {
  label: string;
  content: ReactNode;
}

interface DocumentMetadataSidebarProps {
  createdAt?: string | null;
  updatedAt?: string | null;
  path?: string | null;
  tags?: string[];
  sections?: DocumentMetadataSection[];
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MetadataCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e9e7e2] bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9b9a97]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[#37352f]">{children}</div>
    </div>
  );
}

export function DocumentMetadataSidebar({
  createdAt,
  updatedAt,
  path,
  tags = [],
  sections = [],
}: DocumentMetadataSidebarProps) {
  const hasTimeline = Boolean(createdAt || updatedAt);

  return (
    <aside className="border-b border-[#e9e7e2] bg-[#fbfbfa] px-4 py-5 lg:border-b-0 lg:border-r sm:px-6">
      <div className="space-y-5 text-sm text-[#6f6e69]">
        {hasTimeline && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9b9a97]">Timeline</p>
            <div className="mt-3 space-y-3">
              {createdAt && (
                <MetadataCard label="Created">
                  {formatDateTime(createdAt)}
                </MetadataCard>
              )}
              {updatedAt && (
                <MetadataCard label="Updated">
                  {formatDateTime(updatedAt)}
                </MetadataCard>
              )}
            </div>
          </div>
        )}

        {sections.map((section) => (
          <div key={section.label}>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9b9a97]">{section.label}</p>
            <div className="mt-3 rounded-2xl border border-[#e9e7e2] bg-white px-3 py-3 text-[12px] leading-5 text-[#6f6e69]">
              {section.content}
            </div>
          </div>
        ))}

        {path && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9b9a97]">Path</p>
            <p className="mt-3 break-all rounded-2xl border border-[#e9e7e2] bg-white px-3 py-3 text-[12px] leading-5 text-[#6f6e69]">
              {path}
            </p>
          </div>
        )}

        {tags.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9b9a97]">Tags</p>
            <div className="mt-3">
              <DocumentTagList tags={tags} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export default DocumentMetadataSidebar;