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
    <div className="rounded-2xl bg-white/80 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#998c7e]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[#2f251a]">{children}</div>
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
    <aside className="border-b border-[#e7ded1] bg-[#f1eadf]/85 px-4 py-5 lg:border-b-0 lg:border-r sm:px-6">
      <div className="space-y-5 text-sm text-[#5c5247]">
        {hasTimeline && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">Timeline</p>
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
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">{section.label}</p>
            <div className="mt-3 rounded-2xl bg-white/80 px-3 py-3 text-[12px] leading-5 text-[#5c5247] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
              {section.content}
            </div>
          </div>
        ))}

        {path && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">Path</p>
            <p className="mt-3 break-all rounded-2xl bg-white/80 px-3 py-3 text-[12px] leading-5 text-[#5c5247] shadow-[inset_0_0_0_1px_rgba(231,222,209,0.9)]">
              {path}
            </p>
          </div>
        )}

        {tags.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8375]">Tags</p>
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