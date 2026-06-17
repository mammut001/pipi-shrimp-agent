import type { HTMLAttributes, ReactNode } from "react";

type SectionVariant = "default" | "muted" | "hero" | "hero-muted";

type SectionProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  /**
   * Visual variant:
   *  - `"default"`:    standard vertical rhythm, transparent background
   *  - `"muted"`:      standard vertical rhythm, gray background
   *  - `"hero"`:       extra top padding so a first-page hero does not
   *                     crowd the fixed header; transparent background
   *  - `"hero-muted"`: same extra top padding, gray background
   *
   * Pages compose these instead of writing their own `pt-32` /
   * `section-padding` combos that tend to fight each other.
   */
  variant?: SectionVariant;
  /**
   * Backwards-compatible boolean alias for `variant="muted"`.
   * Prefer `variant` in new code.
   */
  muted?: boolean;
};

/**
 * Standard vertical section with consistent top/bottom padding.
 */
export function Section({
  children,
  className = "",
  variant,
  muted = false,
  ...rest
}: SectionProps) {
  // `muted` wins when set explicitly; otherwise fall back to `variant`,
  // otherwise default. This keeps old call-sites (`<Section muted />`)
  // working while letting new code write `<Section variant="hero" />`.
  const effectiveVariant: SectionVariant = muted
    ? "muted"
    : variant ?? "default";

  const baseClass =
    effectiveVariant === "hero"
      ? "app-hero"
      : effectiveVariant === "hero-muted"
        ? "app-hero-muted"
        : effectiveVariant === "muted"
          ? "app-section-muted"
          : "app-section";

  return (
    <section className={[baseClass, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </section>
  );
}
