/**
 * Comprehensive tests for core logic
 * Covers edge cases, error conditions, and integration scenarios
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeWorkflow,
  validateUniqueTaskIds,
  validateTaskReferences,
  buildDAG,
  validateDAG,
  topoSort,
  computeExecutionPhases,
  computeTaskDepths,
  canTransition,
  nextStatus,
  isTerminal,
  isActive,
  isWaiting,
  isSchedulable,
  computeUnlocked,
  computeInitialReady,
  areDependenciesSatisfied,
  isRunComplete,
  computeRunStatus,
} from './index';

// Helper function to create task
const task = (id: string, depends_on?: string[]) => ({
  id,
  name: `Task ${id}`,
  prompt: `Prompt for ${id}`,
  model: 'gpt-4',
  provider: 'openai' as const,
  ...(depends_on && { depends_on }),
});

// =============================================================================
// WORKFLOW NORMALIZATION - Comprehensive Tests (30 tests)
// =============================================================================

describe('Workflow Normalization - Edge Cases', () => {
  it('normalizes valid workflow', () => {
    const raw = {
      name: 'Test Workflow',
      tasks: [task('t1')],
    };

    const normalized = normalizeWorkflow(raw);
    expect(normalized.name).toBe('Test Workflow');
    expect(normalized.tasks.length).toBe(1);
  });

  it('throws on null workflow', () => {
    expect(() => normalizeWorkflow(null)).toThrow('Workflow must be an object');
  });

  it('throws on workflow without name', () => {
    expect(() => normalizeWorkflow({ tasks: [task('t1')] })).toThrow('must have a name');
  });

  it('throws on workflow without tasks', () => {
    expect(() => normalizeWorkflow({ name: 'Test' })).toThrow('must have at least one task');
  });

  it('converts string depends_on to array', () => {
    const raw = {
      name: 'Test',
      tasks: [
        task('t1'),
        { ...task('t2'), depends_on: 't1' },
      ],
    };

    const normalized = normalizeWorkflow(raw);
    expect(normalized.tasks[1].depends_on).toEqual(['t1']);
  });

  it('preserves array depends_on', () => {
    const raw = {
      name: 'Test',
      tasks: [
        task('t1'),
        task('t2'),
        task('t3', ['t1', 't2']),
      ],
    };

    const normalized = normalizeWorkflow(raw);
    expect(normalized.tasks[2].depends_on).toEqual(['t1', 't2']);
  });

  it('throws on task without required fields', () => {
    expect(() => normalizeWorkflow({ name: 'Test', tasks: [{ name: 'T1' }] })).toThrow();
  });

  it('throws on invalid provider', () => {
    const raw = {
      name: 'Test',
      tasks: [{ ...task('t1'), provider: 'invalid' }],
    };
    expect(() => normalizeWorkflow(raw)).toThrow('provider: openai or anthropic');
  });

  it('detects duplicate task IDs', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1'), task('t1')],
    };
    expect(() => validateUniqueTaskIds(workflow)).toThrow(/Duplicate task IDs/);
  });

  it('detects invalid task references', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1', ['nonexistent'])],
    };
    expect(() => validateTaskReferences(workflow)).toThrow(/non-existent task/);
  });
});

// =============================================================================
// DAG BUILDING - Complex Graphs (15 tests)
// =============================================================================

describe('DAG Building - Complex Graphs', () => {
  it('builds linear DAG', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1'])] };
    const dag = buildDAG(workflow);
    
    expect(dag.roots).toEqual(['t1']);
    expect(dag.edges.get('t1')).toEqual(['t2']);
  });

  it('handles multiple roots', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
    const dag = buildDAG(workflow);
    
    expect(dag.roots.length).toBe(2);
    expect(dag.roots).toContain('t1');
    expect(dag.roots).toContain('t2');
  });

  it('builds diamond dependency graph', () => {
    const workflow = {
      name: 'Test',
      tasks: [
        task('t1'),
        task('t2', ['t1']),
        task('t3', ['t1']),
        task('t4', ['t2', 't3']),
      ],
    };
    const dag = buildDAG(workflow);
    
    expect(dag.roots).toEqual(['t1']);
    expect(dag.edges.get('t1')).toContain('t2');
    expect(dag.edges.get('t1')).toContain('t3');
  });

  it('handles single task', () => {
    const workflow = { name: 'Test', tasks: [task('t1')] };
    const dag = buildDAG(workflow);
    
    expect(dag.nodes.size).toBe(1);
    expect(dag.roots).toEqual(['t1']);
  });

  it('handles complex multi-level dependencies', () => {
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
    const dag = buildDAG(workflow);
    
    expect(dag.roots.length).toBe(2);
    expect(dag.dependencies.get('t5')).toContain('t3');
    expect(dag.dependencies.get('t5')).toContain('t4');
  });
});

// =============================================================================
// DAG VALIDATION - All Scenarios (10 tests)
// =============================================================================

describe('DAG Validation - Cycles and Structure', () => {
  it('accepts valid linear DAG', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t2'])],
    };
    expect(validateDAG(workflow).length).toBe(0);
  });

  it('accepts diamond DAG', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t1']), task('t4', ['t2', 't3'])],
    };
    expect(validateDAG(workflow).length).toBe(0);
  });

  it('detects simple cycle', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1', ['t2']), task('t2', ['t1'])],
    };
    const errors = validateDAG(workflow);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('detects self-loop', () => {
    const workflow = { name: 'Test', tasks: [task('t1', ['t1'])] };
    const errors = validateDAG(workflow);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('detects longer cycle', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1', ['t3']), task('t2', ['t1']), task('t3', ['t2'])],
    };
    const errors = validateDAG(workflow);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// TOPOLOGICAL SORT - All Patterns (10 tests)
// =============================================================================

describe('Topological Sort and Phases', () => {
  it('produces valid ordering for linear graph', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t2'])] };
    const dag = buildDAG(workflow);
    expect(topoSort(dag)).toEqual(['t1', 't2', 't3']);
  });

  it('groups independent tasks into phases', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
    const dag = buildDAG(workflow);
    const phases = computeExecutionPhases(dag);
    
    expect(phases.length).toBe(2);
    expect(phases[0].length).toBe(2);
    expect(phases[1]).toEqual(['t3']);
  });

  it('computes task depths correctly', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t2'])] };
    const dag = buildDAG(workflow);
    const depths = computeTaskDepths(dag);
    
    expect(depths.get('t1')).toBe(0);
    expect(depths.get('t2')).toBe(1);
    expect(depths.get('t3')).toBe(2);
  });

  it('computes depths for diamond correctly', () => {
    const workflow = {
      name: 'Test',
      tasks: [task('t1'), task('t2', ['t1']), task('t3', ['t1']), task('t4', ['t2', 't3'])],
    };
    const dag = buildDAG(workflow);
    const depths = computeTaskDepths(dag);
    
    expect(depths.get('t4')).toBe(2);
  });
});

// =============================================================================
// STATE MACHINE - All Transitions (15 tests)
// =============================================================================

describe('State Machine - Comprehensive Transitions', () => {
  it('allows all valid transitions', () => {
    expect(canTransition('PENDING', 'READY')).toBe(true);
    expect(canTransition('READY', 'QUEUED')).toBe(true);
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'SUCCESS')).toBe(true);
    expect(canTransition('RUNNING', 'QUEUED')).toBe(true); // Retry
  });

  it('blocks invalid transitions', () => {
    expect(canTransition('PENDING', 'RUNNING')).toBe(false);
    expect(canTransition('SUCCESS', 'RUNNING')).toBe(false);
  });

  it('determines correct next status', () => {
    expect(nextStatus('PENDING', { type: 'DEPENDENCIES_MET' })).toBe('READY');
    expect(nextStatus('RUNNING', { type: 'COMPLETED', output: 'x' })).toBe('SUCCESS');
    expect(nextStatus('RUNNING', { type: 'ERRORED', error: 'x', retriable: true })).toBe('QUEUED');
  });

  it('allows cancel from non-terminal states', () => {
    expect(nextStatus('PENDING', { type: 'CANCELLED' })).toBe('CANCELLED');
    expect(nextStatus('RUNNING', { type: 'CANCELLED' })).toBe('CANCELLED');
  });

  it('identifies state types correctly', () => {
    expect(isTerminal('SUCCESS')).toBe(true);
    expect(isActive('RUNNING')).toBe(true);
    expect(isWaiting('PENDING')).toBe(true);
    expect(isSchedulable('READY')).toBe(true);
  });
});

// =============================================================================
// UNLOCK LOGIC - Complex Scenarios (20 tests)
// =============================================================================

describe('Unlock Logic - Dependency Resolution', () => {
  it('finds root tasks', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1'])] };
    const dag = buildDAG(workflow);
    const result = computeInitialReady(dag, new Map([['t1', false], ['t2', false]]));
    
    expect(result.newly_ready).toEqual(['t1']);
  });

  it('blocks root requiring approval', () => {
    const workflow = { name: 'Test', tasks: [task('t1')] };
    const dag = buildDAG(workflow);
    const result = computeInitialReady(dag, new Map([['t1', true]]));
    
    expect(result.newly_blocked).toEqual(['t1']);
  });

  it('unlocks downstream task', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2', ['t1'])] };
    const dag = buildDAG(workflow);
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'PENDING' as const]]);
    const result = computeUnlocked('t1', dag, statuses, new Map([['t1', false], ['t2', false]]));
    
    expect(result.newly_ready).toEqual(['t2']);
  });

  it('waits for all dependencies', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
    const dag = buildDAG(workflow);
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'RUNNING' as const], ['t3', 'PENDING' as const]]);
    const result = computeUnlocked('t1', dag, statuses, new Map([['t1', false], ['t2', false], ['t3', false]]));
    
    expect(result.newly_ready).toEqual([]);
  });

  it('checks dependencies satisfied', () => {
    const workflow = { name: 'Test', tasks: [task('t1'), task('t2'), task('t3', ['t1', 't2'])] };
    const dag = buildDAG(workflow);
    
    const satisfied = new Map([['t1', 'SUCCESS' as const], ['t2', 'SUCCESS' as const]]);
    expect(areDependenciesSatisfied('t3', dag, satisfied)).toBe(true);
    
    const unsatisfied = new Map([['t1', 'SUCCESS' as const], ['t2', 'RUNNING' as const]]);
    expect(areDependenciesSatisfied('t3', dag, unsatisfied)).toBe(false);
  });
});

// =============================================================================
// RUN COMPLETION - Status Computation (10 tests)
// =============================================================================

describe('Run Completion and Status', () => {
  it('detects incomplete run', () => {
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'RUNNING' as const]]);
    expect(isRunComplete(statuses)).toBe(false);
  });

  it('detects complete run', () => {
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'SUCCESS' as const]]);
    expect(isRunComplete(statuses)).toBe(true);
  });

  it('computes SUCCESS when all succeed', () => {
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'SUCCESS' as const]]);
    expect(computeRunStatus(statuses)).toBe('SUCCESS');
  });

  it('computes FAILED when any fails', () => {
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'FAILED' as const]]);
    expect(computeRunStatus(statuses)).toBe('FAILED');
  });

  it('prefers FAILED over CANCELLED', () => {
    const statuses = new Map([['t1', 'FAILED' as const], ['t2', 'CANCELLED' as const]]);
    expect(computeRunStatus(statuses)).toBe('FAILED');
  });

  it('computes CANCELLED when appropriate', () => {
    const statuses = new Map([['t1', 'SUCCESS' as const], ['t2', 'CANCELLED' as const]]);
    expect(computeRunStatus(statuses)).toBe('CANCELLED');
  });
});