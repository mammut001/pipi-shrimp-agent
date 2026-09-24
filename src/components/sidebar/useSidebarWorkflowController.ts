import { useCallback, useMemo, useState } from 'react';
import { t } from '@/i18n';
import { useWorkflowStore } from '@/store';

type WorkflowStore = ReturnType<typeof useWorkflowStore.getState>;
type WorkflowInstance = WorkflowStore['instances'][number];

export function useSidebarWorkflowController(workflowInstances: WorkflowInstance[]) {
  const { renameInstance, deleteInstance, deleteInstances, selectInstance } = useWorkflowStore();
  const [workflowSearchQuery, setWorkflowSearchQuery] = useState('');
  const [showWorkflowDeleteConfirm, setShowWorkflowDeleteConfirm] = useState(false);
  const [workflowInstanceToDelete, setWorkflowInstanceToDelete] = useState<string | null>(null);
  const [renamingWorkflowInstanceId, setRenamingWorkflowInstanceId] = useState<string | null>(null);
  const [workflowRenameInput, setWorkflowRenameInput] = useState('');
  const [isWorkflowMultiSelectMode, setIsWorkflowMultiSelectMode] = useState(false);
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());

  const filteredWorkflows = useMemo(() => {
    if (!workflowSearchQuery.trim()) return null;
    const query = workflowSearchQuery.toLowerCase();
    return workflowInstances.filter(
      (instance) =>
        instance.name.toLowerCase().includes(query) ||
        instance.agents.some((agent) => agent.name.toLowerCase().includes(query)),
    );
  }, [workflowInstances, workflowSearchQuery]);

  const handleToggleWorkflowSelection = useCallback((instanceId: string) => {
    setSelectedWorkflows((previous) => {
      const next = new Set(previous);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  }, []);

  const handleWorkflowSelectAll = useCallback(() => {
    const workflowIds = workflowInstances.map((instance) => instance.id);
    const allSelected = workflowIds.every((id) => selectedWorkflows.has(id));
    setSelectedWorkflows(
      allSelected && selectedWorkflows.size > 0
        ? new Set()
        : new Set(workflowIds),
    );
  }, [workflowInstances, selectedWorkflows]);

  const handleBatchDeleteWorkflows = useCallback(() => {
    if (selectedWorkflows.size > 0) {
      setShowWorkflowDeleteConfirm(true);
    }
  }, [selectedWorkflows]);

  const handleConfirmBatchDeleteWorkflows = useCallback(() => {
    deleteInstances(Array.from(selectedWorkflows));
    setSelectedWorkflows(new Set());
    setIsWorkflowMultiSelectMode(false);
    setShowWorkflowDeleteConfirm(false);
  }, [selectedWorkflows, deleteInstances]);

  const handleSelectInstance = useCallback((instanceId: string) => {
    selectInstance(instanceId);
  }, [selectInstance]);

  const handleStartWorkflowRename = useCallback((instanceId: string) => {
    const instance = workflowInstances.find((item) => item.id === instanceId);
    if (instance) {
      setRenamingWorkflowInstanceId(instanceId);
      setWorkflowRenameInput(instance.name || t('sidebar.untitledWorkflow'));
    }
  }, [workflowInstances]);

  const handleConfirmWorkflowRename = useCallback(() => {
    if (renamingWorkflowInstanceId && workflowRenameInput.trim()) {
      renameInstance(renamingWorkflowInstanceId, workflowRenameInput.trim());
    }
    setRenamingWorkflowInstanceId(null);
    setWorkflowRenameInput('');
  }, [renamingWorkflowInstanceId, workflowRenameInput, renameInstance]);

  const handleCancelWorkflowRename = useCallback(() => {
    setRenamingWorkflowInstanceId(null);
    setWorkflowRenameInput('');
  }, []);

  const handleOpenWorkflowDeleteConfirm = useCallback((instanceId: string) => {
    setWorkflowInstanceToDelete(instanceId);
    setShowWorkflowDeleteConfirm(true);
  }, []);

  const handleConfirmWorkflowDelete = useCallback(() => {
    if (!workflowInstanceToDelete) return;
    deleteInstance(workflowInstanceToDelete);
    setShowWorkflowDeleteConfirm(false);
    setWorkflowInstanceToDelete(null);
  }, [deleteInstance, workflowInstanceToDelete]);

  return {
    workflowSearchQuery,
    setWorkflowSearchQuery,
    filteredWorkflows,
    showWorkflowDeleteConfirm,
    setShowWorkflowDeleteConfirm,
    workflowInstanceToDelete,
    setWorkflowInstanceToDelete,
    renamingWorkflowInstanceId,
    workflowRenameInput,
    setWorkflowRenameInput,
    isWorkflowMultiSelectMode,
    setIsWorkflowMultiSelectMode,
    selectedWorkflows,
    setSelectedWorkflows,
    handleToggleWorkflowSelection,
    handleWorkflowSelectAll,
    handleBatchDeleteWorkflows,
    handleConfirmBatchDeleteWorkflows,
    handleSelectInstance,
    handleStartWorkflowRename,
    handleConfirmWorkflowRename,
    handleCancelWorkflowRename,
    handleOpenWorkflowDeleteConfirm,
    handleConfirmWorkflowDelete,
  };
}
