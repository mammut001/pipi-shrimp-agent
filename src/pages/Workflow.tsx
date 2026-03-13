/**
 * Workflow Page - Entry point for the workflow system
 *
 * Wraps WorkflowView in MainLayout for consistent app layout (Sidebar + content area).
 */

import { MainLayout } from '@/layout';
import { WorkflowView } from '@/components/workflow';

export function Workflow() {
  return (
    <MainLayout>
      <WorkflowView />
    </MainLayout>
  );
}

export default Workflow;
