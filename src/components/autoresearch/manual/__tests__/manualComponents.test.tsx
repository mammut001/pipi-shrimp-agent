/** @jest-environment jsdom */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { ManualSectionCard } from '../ManualSectionCard';
import { RuntimeTargetSection } from '../sections/RuntimeTargetSection';
import { WorkspaceTargetSection } from '../sections/WorkspaceTargetSection';
import { MetricIterationsSection } from '../sections/MetricIterationsSection';
import { EnvironmentCheckSection } from '../sections/EnvironmentCheckSection';
import { LaunchConfirmSection } from '../sections/LaunchConfirmSection';
import { AdvancedFieldsSection } from '../sections/AdvancedFieldsSection';

jest.mock('@/i18n', () => ({
  t: (key: string) => key,
  getCurrentLocale: () => 'zh-CN',
}));

jest.mock('../../AutoResearchSetupHelpers', () => ({
  AutoResearchPathSummary: ({ label, path }: any) => <div data-testid="path-summary">{label}: {path}</div>,
  AutoResearchConnectionStatusPanel: ({ status, output }: any) => <div data-testid="conn-panel">{status}: {output}</div>,
  AutoResearchSummaryItem: ({ label, value }: any) => <div data-testid="summary-item">{label}: {value}</div>,
}));

describe('Manual Setup subcomponents smoke tests', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('renders ManualSectionCard', () => {
    act(() => {
      root.render(
        <ManualSectionCard
          id="test-sec"
          number={1}
          emoji="🚀"
          title="Test Section"
          status="completed"
          statusLabel="Done"
          activeSection="test-sec"
          setActiveSection={() => {}}
          collapsedSummary="Collapsed text"
        >
          <div>Child Content</div>
        </ManualSectionCard>
      );
    });
    expect(container.textContent).toContain('Test Section');
    expect(container.textContent).toContain('Child Content');
  });

  it('renders RuntimeTargetSection', () => {
    const setupForm = {
      mode: 'local' as const,
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '',
      authMode: 'agent' as const,
      password: '',
    };
    act(() => {
      root.render(
        <RuntimeTargetSection
          setupForm={setupForm}
          setSetupForm={() => {}}
        />
      );
    });
    expect(container.textContent).toContain('autoresearch.manual.localRun');
  });

  it('renders WorkspaceTargetSection', () => {
    const setupForm = {
      mode: 'local' as const,
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/path/to/workdir',
      authMode: 'agent' as const,
      password: '',
    };
    act(() => {
      root.render(
        <WorkspaceTargetSection
          setupForm={setupForm}
          setSetupForm={() => {}}
          experimentDir="/path/to/expdir"
          setExperimentDir={() => {}}
          handlePickLocalWorkDir={() => {}}
          handlePickExperimentDir={() => {}}
        />
      );
    });
    expect(container.textContent).toContain('/path/to/workdir');
  });

  it('renders MetricIterationsSection', () => {
    act(() => {
      root.render(
        <MetricIterationsSection
          metric="accuracy"
          setMetric={() => {}}
          direction="higher"
          setDirection={() => {}}
          baselineInput="0.9"
          setBaselineInput={() => {}}
          baselineInvalid={false}
          maxIter={10}
          setMaxIter={() => {}}
        />
      );
    });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('accuracy');
  });

  it('renders EnvironmentCheckSection', () => {
    act(() => {
      root.render(
        <EnvironmentCheckSection
          connectionTest={{ status: 'success', output: 'Linux\n/path\ntrue' }}
          testConnectionDisabled={false}
          isStarting={false}
          handleTestConnection={() => {}}
        />
      );
    });
    expect(container.textContent).toContain('操作系统 (OS)');
  });

  it('renders LaunchConfirmSection', () => {
    const setupForm = {
      mode: 'local' as const,
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/test/workdir',
      authMode: 'agent' as const,
      password: '',
    };
    act(() => {
      root.render(
        <LaunchConfirmSection
          setupForm={setupForm}
          experimentDir="/test/experiment"
          metric="loss"
          direction="lower"
          baselineInput="0.5"
          maxIter={5}
          providerReady={true}
          connectionTestStatus="success"
        />
      );
    });
    expect(container.textContent).toContain('工作区目录');
  });

  it('renders AdvancedFieldsSection', () => {
    const setupForm = {
      mode: 'local' as const,
      host: '',
      user: 'root',
      keyPath: '',
      port: 22,
      remoteWorkDir: '/test/workdir',
      authMode: 'agent' as const,
      password: '',
    };
    act(() => {
      root.render(
        <AdvancedFieldsSection
          setupForm={setupForm}
          experimentDir="/test/experiment"
          prefillSource="defaults"
          handleResetToDefaults={() => {}}
        />
      );
    });
    expect(container.textContent).toContain('Prefill Source');
  });
});
