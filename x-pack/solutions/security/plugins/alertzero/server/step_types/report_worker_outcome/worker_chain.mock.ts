/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SYSTEM_SECURITY_WORKER_FLOOR_ATTACK_DISCOVERY_ID } from '@kbn/alertzero-common';
import type { WorkerChainExecution } from './verify_worker_chain';

export const SPACE_ID = 'default';

export const REVIEW_EXECUTION_ID = 'exec-review';
export const RUNNER_EXECUTION_ID = 'exec-runner';
export const ROOT_EXECUTION_ID = 'exec-root';

/** A persisted, managed, non-test AlertZero execution in the fixture space. */
export const createExecution = (
  overrides: Partial<WorkerChainExecution> & Pick<WorkerChainExecution, 'id'>
): WorkerChainExecution => ({
  context: {},
  isTestRun: false,
  managed: true,
  managedBy: 'alertzero',
  originManagedWorkflowId: null,
  spaceId: SPACE_ID,
  triggeredBy: 'workflow-step',
  workflowDefinition: { consts: {} },
  ...overrides,
});

/**
 * The Attack Discovery chain: floor (root) -> runner (`workflow.execute`) -> review
 * (`workflow.executeAsync`). The runner already finished, so its context carries the rewritten
 * nested `parent`; the review is still running, so it carries the flat creation-time key.
 */
export const createAttackDiscoveryChain = (): Record<string, WorkerChainExecution> => ({
  [REVIEW_EXECUTION_ID]: createExecution({
    context: { parentWorkflowExecutionId: RUNNER_EXECUTION_ID },
    id: REVIEW_EXECUTION_ID,
  }),
  [ROOT_EXECUTION_ID]: createExecution({
    context: {},
    id: ROOT_EXECUTION_ID,
    originManagedWorkflowId: SYSTEM_SECURITY_WORKER_FLOOR_ATTACK_DISCOVERY_ID,
    triggeredBy: 'scheduled',
    workflowDefinition: { consts: { worker_settings: { autonomy: 'assisted' } } },
  }),
  [RUNNER_EXECUTION_ID]: createExecution({
    context: { parent: { executionId: ROOT_EXECUTION_ID, workflowId: 'wf-floor' } },
    id: RUNNER_EXECUTION_ID,
  }),
});

/** An execution reader over an in-memory map, returning `null` for unknown ids. */
export const createExecutionReader = (executions: Record<string, WorkerChainExecution>) =>
  jest.fn(async (executionId: string) => executions[executionId] ?? null);
