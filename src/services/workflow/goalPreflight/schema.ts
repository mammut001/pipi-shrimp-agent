/**
 * @deprecated Goal preflight is shared by Session Goal and Workflow Goal.
 * Import from `@/services/goal/preflight/schema` in new code.
 *
 * This compatibility re-export keeps existing Workflow UI/tests stable while
 * callers migrate away from the old workflow-owned path.
 */
export * from '@/services/goal/preflight/schema';
