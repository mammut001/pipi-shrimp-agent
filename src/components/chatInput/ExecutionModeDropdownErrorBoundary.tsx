/**
 * Error boundary for ExecutionModeDropdown.
 *
 * If the registry, the i18n keys, or the store wiring ever throw at render
 * time, we want the chat composer to keep working — the dropdown is non-
 * critical. The fallback renders a disabled button labeled "Mode" so the
 * user understands the feature is unavailable without losing access to the
 * underlying input.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ExecutionModeDropdownErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('[ExecutionModeDropdown] render failed, falling back to disabled button:', error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="execution-mode-dropdown-fallback"
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-400 cursor-not-allowed"
          title="Mode selector unavailable"
        >
          Mode
        </button>
      );
    }
    return this.props.children;
  }
}
