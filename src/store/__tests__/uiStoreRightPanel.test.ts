import { useUIStore } from '../uiStore';

describe('uiStore right panel reopening', () => {
  beforeEach(() => {
    useUIStore.setState({
      rightPanelVisible: false,
      agentPanelTab: 'main',
    });
  });

  it('openRightPanelTab atomically makes panel visible and sets active tab', () => {
    expect(useUIStore.getState().rightPanelVisible).toBe(false);
    expect(useUIStore.getState().agentPanelTab).toBe('main');

    useUIStore.getState().openRightPanelTab('goal');

    expect(useUIStore.getState().rightPanelVisible).toBe(true);
    expect(useUIStore.getState().agentPanelTab).toBe('goal');
  });

  it('setRightPanelVisible changes visibility directly', () => {
    useUIStore.getState().setRightPanelVisible(true);
    expect(useUIStore.getState().rightPanelVisible).toBe(true);

    useUIStore.getState().setRightPanelVisible(false);
    expect(useUIStore.getState().rightPanelVisible).toBe(false);
  });
});
