/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SYSTEM_SECURITY_WORKER_IDS } from '@kbn/alertzero-common';
import type { WorkflowExecutionDto, WorkflowYaml } from '@kbn/workflows';
import { ALERTZERO_MANAGED_WORKFLOW_OWNER_ID } from '../../../common/constants';
import type { AlertZeroEnvelopeRoot } from '../../telemetry';
import { getParentExecutionId } from './get_parent_execution_id';
import type { ReportWorkerOutcomeSkipReason } from './skip_reasons';
import type { VerifiedChainCache } from './verified_chain_cache';
import { withTimeout } from './with_timeout';

/** Parent hops the walk follows at most; matches the engine's default `maxWorkflowDepth`. */
export const MAX_LINEAGE_HOPS = 10;

/** The persisted execution fields the walk reads. A management `WorkflowExecutionDto` fits. */
export type WorkerChainExecution = Pick<
  WorkflowExecutionDto,
  | 'context'
  | 'id'
  | 'isTestRun'
  | 'managed'
  | 'managedBy'
  | 'originManagedWorkflowId'
  | 'spaceId'
  | 'triggeredBy'
> & {
  workflowDefinition?: Pick<WorkflowYaml, 'consts'> | null;
};

export type WorkerChainVerification =
  | { root: AlertZeroEnvelopeRoot; verified: true }
  | { reason: ReportWorkerOutcomeSkipReason; verified: false };

export interface VerifyWorkerChainParams {
  abortSignal: AbortSignal;
  cache: VerifiedChainCache;
  /** The reporting execution; the walk starts from its persisted document. */
  executionId: string;
  /** Reads one persisted execution in `spaceId`, or `null` when it is missing or hidden. */
  getExecution: (executionId: string) => Promise<WorkerChainExecution | null>;
  hopTimeoutMs: number;
  spaceId: string;
}

const skip = (reason: ReportWorkerOutcomeSkipReason): WorkerChainVerification => ({
  reason,
  verified: false,
});

const isCatalogWorkerId = (id: string | null | undefined): boolean =>
  id != null && (SYSTEM_SECURITY_WORKER_IDS as readonly string[]).includes(id);

/** Keeps only what the envelope reads, so cached roots do not hold whole workflow definitions. */
const toEnvelopeRoot = ({
  context,
  id,
  originManagedWorkflowId,
  spaceId,
  triggeredBy,
  workflowDefinition,
}: WorkerChainExecution): AlertZeroEnvelopeRoot => ({
  context,
  id,
  originManagedWorkflowId,
  spaceId,
  triggeredBy,
  workflowDefinition: { consts: workflowDefinition?.consts },
});

const readExecution = async (
  { getExecution, hopTimeoutMs }: VerifyWorkerChainParams,
  executionId: string
): Promise<WorkerChainExecution | null> => {
  try {
    return await withTimeout(getExecution(executionId), hopTimeoutMs);
  } catch {
    return null;
  }
};

/** Why a persisted hop disqualifies the chain, if it does. */
const checkHop = (
  execution: WorkerChainExecution,
  spaceId: string
): ReportWorkerOutcomeSkipReason | undefined => {
  // The execution search also matches legacy documents with no `spaceId`, so compare explicitly.
  if (execution.spaceId !== spaceId) {
    return 'lineage_unavailable';
  }
  if (execution.isTestRun) {
    return 'test_run';
  }
  if (!execution.managed || execution.managedBy !== ALERTZERO_MANAGED_WORKFLOW_OWNER_ID) {
    return 'not_managed';
  }
  return undefined;
};

const walk = async (
  params: VerifyWorkerChainParams,
  executionId: string,
  visited: readonly string[]
): Promise<WorkerChainVerification> => {
  const { abortSignal, cache, spaceId } = params;
  if (abortSignal.aborted) {
    return skip('aborted');
  }

  const cachedRoot = cache.get(executionId, spaceId);
  if (cachedRoot) {
    cache.set(visited, { root: cachedRoot, spaceId });
    return { root: cachedRoot, verified: true };
  }

  const execution = await readExecution(params, executionId);
  if (!execution || execution.id !== executionId) {
    return skip('lineage_unavailable');
  }
  const hopFailure = checkHop(execution, spaceId);
  if (hopFailure) {
    return skip(hopFailure);
  }

  const chain = [...visited, executionId];
  const parentId = getParentExecutionId(execution.context);
  if (!parentId) {
    if (!isCatalogWorkerId(execution.originManagedWorkflowId)) {
      return skip('not_catalog_root');
    }
    const root = toEnvelopeRoot(execution);
    cache.set(chain, { root, spaceId });
    return { root, verified: true };
  }

  if (chain.includes(parentId) || visited.length >= MAX_LINEAGE_HOPS) {
    return skip('lineage_unavailable');
  }
  return walk(params, parentId, chain);
};

/**
 * Walks a reporting execution's persisted ancestors up to its root, requiring every hop to be a
 * non-test execution AlertZero manages in the same space, and the root to be a catalog Worker.
 * The caller check is best-effort.
 */
export const verifyWorkerChain = (
  params: VerifyWorkerChainParams
): Promise<WorkerChainVerification> => walk(params, params.executionId, []);
