/**
 * Skeleton - Loading skeleton component for better perceived performance
 *
 * Features:
 * - Multiple variants: text, circular, rectangular
 * - Configurable dimensions
 * - Animate pulse effect
 */

import React from 'react';

interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  className?: string;
  count?: number;
}

export function Skeleton({
  variant = 'rectangular',
  width,
  height,
  className = '',
  count = 1,
}: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-gray-200';

  const getStyle = (): React.CSSProperties => {
    const style: React.CSSProperties = {};
    if (width) style.width = typeof width === 'number' ? `${width}px` : width;
    if (height) style.height = typeof height === 'number' ? `${height}px` : height;
    return style;
  };

  const renderSkeleton = (index: number) => {
    switch (variant) {
      case 'text':
        return (
          <div
            key={index}
            className={`h-4 rounded ${baseClasses} ${className}`}
            style={getStyle()}
          />
        );
      case 'circular':
        const size = width ?? height ?? 40;
        return (
          <div
            key={index}
            className={`rounded-full ${baseClasses} ${className}`}
            style={{
              width: typeof size === 'number' ? `${size}px` : size,
              height: typeof size === 'number' ? `${size}px` : size,
            }}
          />
        );
      case 'rectangular':
      default:
        return (
          <div
            key={index}
            className={`rounded-lg ${baseClasses} ${className}`}
            style={getStyle()}
          />
        );
    }
  };

  if (count === 1) {
    return renderSkeleton(0);
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: count }, (_, i) => renderSkeleton(i))}
    </div>
  );
}

/**
 * DocListSkeleton - Pre-built skeleton for doc list loading state
 */
export function DocListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-start gap-2 p-2.5">
          <Skeleton variant="rectangular" width={24} height={20} className="mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <Skeleton variant="text" width="70%" height={12} />
            <Skeleton variant="text" width="40%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * SessionListSkeleton - Pre-built skeleton for session list loading state
 */
export function SessionListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2 px-3 py-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-start justify-between gap-2 py-2">
          <div className="flex-1 space-y-1.5">
            <Skeleton variant="text" width="60%" height={14} />
            <Skeleton variant="text" width="80%" height={11} />
          </div>
          <Skeleton variant="circular" width={16} height={16} />
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
