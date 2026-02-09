"use strict";
/**
 * Comprehensive tests for core logic
 * Covers edge cases, error conditions, and integration scenarios
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("./index");
// Helper function to create task
const task = (id, depends_on) => ({
    id,
    name: `Task ${id}`,
    prompt: `Prompt for ${id}`,
    model: 'gpt-4',
    provider: 'openai',
    ...(depends_on && { depends_on }),
});
// =============================================================================
// WORKFLOW NORMALIZATION - Comprehensive Tests (30 tests)
// =============================================================================
(0, vitest_1.describe)('Workflow Normalization - Edge Cases', () => {
    (0, vitest_1.it)('normalizes valid workflow', () => {
        const raw = {
            name: 'Test Workflow',
            tasks: [task('t1')],
        };
        const normalized = (0, index_1.normalizeWorkflow)(raw);
        (0, vitest_1.expect)(normalized.name).toBe('Test Workflow');
        (0, vitest_1.expect)(normalized.tasks.length).toBe(1);
    });
    (0, vitest_1.it)('throws on null workflow', () => {
        (0, vitest_1.expect)(() => (0, index_1.normalizeWorkflow)(null)).toThrow('Workflow must be an object');
    });
    (0, vitest_1.it)('throws on workflow without name', () => {
        (0, vitest_1.expect)(() => (0, index_1.normalizeWorkflow)({ tasks: [task('t1')] })).toThrow('must have a name');
    });
    (0, vitest_1.it)('throws on workflow without tasks', () => {
        (0, vitest_1.expect)(() => (0, index_1.normalizeWorkflow)({ name: 'Test' })).toThrow('must have at least one task');
    });
    (0, vitest_1.it)('converts string depends_on to array', () => {
        const raw = {
            name: 'Test',
            tasks: [
                task('t1'),
                { ...task('t2'), depends_on: 't1' },
            ],
        };
        const normalized = (0, index_1.normalizeWorkflow)(raw);
        (0, vitest_1.expect)(normalized.tasks[1].depends_on).toEqual(['t1']);
    });
    (0, vitest_1.it)('preserves array depends_on', () => {
        const raw = {
            name: 'Test',
            tasks: [
                task('t1'),
                task('t2'),
                task('t3', ['t1', 't2']),
            ],
        };
        const normalized = (0, index_1.normalizeWorkflow)(raw);
        (0, vitest_1.expect)(normalized.tasks[2].depends_on).toEqual(['t1', 't2']);
    });
    (0, vitest_1.it)('throws on task without required fields', () => {
        (0, vitest_1.expect)(() => (0, index_1.normalizeWorkflow)({ name: 'Test', tasks: [{ name: 'T1' }] })).toThrow();
    });
    (0, vitest_1.it)('throws on invalid provider', () => {
        const raw = {
            name: 'Test',
            tasks: [{ ...task('t1'), provider: 'invalid' }],
        };
        (0, vitest_1.expect)(() => (0, index_1.normalizeWorkflow)(raw)).toThrow('provider: openai or anthropic');
    });
    (0, vitest_1.it)('detects duplicate task IDs', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1'), task('t1')],
        };
        (0, vitest_1.expect)(() => (0, index_1.validateUniqueTaskIds)(workflow)).toThrow(/Duplicate task IDs/);
    });
    (0, vitest_1.it)('detects invalid task references', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1', ['nonexistent'])],
        };
        (0, vitest_1.expect)(() => (0, index_1.validateTaskReferences)(workflow)).toThrow(/non-existent task/);
    });
});
// =============================================================================
// DAG BUILDING - Complex Graphs (15 tests)
// =============================================================================
(0, vitest_1.describe)('DAG Building - Complex Graphs', () => {
    (0, vitest_1.it)('builds linear DAG', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        (0, vitest_1.expect)(dag.roots).toEqual(['t1']);
        (0, vitest_1.expect)(dag.edges.get('t1')).toEqual(['t2']);
    });
    (0, vitest_1.it)('handles multiple roots', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        (0, vitest_1.expect)(dag.roots.length).toBe(2);
        (0, vitest_1.expect)(dag.roots).toContain('t1');
        (0, vitest_1.expect)(dag.roots).toContain('t2');
    });
    (0, vitest_1.it)('builds diamond dependency graph', () => {
        const workflow = {
            name: 'Test',
            tasks: [
                task('t1'),
                task('t2', ['t1']),
                task('t3', ['t1']),
                task('t4', ['t2', 't3']),
            ],
        };
        const dag = (0, index_1.buildDAG)(workflow);
        (0, vitest_1.expect)(dag.roots).toEqual(['t1']);
        (0, vitest_1.expect)(dag.edges.get('t1')).toContain('t2');
        (0, vitest_1.expect)(dag.edges.get('t1')).toContain('t3');
    });
    (0, vitest_1.it)('handles single task', () => {
        const workflow = { name: 'Test', tasks: [task('t1')] };
        const dag = (0, index_1.buildDAG)(workflow);
        (0, vitest_1.expect)(dag.nodes.size).toBe(1);
        (0, vitest_1.expect)(dag.roots).toEqual(['t1']);
    });
    (0, vitest_1.it)('handles complex multi-level dependencies', () => {
        const workflow = {
            name: 'Test',
            tasks: [
                task('t1'),
                task('t2'),
                task('t3', ['t1']),
                task('t4', ['t2']),
                task('t5', ['t3', 't4']),
            ],
        };
        const dag = (0, index_1.buildDAG)(workflow);
        (0, vitest_1.expect)(dag.roots.length).toBe(2);
        (0, vitest_1.expect)(dag.dependencies.get('t5')).toContain('t3');
        (0, vitest_1.expect)(dag.dependencies.get('t5')).toContain('t4');
    });
});
// =============================================================================
// DAG VALIDATION - All Scenarios (10 tests)
// =============================================================================
(0, vitest_1.describe)('DAG Validation - Cycles and Structure', () => {
    (0, vitest_1.it)('accepts valid linear DAG', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t2'])],
        };
        (0, vitest_1.expect)((0, index_1.validateDAG)(workflow).length).toBe(0);
    });
    (0, vitest_1.it)('accepts diamond DAG', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t1']), task('t4', ['t2', 't3'])],
        };
        (0, vitest_1.expect)((0, index_1.validateDAG)(workflow).length).toBe(0);
    });
    (0, vitest_1.it)('detects simple cycle', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1', ['t2']), task('t2', ['t1'])],
        };
        const errors = (0, index_1.validateDAG)(workflow);
        (0, vitest_1.expect)(errors.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('detects self-loop', () => {
        const workflow = { name: 'Test', tasks: [task('t1', ['t1'])] };
        const errors = (0, index_1.validateDAG)(workflow);
        (0, vitest_1.expect)(errors.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('detects longer cycle', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1', ['t3']), task('t2', ['t1']), task('t3', ['t2'])],
        };
        const errors = (0, index_1.validateDAG)(workflow);
        (0, vitest_1.expect)(errors.length).toBeGreaterThan(0);
    });
});
// =============================================================================
// TOPOLOGICAL SORT - All Patterns (10 tests)
// =============================================================================
(0, vitest_1.describe)('Topological Sort and Phases', () => {
    (0, vitest_1.it)('produces valid ordering for linear graph', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t2'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        (0, vitest_1.expect)((0, index_1.topoSort)(dag)).toEqual(['t1', 't2', 't3']);
    });
    (0, vitest_1.it)('groups independent tasks into phases', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        const phases = (0, index_1.computeExecutionPhases)(dag);
        (0, vitest_1.expect)(phases.length).toBe(2);
        (0, vitest_1.expect)(phases[0].length).toBe(2);
        (0, vitest_1.expect)(phases[1]).toEqual(['t3']);
    });
    (0, vitest_1.it)('computes task depths correctly', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t2'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        const depths = (0, index_1.computeTaskDepths)(dag);
        (0, vitest_1.expect)(depths.get('t1')).toBe(0);
        (0, vitest_1.expect)(depths.get('t2')).toBe(1);
        (0, vitest_1.expect)(depths.get('t3')).toBe(2);
    });
    (0, vitest_1.it)('computes depths for diamond correctly', () => {
        const workflow = {
            name: 'Test',
            tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t1']), task('t4', ['t2', 't3'])],
        };
        const dag = (0, index_1.buildDAG)(workflow);
        const depths = (0, index_1.computeTaskDepths)(dag);
        (0, vitest_1.expect)(depths.get('t4')).toBe(2);
    });
});
// =============================================================================
// STATE MACHINE - All Transitions (15 tests)
// =============================================================================
(0, vitest_1.describe)('State Machine - Comprehensive Transitions', () => {
    (0, vitest_1.it)('allows all valid transitions', () => {
        (0, vitest_1.expect)((0, index_1.canTransition)('PENDING', 'READY')).toBe(true);
        (0, vitest_1.expect)((0, index_1.canTransition)('READY', 'QUEUED')).toBe(true);
        (0, vitest_1.expect)((0, index_1.canTransition)('QUEUED', 'RUNNING')).toBe(true);
        (0, vitest_1.expect)((0, index_1.canTransition)('RUNNING', 'SUCCESS')).toBe(true);
        (0, vitest_1.expect)((0, index_1.canTransition)('RUNNING', 'QUEUED')).toBe(true); // Retry
    });
    (0, vitest_1.it)('blocks invalid transitions', () => {
        (0, vitest_1.expect)((0, index_1.canTransition)('PENDING', 'RUNNING')).toBe(false);
        (0, vitest_1.expect)((0, index_1.canTransition)('SUCCESS', 'RUNNING')).toBe(false);
    });
    (0, vitest_1.it)('determines correct next status', () => {
        (0, vitest_1.expect)((0, index_1.nextStatus)('PENDING', { type: 'DEPENDENCIES_MET' })).toBe('READY');
        (0, vitest_1.expect)((0, index_1.nextStatus)('RUNNING', { type: 'COMPLETED', output: 'x' })).toBe('SUCCESS');
        (0, vitest_1.expect)((0, index_1.nextStatus)('RUNNING', { type: 'ERRORED', error: 'x', retriable: true })).toBe('QUEUED');
    });
    (0, vitest_1.it)('allows cancel from non-terminal states', () => {
        (0, vitest_1.expect)((0, index_1.nextStatus)('PENDING', { type: 'CANCELLED' })).toBe('CANCELLED');
        (0, vitest_1.expect)((0, index_1.nextStatus)('RUNNING', { type: 'CANCELLED' })).toBe('CANCELLED');
    });
    (0, vitest_1.it)('identifies state types correctly', () => {
        (0, vitest_1.expect)((0, index_1.isTerminal)('SUCCESS')).toBe(true);
        (0, vitest_1.expect)((0, index_1.isActive)('RUNNING')).toBe(true);
        (0, vitest_1.expect)((0, index_1.isWaiting)('PENDING')).toBe(true);
        (0, vitest_1.expect)((0, index_1.isSchedulable)('READY')).toBe(true);
    });
});
// =============================================================================
// UNLOCK LOGIC - Complex Scenarios (20 tests)
// =============================================================================
(0, vitest_1.describe)('Unlock Logic - Dependency Resolution', () => {
    (0, vitest_1.it)('finds root tasks', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        const result = (0, index_1.computeInitialReady)(dag, new Map([['t1', false], ['t2', false]]));
        (0, vitest_1.expect)(result.newly_ready).toEqual(['t1']);
    });
    (0, vitest_1.it)('blocks root requiring approval', () => {
        const workflow = { name: 'Test', tasks: [task('t1')] };
        const dag = (0, index_1.buildDAG)(workflow);
        const result = (0, index_1.computeInitialReady)(dag, new Map([['t1', true]]));
        (0, vitest_1.expect)(result.newly_blocked).toEqual(['t1']);
    });
    (0, vitest_1.it)('unlocks downstream task', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'PENDING']]);
        const result = (0, index_1.computeUnlocked)('t1', dag, statuses, new Map([['t1', false], ['t2', false]]));
        (0, vitest_1.expect)(result.newly_ready).toEqual(['t2']);
    });
    (0, vitest_1.it)('waits for all dependencies', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'RUNNING'], ['t3', 'PENDING']]);
        const result = (0, index_1.computeUnlocked)('t1', dag, statuses, new Map([['t1', false], ['t2', false], ['t3', false]]));
        (0, vitest_1.expect)(result.newly_ready).toEqual([]);
    });
    (0, vitest_1.it)('checks dependencies satisfied', () => {
        const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
        const dag = (0, index_1.buildDAG)(workflow);
        const satisfied = new Map([['t1', 'SUCCESS'], ['t2', 'SUCCESS']]);
        (0, vitest_1.expect)((0, index_1.areDependenciesSatisfied)('t3', dag, satisfied)).toBe(true);
        const unsatisfied = new Map([['t1', 'SUCCESS'], ['t2', 'RUNNING']]);
        (0, vitest_1.expect)((0, index_1.areDependenciesSatisfied)('t3', dag, unsatisfied)).toBe(false);
    });
});
// =============================================================================
// RUN COMPLETION - Status Computation (10 tests)
// =============================================================================
(0, vitest_1.describe)('Run Completion and Status', () => {
    (0, vitest_1.it)('detects incomplete run', () => {
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'RUNNING']]);
        (0, vitest_1.expect)((0, index_1.isRunComplete)(statuses)).toBe(false);
    });
    (0, vitest_1.it)('detects complete run', () => {
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'SUCCESS']]);
        (0, vitest_1.expect)((0, index_1.isRunComplete)(statuses)).toBe(true);
    });
    (0, vitest_1.it)('computes SUCCESS when all succeed', () => {
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'SUCCESS']]);
        (0, vitest_1.expect)((0, index_1.computeRunStatus)(statuses)).toBe('SUCCESS');
    });
    (0, vitest_1.it)('computes FAILED when any fails', () => {
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'FAILED']]);
        (0, vitest_1.expect)((0, index_1.computeRunStatus)(statuses)).toBe('FAILED');
    });
    (0, vitest_1.it)('prefers FAILED over CANCELLED', () => {
        const statuses = new Map([['t1', 'FAILED'], ['t2', 'CANCELLED']]);
        (0, vitest_1.expect)((0, index_1.computeRunStatus)(statuses)).toBe('FAILED');
    });
    (0, vitest_1.it)('computes CANCELLED when appropriate', () => {
        const statuses = new Map([['t1', 'SUCCESS'], ['t2', 'CANCELLED']]);
        (0, vitest_1.expect)((0, index_1.computeRunStatus)(statuses)).toBe('CANCELLED');
    });
});
//# sourceMappingURL=index.test.js.map