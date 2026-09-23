/**
 * @jest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import {
  formatCdpHealthLabel,
  formatCdpLaunchLabel,
  taskStepDotClassName,
  taskStepLabelClassName,
  cdpStatusDotClassName,
  skillMatchesActive,
  formatActiveSkillBadgeLabel,
  combineWorkingFiles,
  workingFoldersCountBadge,
  footerStatusLabel,
  findArtifactInMessages,
  ArtifactRenderer,
  ThinkingPulse,
  CancellingPulse,
} from '../agentPanelUi';
import { formatCancelInterruptLabel } from '@/store/chat/cancelInterruptVocab';

jest.mock('../ChatImage', () => ({
  ChatImage: ({ src, isSVG }: { src: string; isSVG?: boolean }) => (
    <div data-testid="mock-chat-image" data-src={src} data-issvg={String(isSVG)} />
  ),
}));

describe('agentPanelUi helpers', () => {
  describe('formatCdpHealthLabel', () => {
    it('converts snake_case or status strings into title case with spaces', () => {
      expect(formatCdpHealthLabel('connected')).toBe('Connected');
      expect(formatCdpHealthLabel('degraded_health')).toBe('Degraded Health');
      expect(formatCdpHealthLabel('not_ready_yet')).toBe('Not Ready Yet');
    });
  });

  describe('formatCdpLaunchLabel', () => {
    it('returns appropriate labels for launch and attach modes, null otherwise', () => {
      expect(formatCdpLaunchLabel('launch')).toBe('Launched by PiPi');
      expect(formatCdpLaunchLabel('attach')).toBe('Attached to Existing Chrome');
      expect(formatCdpLaunchLabel(null)).toBeNull();
      expect(formatCdpLaunchLabel(undefined)).toBeNull();
      expect(formatCdpLaunchLabel('unknown')).toBeNull();
    });
  });

  describe('taskStepDotClassName', () => {
    it('returns expected classes for key task step statuses', () => {
      expect(taskStepDotClassName('done')).toBe('bg-green-500 text-white');
      expect(taskStepDotClassName('running')).toBe('bg-blue-600 text-white shadow-[0_0_8px_rgba(37,99,235,0.3)]');
      expect(taskStepDotClassName('cancelling')).toBe('bg-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.3)]');
      expect(taskStepDotClassName('validating')).toBe('bg-slate-500 text-white');
      expect(taskStepDotClassName('awaiting_confirmation')).toBe('bg-amber-500 text-white');
      expect(taskStepDotClassName('approved')).toBe('bg-emerald-500 text-white');
      expect(taskStepDotClassName('cancelled')).toBe('bg-slate-400 text-white');
      expect(taskStepDotClassName('timed_out')).toBe('bg-orange-500 text-white');
      expect(taskStepDotClassName('rejected')).toBe('bg-rose-500 text-white');
      expect(taskStepDotClassName('failed')).toBe('bg-red-500 text-white');
      expect(taskStepDotClassName('pending')).toBe('bg-white border-2 border-gray-100 text-gray-300');
      expect(taskStepDotClassName('unknown_status')).toBe('bg-white border-2 border-gray-100 text-gray-300');
    });
  });

  describe('taskStepLabelClassName', () => {
    it('returns expected classes for key task step statuses', () => {
      expect(taskStepLabelClassName('running')).toBe('text-gray-900 font-bold');
      expect(taskStepLabelClassName('cancelling')).toBe('text-amber-800 font-bold');
      expect(taskStepLabelClassName('awaiting_confirmation')).toBe('text-amber-700 font-bold');
      expect(taskStepLabelClassName('approved')).toBe('text-emerald-700 font-bold');
      expect(taskStepLabelClassName('validating')).toBe('text-slate-700 font-bold');
      expect(taskStepLabelClassName('cancelled')).toBe('text-red-600');
      expect(taskStepLabelClassName('timed_out')).toBe('text-red-600');
      expect(taskStepLabelClassName('rejected')).toBe('text-red-600');
      expect(taskStepLabelClassName('failed')).toBe('text-red-600');
      expect(taskStepLabelClassName('done')).toBe('text-gray-500');
      expect(taskStepLabelClassName('pending')).toBe('text-gray-400');
      expect(taskStepLabelClassName('unknown_status')).toBe('text-gray-400');
    });
  });

  describe('cdpStatusDotClassName', () => {
    it('returns expected indicator classes for cdp statuses', () => {
      expect(cdpStatusDotClassName('connected')).toBe('bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]');
      expect(cdpStatusDotClassName('connecting')).toBe('bg-yellow-400 animate-pulse');
      expect(cdpStatusDotClassName('error')).toBe('bg-red-400');
      expect(cdpStatusDotClassName('disconnected')).toBe('bg-gray-300');
      expect(cdpStatusDotClassName('other')).toBe('bg-gray-300');
    });
  });

  describe('skillMatchesActive', () => {
    const skill = { id: 'skill-id-1', name: 'browser_action', displayName: 'Browser Automation' };

    it('matches by skill id', () => {
      expect(skillMatchesActive(skill, 'skill-id-1')).toBe(true);
    });

    it('matches by skill name', () => {
      expect(skillMatchesActive(skill, 'browser_action')).toBe(true);
    });

    it('matches by skill displayName case-insensitively', () => {
      expect(skillMatchesActive(skill, 'browser automation')).toBe(true);
      expect(skillMatchesActive(skill, 'Browser Automation')).toBe(true);
    });

    it('returns false for non-matching skills', () => {
      expect(skillMatchesActive(skill, 'other_skill')).toBe(false);
    });

    it('returns false when activeSkill is null or undefined', () => {
      expect(skillMatchesActive(skill, null)).toBe(false);
      expect(skillMatchesActive(skill, undefined)).toBe(false);
    });
  });

  describe('formatActiveSkillBadgeLabel', () => {
    it('capitalizes the first letter of active skill label', () => {
      expect(formatActiveSkillBadgeLabel('browser')).toBe('Browser');
      expect(formatActiveSkillBadgeLabel('autoresearch')).toBe('Autoresearch');
      expect(formatActiveSkillBadgeLabel('')).toBe('');
    });
  });

  describe('combineWorkingFiles', () => {
    it('deduplicates session files and global files by path, preserving session precedence', () => {
      const sessionFiles = [
        { id: 's-1', path: '/workspace/fileA.ts' },
        { id: 's-2', path: '/workspace/fileB.ts' },
      ];
      const globalFiles = [
        { id: 'g-1', path: '/workspace/fileB.ts' }, // duplicate path
        { id: 'g-2', path: '/workspace/fileC.ts' },
      ];

      const combined = combineWorkingFiles(sessionFiles, globalFiles);
      expect(combined).toEqual([
        { id: 's-1', path: '/workspace/fileA.ts' },
        { id: 's-2', path: '/workspace/fileB.ts' },
        { id: 'g-2', path: '/workspace/fileC.ts' },
      ]);
    });
  });

  describe('workingFoldersCountBadge', () => {
    it('returns total count as string when greater than 0, undefined when 0', () => {
      expect(workingFoldersCountBadge(0, 0)).toBeUndefined();
      expect(workingFoldersCountBadge(2, 3)).toBe('5');
      expect(workingFoldersCountBadge(1, 0)).toBe('1');
      expect(workingFoldersCountBadge(0, 4)).toBe('4');
    });
  });

  describe('footerStatusLabel', () => {
    it('prioritizes cancelling status', () => {
      const progress = [
        { status: 'running' },
        { status: 'cancelling' },
        { status: 'done' },
      ];
      expect(footerStatusLabel(progress)).toBe(formatCancelInterruptLabel('cancelling'));
    });

    it('returns Processing if any step is running and none cancelling', () => {
      const progress = [
        { status: 'done' },
        { status: 'running' },
      ];
      expect(footerStatusLabel(progress)).toBe('Processing');
    });

    it('returns System Ready when no steps are running or cancelling', () => {
      expect(footerStatusLabel([])).toBe('System Ready');
      expect(footerStatusLabel([{ status: 'done' }, { status: 'cancelled' }])).toBe('System Ready');
    });
  });

  describe('findArtifactInMessages', () => {
    it('returns null if artifactId is undefined or messages empty', () => {
      expect(findArtifactInMessages(undefined, [])).toBeNull();
      expect(findArtifactInMessages('art-1', [])).toBeNull();
    });

    it('finds artifact by id in messages list', () => {
      const messages = [
        { id: 'm-1', artifacts: [{ id: 'art-other' }] },
        { id: 'm-2', artifacts: [{ id: 'art-target', title: 'Target Artifact' }] },
      ];
      expect(findArtifactInMessages('art-target', messages)).toEqual({
        id: 'art-target',
        title: 'Target Artifact',
      });
    });

    it('returns null if artifact is not found across messages', () => {
      const messages = [{ id: 'm-1', artifacts: [{ id: 'art-other' }] }];
      expect(findArtifactInMessages('missing', messages)).toBeNull();
    });
  });
});

describe('Presentational components', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (mounted) {
        act(() => {
          mounted.root.unmount();
        });
        mounted.container.remove();
      }
    }
  });

  function render(ui: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      root.render(ui);
    });

    return { container, root };
  }

  describe('ThinkingPulse', () => {
    it('renders bounce dots and Thinking text', () => {
      const { container } = render(<ThinkingPulse />);
      expect(container.textContent).toContain('Thinking');
    });
  });

  describe('CancellingPulse', () => {
    it('renders bounce dots and Cancelling text', () => {
      const { container } = render(<CancellingPulse />);
      expect(container.textContent).toContain(formatCancelInterruptLabel('cancelling'));
    });
  });

  describe('ArtifactRenderer', () => {
    it('renders empty state when artifactId is undefined or not found', () => {
      const { container: emptyContainer } = render(
        <ArtifactRenderer artifactId={undefined} messages={[]} />
      );
      expect(emptyContainer.textContent).toContain('No Artifact Selected');

      const { container: notFoundContainer } = render(
        <ArtifactRenderer artifactId="missing" messages={[]} />
      );
      expect(notFoundContainer.textContent).toContain('No Artifact Selected');
    });

    it('renders image artifact with ChatImage', () => {
      const messages = [
        {
          id: 'm-1',
          artifacts: [
            {
              id: 'img-1',
              type: 'image',
              title: 'Chart Preview',
              content: 'data:image/png;base64,1234',
            },
          ],
        },
      ];

      const { container } = render(
        <ArtifactRenderer artifactId="img-1" messages={messages} />
      );

      expect(container.textContent).toContain('Chart Preview');
      expect(container.textContent).toContain('ID: img-1');
      const chatImg = container.querySelector('[data-testid="mock-chat-image"]');
      expect(chatImg).toBeTruthy();
      expect(chatImg?.getAttribute('data-src')).toBe('data:image/png;base64,1234');
      expect(chatImg?.getAttribute('data-issvg')).toBe('false');
    });

    it('renders svg artifact with isSVG flag', () => {
      const messages = [
        {
          id: 'm-1',
          artifacts: [
            {
              id: 'svg-1',
              type: 'svg',
              content: '<svg></svg>',
            },
          ],
        },
      ];

      const { container } = render(
        <ArtifactRenderer artifactId="svg-1" messages={messages} />
      );

      expect(container.textContent).toContain('Image Artifact');
      const chatImg = container.querySelector('[data-testid="mock-chat-image"]');
      expect(chatImg?.getAttribute('data-issvg')).toBe('true');
    });

    it('renders fallback for code or text artifacts', () => {
      const messages = [
        {
          id: 'm-1',
          artifacts: [
            {
              id: 'code-1',
              type: 'code',
              title: 'Script File',
              content: 'console.log("hello");',
            },
          ],
        },
      ];

      const { container } = render(
        <ArtifactRenderer artifactId="code-1" messages={messages} />
      );

      expect(container.textContent).toContain('Script File');
      const pre = container.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre?.textContent).toBe('console.log("hello");');
    });
  });
});
