"use strict";
/**
 * DAG validation
 * Ensures workflow forms valid DAG (no cycles, valid references)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDAG = validateDAG;
exports.isValidDAG = isValidDAG;
const build_1 = require("./build");
/**
 * Validate that DAG has no cycles using DFS
 */
function validateDAG(workflow) {
    const errors = [];
    try {
        const dag = (0, build_1.buildDAG)(workflow);
        // Check 1: Must have at least one root
        if (dag.roots.length === 0) {
            errors.push({
                code: 'NO_ROOTS',
                message: 'Workflow has no root tasks (all tasks have dependencies). This creates a cycle.',
            });
            return errors; // Can't continue without roots
        }
        // Check 2: Detect cycles using DFS
        const cycleErrors = detectCycles(dag);
        errors.push(...cycleErrors);
        // Check 3: Check for unreachable tasks
        if (errors.length === 0) {
            const unreachableErrors = findUnreachableTasks(dag);
            errors.push(...unreachableErrors);
        }
    }
    catch (error) {
        errors.push({
            code: 'BUILD_ERROR',
            message: error.message,
        });
    }
    return errors;
}
/**
 * Detect cycles using DFS with 3-color algorithm
 * WHITE = unvisited, GRAY = in current path, BLACK = fully processed
 */
function detectCycles(dag) {
    const errors = [];
    const color = new Map();
    const path = [];
    // Initialize all nodes as WHITE
    for (const taskId of dag.nodes.keys()) {
        color.set(taskId, 'WHITE');
    }
    // DFS from each unvisited node
    for (const taskId of dag.nodes.keys()) {
        if (color.get(taskId) === 'WHITE') {
            const cycle = dfsVisit(dag, taskId, color, path);
            if (cycle) {
                errors.push({
                    code: 'CYCLE_DETECTED',
                    message: `Cycle detected: ${cycle.join(' → ')}`,
                });
            }
        }
    }
    return errors;
}
/**
 * DFS visit - returns cycle path if detected
 */
function dfsVisit(dag, taskId, color, path) {
    // Mark as visiting (in current path)
    color.set(taskId, 'GRAY');
    path.push(taskId);
    // Visit all downstream tasks
    const downstream = dag.edges.get(taskId) || [];
    for (const childId of downstream) {
        const childColor = color.get(childId);
        if (childColor === 'GRAY') {
            // Back edge detected - cycle!
            const cycleStart = path.indexOf(childId);
            return [...path.slice(cycleStart), childId];
        }
        if (childColor === 'WHITE') {
            const cycle = dfsVisit(dag, childId, color, path);
            if (cycle) {
                return cycle;
            }
        }
    }
    // Mark as fully processed
    color.set(taskId, 'BLACK');
    path.pop();
    return null;
}
/**
 * Find tasks that are not reachable from any root
 */
function findUnreachableTasks(dag) {
    const errors = [];
    const reachable = new Set();
    // BFS from all roots to find reachable tasks
    const queue = [...dag.roots];
    // Fix: Add roots one by one instead of spreading
    for (const root of dag.roots) {
        reachable.add(root);
    }
    while (queue.length > 0) {
        const taskId = queue.shift();
        const downstream = dag.edges.get(taskId) || [];
        for (const childId of downstream) {
            if (!reachable.has(childId)) {
                reachable.add(childId);
                queue.push(childId);
            }
        }
    }
    // Check for unreachable tasks
    for (const taskId of dag.nodes.keys()) {
        if (!reachable.has(taskId)) {
            errors.push({
                code: 'UNREACHABLE_TASK',
                message: `Task ${taskId} is not reachable from any root task`,
                task_id: taskId,
            });
        }
    }
    return errors;
}
/**
 * Quick validation check - returns true if valid
 */
function isValidDAG(workflow) {
    const errors = validateDAG(workflow);
    return errors.length === 0;
}
//# sourceMappingURL=validate.js.map