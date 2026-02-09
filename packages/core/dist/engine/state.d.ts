/**
 * State machine for task execution
 * Defines valid state transitions and events
 */
import { TaskRunStatus } from '@relay/types';
/**
 * Events that trigger state transitions
 */
export type TaskEvent = {
    type: 'DEPENDENCIES_MET';
} | {
    type: 'APPROVAL_REQUIRED';
} | {
    type: 'SCHEDULED';
} | {
    type: 'CLAIMED';
} | {
    type: 'COMPLETED';
    output: string;
} | {
    type: 'ERRORED';
    error: string;
    retriable: boolean;
} | {
    type: 'APPROVED';
} | {
    type: 'CANCELLED';
};
/**
 * Check if transition is valid
 */
export declare function canTransition(from: TaskRunStatus, to: TaskRunStatus): boolean;
/**
 * Determine next status based on current status and event
 */
export declare function nextStatus(current: TaskRunStatus, event: TaskEvent): TaskRunStatus;
/**
 * Check if status is terminal (no further transitions)
 */
export declare function isTerminal(status: TaskRunStatus): boolean;
/**
 * Check if status is active (task is in progress or queued)
 */
export declare function isActive(status: TaskRunStatus): boolean;
/**
 * Check if status indicates waiting (for dependencies or approval)
 */
export declare function isWaiting(status: TaskRunStatus): boolean;
/**
 * Check if status is ready to be scheduled
 */
export declare function isSchedulable(status: TaskRunStatus): boolean;
//# sourceMappingURL=state.d.ts.map