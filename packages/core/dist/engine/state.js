"use strict";
/**
 * State machine for task execution
 * Defines valid state transitions and events
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTransition = canTransition;
exports.nextStatus = nextStatus;
exports.isTerminal = isTerminal;
exports.isActive = isActive;
exports.isWaiting = isWaiting;
exports.isSchedulable = isSchedulable;
/**
 * Valid state transitions
 */
const VALID_TRANSITIONS = {
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
function canTransition(from, to) {
    const validNextStates = VALID_TRANSITIONS[from];
    return validNextStates.includes(to);
}
/**
 * Determine next status based on current status and event
 */
function nextStatus(current, event) {
    switch (event.type) {
        case 'DEPENDENCIES_MET':
            if (current === 'PENDING')
                return 'READY';
            throw new Error(`Cannot process DEPENDENCIES_MET from ${current}`);
        case 'APPROVAL_REQUIRED':
            if (current === 'PENDING')
                return 'BLOCKED';
            throw new Error(`Cannot process APPROVAL_REQUIRED from ${current}`);
        case 'SCHEDULED':
            if (current === 'READY')
                return 'QUEUED';
            throw new Error(`Cannot schedule from ${current}`);
        case 'CLAIMED':
            if (current === 'QUEUED')
                return 'RUNNING';
            throw new Error(`Cannot claim from ${current}`);
        case 'COMPLETED':
            if (current === 'RUNNING')
                return 'SUCCESS';
            throw new Error(`Cannot complete from ${current}`);
        case 'ERRORED':
            if (current === 'RUNNING') {
                return event.retriable ? 'QUEUED' : 'FAILED';
            }
            throw new Error(`Cannot error from ${current}`);
        case 'APPROVED':
            if (current === 'BLOCKED')
                return 'READY';
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
function isTerminal(status) {
    return status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
}
/**
 * Check if status is active (task is in progress or queued)
 */
function isActive(status) {
    return status === 'QUEUED' || status === 'RUNNING';
}
/**
 * Check if status indicates waiting (for dependencies or approval)
 */
function isWaiting(status) {
    return status === 'PENDING' || status === 'BLOCKED';
}
/**
 * Check if status is ready to be scheduled
 */
function isSchedulable(status) {
    return status === 'READY';
}
//# sourceMappingURL=state.js.map