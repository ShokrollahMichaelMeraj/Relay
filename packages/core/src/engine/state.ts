/**
 * State machine for task execution
 * Defines valid state transitions and events
 */

import { TaskRunStatus } from '@relay/types';

/**
 * Events that trigger state transitions
 */
export type TaskEvent =
  | { type: 'DEPENDENCIES_MET' }
  | { type: 'APPROVAL_REQUIRED' }
  | { type: 'SCHEDULED' }
  | { type: 'CLAIMED' }
  | { type: 'COMPLETED'; output: string }
  | { type: 'ERRORED'; error: string; retriable: boolean }
  | { type: 'APPROVED' }
  | { type: 'CANCELLED' };

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<TaskRunStatus, TaskRunStatus[]> = {
  PENDING: ['READY', 'BLOCKED', 'CANCELLED'],
  READY: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCESS', 'FAILED', 'QUEUED', 'CANCELLED'], // QUEUED = retry
  SUCCESS: [], // Terminal state
  FAILED: [], // Terminal state
  BLOCKED: ['READY', 'CANCELLED'],
  CANCELLED: [], // Terminal state
};

/**
 * Check if transition is valid
 */
export function canTransition(
  from: TaskRunStatus,
  to: TaskRunStatus
): boolean {
  const validNextStates = VALID_TRANSITIONS[from];
  return validNextStates.includes(to);
}

/**
 * Determine next status based on current status and event
 */
export function nextStatus(
  current: TaskRunStatus,
  event: TaskEvent
): TaskRunStatus {
  switch (event.type) {
    case 'DEPENDENCIES_MET':
      if (current === 'PENDING') return 'READY';
      throw new Error(`Cannot process DEPENDENCIES_MET from ${current}`);

    case 'APPROVAL_REQUIRED':
      if (current === 'PENDING') return 'BLOCKED';
      throw new Error(`Cannot process APPROVAL_REQUIRED from ${current}`);

    case 'SCHEDULED':
      if (current === 'READY') return 'QUEUED';
      throw new Error(`Cannot schedule from ${current}`);

    case 'CLAIMED':
      if (current === 'QUEUED') return 'RUNNING';
      throw new Error(`Cannot claim from ${current}`);

    case 'COMPLETED':
      if (current === 'RUNNING') return 'SUCCESS';
      throw new Error(`Cannot complete from ${current}`);

    case 'ERRORED':
      if (current === 'RUNNING') {
        return event.retriable ? 'QUEUED' : 'FAILED';
      }
      throw new Error(`Cannot error from ${current}`);

    case 'APPROVED':
      if (current === 'BLOCKED') return 'READY';
      throw new Error(`Cannot approve from ${current}`);

    case 'CANCELLED':
      // Can cancel from any non-terminal state
      if (isTerminal(current)) {
        throw new Error(`Cannot cancel from terminal state ${current}`);
      }
      return 'CANCELLED';

    default:
      throw new Error(`Unknown event type`);
  }
}

/**
 * Check if status is terminal (no further transitions)
 */
export function isTerminal(status: TaskRunStatus): boolean {
  return status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * Check if status is active (task is in progress or queued)
 */
export function isActive(status: TaskRunStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

/**
 * Check if status indicates waiting (for dependencies or approval)
 */
export function isWaiting(status: TaskRunStatus): boolean {
  return status === 'PENDING' || status === 'BLOCKED';
}

/**
 * Check if status is ready to be scheduled
 */
export function isSchedulable(status: TaskRunStatus): boolean {
  return status === 'READY';
}
