/**
 * Global host for the Chrome CDP connector modal.
 * Driven by `useCdpStore.connectorModalOpen` so any feature can prompt
 * the user to connect before browser tools run.
 */

import React from 'react';
import { useCdpStore } from '@/store/cdpStore';
import { CdpConnectorModal } from './CdpConnectorModal';

export function CdpConnectorModalHost() {
  const connectorModalOpen = useCdpStore((s) => s.connectorModalOpen);
  const dismissConnectorModal = useCdpStore((s) => s.dismissConnectorModal);
  const status = useCdpStore((s) => s.status);

  if (!connectorModalOpen) {
    return null;
  }

  return (
    <CdpConnectorModal
      onClose={() => dismissConnectorModal(status === 'connected')}
    />
  );
}

export default CdpConnectorModalHost;
