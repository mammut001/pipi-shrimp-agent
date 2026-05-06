import type { ReactNode } from 'react';

interface DocumentContentCardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function DocumentContentCard({ title, children, className = '' }: DocumentContentCardProps) {
  return (
    <div className={`min-h-full rounded-[26px] border border-[#ebe4d9] bg-white px-5 py-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] sm:px-8 sm:py-8 ${className}`}>
      {title && (
        <h4 className="mb-5 text-lg font-semibold tracking-tight text-[#2f251a]">
          {title}
        </h4>
      )}
      {children}
    </div>
  );
}

export default DocumentContentCard;