"use strict";
/**
 * Dependency unlock logic
 * Determines which tasks become READY after a task completes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeUnlocked = computeUnlocked;
exports.computeInitialReady = computeInitialReady;
exports.areDependenciesSatisfied = areDependenciesSatisfied;
exports.isRunComplete = isRunComplete;
exports.computeRunStatus = computeRunStatus;
const build_1 = require("../dag/build");
/**
 * Compute which tasks should be unlocked after a task completes
 */
function computeUnlocked(completed_task_id, dag, current_statuses, requires_approval) {
    const newly_ready = [];
    const newly_blocked = [];
    const downstream = (0, build_1.getDownstream)(dag, completed_task_id);
    for (const child_id of downstream) {
        if (current_statuses.get(child_id) !== 'PENDING') {
            continue;
        }
        const all_deps = (0, build_1.getUpstream)(dag, child_id);
        const all_satisfied = all_deps.every((dep_id) => current_statuses.get(dep_id) === 'SUCCESS');
        if (all_satisfied) {
            if (requires_approval.get(child_id)) {
                newly_blocked.push(child_id);
            }
            else {
                newly_ready.push(child_id);
            }
        }
    }
    return { newly_ready, newly_blocked };
}
/**
 * Find all tasks that should be READY at the start of a run
 */
function computeInitialReady(dag, requires_approval) {
    const newly_ready = [];
    const newly_blocked = [];
    for (const task_id of dag.roots) {
        if (requires_approval.get(task_id)) {
            newly_blocked.push(task_id);
        }
        else {
            newly_ready.push(task_id);
        }
    }
    return { newly_ready, newly_blocked };
}
/**
 * Check if a specific task's dependencies are all satisfied
 */
function areDependenciesSatisfied(task_id, dag, current_statuses) {
    const deps = (0, build_1.getUpstream)(dag, task_id);
    if (deps.length === 0) {
        return true;
    }
    return deps.every((dep_id) => current_statuses.get(dep_id) === 'SUCCESS');
}
/**
 * Check if all tasks in a run are in terminal states
 */
function isRunComplete(statuses) {
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
function computeRunStatus(statuses) {
    let has_failed = false;
    let has_cancelled = false;
    let has_success = false;
    for (const status of statuses.values()) {
        if (status === 'FAILED') {
            has_failed = true;
        }
        else if (status === 'CANCELLED') {
            has_cancelled = true;
        }
        else if (status === 'SUCCESS') {
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
//# sourceMappingURL=unlock.js.map