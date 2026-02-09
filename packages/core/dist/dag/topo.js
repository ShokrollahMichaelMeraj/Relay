"use strict";
/**
 * Topological sort
 * Compute execution order for tasks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.topoSort = topoSort;
exports.computeExecutionPhases = computeExecutionPhases;
exports.computeTaskDepths = computeTaskDepths;
/**
 * Topological sort using Kahn's algorithm
 * Returns array of task IDs in execution order
 * Throws error if cycle detected
 */
function topoSort(dag) {
    const sorted = [];
    const inDegree = new Map();
    const queue = [];
    // Step 1: Calculate in-degree for all nodes
    for (const taskId of dag.nodes.keys()) {
        const deps = dag.dependencies.get(taskId) || [];
        inDegree.set(taskId, deps.length);
        // Add roots to queue
        if (deps.length === 0) {
            queue.push(taskId);
        }
    }
    // Step 2: Process queue
    while (queue.length > 0) {
        const taskId = queue.shift();
        sorted.push(taskId);
        // For each child, decrement in-degree
        const children = dag.edges.get(taskId) || [];
        for (const childId of children) {
            const currentDegree = inDegree.get(childId);
            inDegree.set(childId, currentDegree - 1);
            // If in-degree becomes 0, add to queue
            if (currentDegree - 1 === 0) {
                queue.push(childId);
            }
        }
    }
    // Step 3: Check if all nodes were processed
    if (sorted.length !== dag.nodes.size) {
        throw new Error('Cycle detected - topological sort failed');
    }
    return sorted;
}
/**
 * Compute execution phases (levels) for parallel execution
 * Returns array of arrays, where each inner array contains tasks
 * that can run in parallel
 */
function computeExecutionPhases(dag) {
    const phases = [];
    const processed = new Set();
    const inDegree = new Map();
    // Initialize in-degrees
    for (const taskId of dag.nodes.keys()) {
        const deps = dag.dependencies.get(taskId) || [];
        inDegree.set(taskId, deps.length);
    }
    // Process in phases
    while (processed.size < dag.nodes.size) {
        const currentPhase = [];
        // Find all tasks with in-degree 0 (relative to unprocessed tasks)
        for (const [taskId, degree] of inDegree) {
            if (degree === 0 && !processed.has(taskId)) {
                currentPhase.push(taskId);
            }
        }
        if (currentPhase.length === 0) {
            throw new Error('Cycle detected - no tasks ready in phase');
        }
        // Mark these tasks as processed
        for (const taskId of currentPhase) {
            processed.add(taskId);
            // Decrement in-degree of children
            const children = dag.edges.get(taskId) || [];
            for (const childId of children) {
                const current = inDegree.get(childId);
                inDegree.set(childId, current - 1);
            }
        }
        phases.push(currentPhase);
    }
    return phases;
}
/**
 * Get the depth of each task (longest path from root)
 */
function computeTaskDepths(dag) {
    const depths = new Map();
    const sorted = topoSort(dag);
    // Process in topological order
    for (const taskId of sorted) {
        const deps = dag.dependencies.get(taskId) || [];
        if (deps.length === 0) {
            // Root task
            depths.set(taskId, 0);
        }
        else {
            // Depth = max(parent depths) + 1
            const maxParentDepth = Math.max(...deps.map((depId) => depths.get(depId) || 0));
            depths.set(taskId, maxParentDepth + 1);
        }
    }
    return depths;
}
//# sourceMappingURL=topo.js.map