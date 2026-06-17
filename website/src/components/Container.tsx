import type { HTMLAttributes, ReactNode } from "react";

/**
 * Page-width container.
 *
 * Centralises the `max-w-[1200px] mx-auto px-6` triplet so spacing
 * stays consistent across every page and there's a single place to
 * change if we ever need a different breakpoint or gutter.
 */
export function Container({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={`mx-auto w-full max-w-[1200px] px-6 ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}
