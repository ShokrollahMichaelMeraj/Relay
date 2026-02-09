/**
 * Dependency unlock logic
 * Determines which tasks become READY after a task completes
 */
import { TaskRunStatus } from '@relay/types';
import { DAG } from '../dag/build';
export interface UnlockResult {
    newly_ready: string[];
    newly_blocked: string[];
}
/**
 * Compute which tasks should be unlocked after a task completes
 */
export declare function computeUnlocked(completed_task_id: string, dag: DAG, current_statuses: Map<string, TaskRunStatus>, requires_approval: Map<string, boolean>): UnlockResult;
/**
 * Find all tasks that should be READY at the start of a run
 */
export declare function computeInitialReady(dag: DAG, requires_approval: Map<string, boolean>): UnlockResult;
/**
 * Check if a specific task's dependencies are all satisfied
 */
export declare function areDependenciesSatisfied(task_id: string, dag: DAG, current_statuses: Map<string, TaskRunStatus>): boolean;
/**
 * Check if all tasks in a run are in terminal states
 */
export declare function isRunComplete(statuses: Map<string, TaskRunStatus>): boolean;
/**
 * Determine final run status based on task statuses
 * Priority: FAILED > SUCCESS > CANCELLED
 */
export declare function computeRunStatus(statuses: Map<string, TaskRunStatus>): 'SUCCESS' | 'FAILED' | 'CANCELLED';
//# sourceMappingURL=unlock.d.ts.map