"use strict";
/**
 * DAG (Directed Acyclic Graph) construction
 * Converts workflow definition into graph data structure
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDAG = buildDAG;
exports.getDownstream = getDownstream;
exports.getUpstream = getUpstream;
exports.isRoot = isRoot;
exports.getAllTaskIds = getAllTaskIds;
/**
 * Build DAG from workflow definition
 */
function buildDAG(workflow) {
    const nodes = new Map();
    const edges = new Map();
    const dependencies = new Map();
    // Step 1: Create nodes
    for (const task of workflow.tasks) {
        nodes.set(task.id, {
            id: task.id,
            name: task.name,
            task,
        });
        // Initialize empty edge lists
        edges.set(task.id, []);
        dependencies.set(task.id, []);
    }
    // Step 2: Build edges
    for (const task of workflow.tasks) {
        if (task.depends_on) {
            for (const depId of task.depends_on) {
                // Add edge: depId → task.id
                edges.get(depId).push(task.id);
                // Add reverse edge: task.id ← depId
                dependencies.get(task.id).push(depId);
            }
        }
    }
    // Step 3: Find roots (tasks with no dependencies)
    const roots = [];
    for (const [taskId, deps] of dependencies) {
        if (deps.length === 0) {
            roots.push(taskId);
        }
    }
    return { nodes, edges, dependencies, roots };
}
/**
 * Get all downstream tasks (tasks that depend on this task)
 */
function getDownstream(dag, taskId) {
    return dag.edges.get(taskId) || [];
}
/**
 * Get all upstream tasks (tasks this task depends on)
 */
function getUpstream(dag, taskId) {
    return dag.dependencies.get(taskId) || [];
}
/**
 * Check if task has any dependencies
 */
function isRoot(dag, taskId) {
    const deps = dag.dependencies.get(taskId);
    return !deps || deps.length === 0;
}
/**
 * Get all task IDs in the DAG
 */
function getAllTaskIds(dag) {
    return Array.from(dag.nodes.keys());
}
//# sourceMappingURL=build.js.map