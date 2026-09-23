/**
 * Density-derived class names / sizing for ChatInput surface (AG-13).
 */

export type ChatInputDensity = 'default' | 'compact';

export interface ComposerDensityStyles {
  isCompact: boolean;
  textareaMaxHeight: number;
  textareaMinHeight: string;
  rootClassName: string;
  inputShellClassName: string;
  textareaClassName: string;
  actionRowClassName: string;
  actionButtonClassName: string;
  actionIconClassName: string;
}

export function resolveComposerDensityStyles(density: ChatInputDensity): ComposerDensityStyles {
  const isCompact = density === 'compact';
  return {
    isCompact,
    textareaMaxHeight: isCompact ? 96 : 200,
    textareaMinHeight: isCompact ? '36px' : '48px',
    rootClassName: isCompact
      ? 'bg-white'
      : 'border-t border-gray-200 bg-white p-4',
    inputShellClassName: isCompact
      ? 'relative overflow-visible bg-gray-50 rounded-xl border transition-all px-3'
      : 'relative overflow-visible bg-gray-50 rounded-xl border transition-all px-4',
    textareaClassName: isCompact
      ? 'flex-1 bg-transparent px-0 py-2 max-h-[96px] resize-none focus:outline-none text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50'
      : 'flex-1 bg-transparent px-0 py-3 max-h-[200px] resize-none focus:outline-none text-gray-900 placeholder-gray-400 disabled:opacity-50',
    actionRowClassName: isCompact
      ? 'flex items-center gap-0.5 pr-1 pb-1.5 flex-wrap'
      : 'flex items-center gap-1 pr-2 pb-2 flex-wrap',
    actionButtonClassName: isCompact
      ? 'p-1.5 rounded-md'
      : 'p-2 rounded-lg',
    actionIconClassName: isCompact ? 'h-4 w-4' : 'h-5 w-5',
  };
}
