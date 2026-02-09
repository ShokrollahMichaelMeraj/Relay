/**
 * Dependency unlock logic
 * Determines which tasks become READY after a task completes
 */

import { TaskRunStatus } from '@relay/types';
import { DAG, getDownstream, getUpstream } from '../dag/build';

export interface UnlockResult {
  newly_ready: string[];   // Tasks that should transition to READY
  newly_blocked: string[]; // Tasks that should transition to BLOCKED (approval needed)
}

/**
 * Compute which tasks should be unlocked after a task completes
 */
export function computeUnlocked(
  completed_task_id: string,
  dag: DAG,
  current_statuses: Map<string, TaskRunStatus>,
  requires_approval: Map<string, boolean>
): UnlockResult {
  const newly_ready: string[] = [];
  const newly_blocked: string[] = [];

  const downstream = getDownstream(dag, completed_task_id);

  for (const child_id of downstream) {
    if (current_statuses.get(child_id) !== 'PENDING') {
      continue;
    }

    const all_deps = getUpstream(dag, child_id);
    const all_satisfied = all_deps.every(
      (dep_id) => current_statuses.get(dep_id) === 'SUCCESS'
    );

    if (all_satisfied) {
      if (requires_approval.get(child_id)) {
        newly_blocked.push(child_id);
      } else {
        newly_ready.push(child_id);
      }
    }
  }

  return { newly_ready, newly_blocked };
}

/**
 * Find all tasks that should be READY at the start of a run
 */
export function computeInitialReady(
  dag: DAG,
  requires_approval: Map<string, boolean>
): UnlockResult {
  const newly_ready: string[] = [];
  const newly_blocked: string[] = [];

  for (const task_id of dag.roots) {
    if (requires_approval.get(task_id)) {
      newly_blocked.push(task_id);
    } else {
      newly_ready.push(task_id);
    }
  }

  return { newly_ready, newly_blocked };
}

/**
 * Check if a specific task's dependencies are all satisfied
 */
export function areDependenciesSatisfied(
  task_id: string,
  dag: DAG,
  current_statuses: Map<string, TaskRunStatus>
): boolean {
  const deps = getUpstream(dag, task_id);
  
  if (deps.length === 0) {
    return true;
  }

  return deps.every((dep_id) => current_statuses.get(dep_id) === 'SUCCESS');
}

/**
 * Check if all tasks in a run are in terminal states
 */
export function isRunComplete(
  statuses: Map<string, TaskRunStatus>
): boolean {
  for (const status of statuses.values()) {
    if (status !== 'SUCCESS' && status !== 'FAILED' && status !== 'CANCELLED') {
      return false;
    }
  }
  return true;
}

/**
 * Determine final run status based on task statuses
 * Priority: FAILED > SUCCESS > CANCELLED
 */
export function computeRunStatus(
  statuses: Map<string, TaskRunStatus>
): 'SUCCESS' | 'FAILED' | 'CANCELLED' {
  let has_failed = false;
  let has_cancelled = false;
  let has_success = false;

  for (const status of statuses.values()) {
    if (status === 'FAILED') {
      has_failed = true;
    } else if (status === 'CANCELLED') {
      has_cancelled = true;
    } else if (status === 'SUCCESS') {
      has_success = true;
    }
  }

  // Priority: FAILED > CANCELLED > SUCCESS
  if (has_failed) {
    return 'FAILED';
  }

  if (has_cancelled) {
    return 'CANCELLED';
  }

  if (has_success) {
    return 'SUCCESS';
  }

  // This shouldn't happen if isRunComplete returned true
  throw new Error('Cannot determine run status - run not complete');
}
