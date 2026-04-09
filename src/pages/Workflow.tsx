/**
 * Workflow Page - Entry point for the workflow system
 *
 * Wraps WorkflowView in MainLayout for consistent app layout (Sidebar + content area).
 */

import { MainLayout } from '@/layout';
import { WorkflowView, FilePreviewPanel } from '@/components/workflow';
import { useWorkflowStore } from '@/store/workflowStore';

export function Workflow() {
  const selectedPreviewFile = useWorkflowStore((state) => state.selectedPreviewFile);

  return (
    <MainLayout
      showRightPanel={Boolean(selectedPreviewFile)}
      rightPanelContent={<FilePreviewPanel />}
      rightPanelWidthClassName="w-[420px]"
    >
      <WorkflowView />
    </MainLayout>
  );
}

export default Workflow;
