/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createVerifiedChainCache } from './verified_chain_cache';
import type { VerifyWorkerChainParams } from './verify_worker_chain';
import { MAX_LINEAGE_HOPS, verifyWorkerChain } from './verify_worker_chain';
import {
  REVIEW_EXECUTION_ID,
  ROOT_EXECUTION_ID,
  RUNNER_EXECUTION_ID,
  SPACE_ID,
  createAttackDiscoveryChain,
  createExecution,
  createExecutionReader,
} from './worker_chain.mock';

const createParams = (
  overrides: Partial<VerifyWorkerChainParams> = {}
): VerifyWorkerChainParams => ({
  abortSignal: new AbortController().signal,
  cache: createVerifiedChainCache(),
  executionId: REVIEW_EXECUTION_ID,
  getExecution: createExecutionReader(createAttackDiscoveryChain()),
  hopTimeoutMs: 5000,
  spaceId: SPACE_ID,
  ...overrides,
});

const withChange = (executionId: string, change: Record<string, unknown>) => {
  const chain = createAttackDiscoveryChain();
  return createExecutionReader({ ...chain, [executionId]: { ...chain[executionId], ...change } });
};

describe('verifyWorkerChain', () => {
  it('verifies a managed chain up to its catalog root', async () => {
    const result = await verifyWorkerChain(createParams());

    expect(result).toEqual({
      root: expect.objectContaining({ id: ROOT_EXECUTION_ID }),
      verified: true,
    });
  });

  it('reads both lineage shapes on the way up', async () => {
    const getExecution = createExecutionReader(createAttackDiscoveryChain());

    await verifyWorkerChain(createParams({ getExecution }));

    expect(getExecution.mock.calls.map(([id]) => id)).toEqual([
      REVIEW_EXECUTION_ID,
      RUNNER_EXECUTION_ID,
      ROOT_EXECUTION_ID,
    ]);
  });

  it('keeps only the root fields the envelope reads', async () => {
    const result = await verifyWorkerChain(createParams());

    expect(result.verified && Object.keys(result.root).sort()).toEqual([
      'context',
      'id',
      'originManagedWorkflowId',
      'spaceId',
      'triggeredBy',
      'workflowDefinition',
    ]);
  });

  it('keeps only the consts of the root definition', async () => {
    const result = await verifyWorkerChain(createParams());

    expect(result.verified && result.root.workflowDefinition).toEqual({
      consts: { worker_settings: { autonomy: 'assisted' } },
    });
  });

  it('rejects a test-run hop', async () => {
    const result = await verifyWorkerChain(
      createParams({ getExecution: withChange(RUNNER_EXECUTION_ID, { isTestRun: true }) })
    );

    expect(result).toEqual({ reason: 'test_run', verified: false });
  });

  it('rejects an unmanaged hop', async () => {
    const result = await verifyWorkerChain(
      createParams({ getExecution: withChange(RUNNER_EXECUTION_ID, { managed: false }) })
    );

    expect(result).toEqual({ reason: 'not_managed', verified: false });
  });

  it('rejects a hop managed by another plugin', async () => {
    const result = await verifyWorkerChain(
      createParams({ getExecution: withChange(ROOT_EXECUTION_ID, { managedBy: 'proposals' }) })
    );

    expect(result).toEqual({ reason: 'not_managed', verified: false });
  });

  it('rejects a parent in another space', async () => {
    const result = await verifyWorkerChain(
      createParams({ getExecution: withChange(RUNNER_EXECUTION_ID, { spaceId: 'space-b' }) })
    );

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it('rejects a legacy hop with no space id', async () => {
    const result = await verifyWorkerChain(
      createParams({ getExecution: withChange(RUNNER_EXECUTION_ID, { spaceId: undefined }) })
    );

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it('rejects a chain whose ancestor is missing', async () => {
    const { [RUNNER_EXECUTION_ID]: _missing, ...chain } = createAttackDiscoveryChain();

    const result = await verifyWorkerChain(
      createParams({ getExecution: createExecutionReader(chain) })
    );

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it('rejects a chain whose lookup throws', async () => {
    const getExecution = jest.fn().mockRejectedValue(new Error('search_phase_execution_exception'));

    const result = await verifyWorkerChain(createParams({ getExecution }));

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it('rejects a chain whose lookup outlives the hop timeout', async () => {
    const getExecution = jest.fn(() => new Promise<never>(() => {}));

    const result = await verifyWorkerChain(createParams({ getExecution, hopTimeoutMs: 1 }));

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it('rejects a root outside the Worker catalog', async () => {
    const result = await verifyWorkerChain(
      createParams({
        getExecution: withChange(ROOT_EXECUTION_ID, { originManagedWorkflowId: 'custom-workflow' }),
      })
    );

    expect(result).toEqual({ reason: 'not_catalog_root', verified: false });
  });

  it('rejects a root with no origin managed workflow', async () => {
    const result = await verifyWorkerChain(
      createParams({
        getExecution: withChange(ROOT_EXECUTION_ID, { originManagedWorkflowId: null }),
      })
    );

    expect(result).toEqual({ reason: 'not_catalog_root', verified: false });
  });

  it('rejects a chain that loops back on itself', async () => {
    const result = await verifyWorkerChain(
      createParams({
        getExecution: withChange(ROOT_EXECUTION_ID, {
          context: { parentWorkflowExecutionId: REVIEW_EXECUTION_ID },
        }),
      })
    );

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it(`rejects a chain deeper than ${MAX_LINEAGE_HOPS} hops`, async () => {
    const executions = Object.fromEntries(
      Array.from({ length: MAX_LINEAGE_HOPS + 2 }, (_, index) => [
        `exec-${index}`,
        createExecution({
          context: { parentWorkflowExecutionId: `exec-${index + 1}` },
          id: `exec-${index}`,
        }),
      ])
    );

    const result = await verifyWorkerChain(
      createParams({ executionId: 'exec-0', getExecution: createExecutionReader(executions) })
    );

    expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
  });

  it(`reads at most ${MAX_LINEAGE_HOPS + 1} executions`, async () => {
    const executions = Object.fromEntries(
      Array.from({ length: MAX_LINEAGE_HOPS + 5 }, (_, index) => [
        `exec-${index}`,
        createExecution({
          context: { parentWorkflowExecutionId: `exec-${index + 1}` },
          id: `exec-${index}`,
        }),
      ])
    );
    const getExecution = createExecutionReader(executions);

    await verifyWorkerChain(createParams({ executionId: 'exec-0', getExecution }));

    expect(getExecution).toHaveBeenCalledTimes(MAX_LINEAGE_HOPS + 1);
  });

  it('stops before the first lookup when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const getExecution = createExecutionReader(createAttackDiscoveryChain());

    const result = await verifyWorkerChain(
      createParams({ abortSignal: controller.signal, getExecution })
    );

    expect({ calls: getExecution.mock.calls.length, result }).toEqual({
      calls: 0,
      result: { reason: 'aborted', verified: false },
    });
  });

  it('stops before the next hop when aborted mid-walk', async () => {
    const controller = new AbortController();
    const chain = createAttackDiscoveryChain();
    const getExecution = jest.fn(async (executionId: string) => {
      controller.abort();
      return chain[executionId] ?? null;
    });

    const result = await verifyWorkerChain(
      createParams({ abortSignal: controller.signal, getExecution })
    );

    expect({ calls: getExecution.mock.calls.length, result }).toEqual({
      calls: 1,
      result: { reason: 'aborted', verified: false },
    });
  });

  describe('verified chain cache', () => {
    it('answers a repeat verification without reading', async () => {
      const cache = createVerifiedChainCache();
      await verifyWorkerChain(createParams({ cache }));
      const getExecution = createExecutionReader(createAttackDiscoveryChain());

      await verifyWorkerChain(createParams({ cache, getExecution }));

      expect(getExecution).not.toHaveBeenCalled();
    });

    it('stops the walk at an ancestor another execution already verified', async () => {
      const cache = createVerifiedChainCache();
      await verifyWorkerChain(createParams({ cache }));
      const chain = createAttackDiscoveryChain();
      const getExecution = createExecutionReader({
        ...chain,
        'exec-sibling-review': createExecution({
          context: { parentWorkflowExecutionId: RUNNER_EXECUTION_ID },
          id: 'exec-sibling-review',
        }),
      });

      await verifyWorkerChain(
        createParams({ cache, executionId: 'exec-sibling-review', getExecution })
      );

      expect(getExecution.mock.calls.map(([id]) => id)).toEqual(['exec-sibling-review']);
    });

    it('does not cache a rejected chain', async () => {
      const cache = createVerifiedChainCache();
      await verifyWorkerChain(
        createParams({ cache, getExecution: withChange(ROOT_EXECUTION_ID, { managed: false }) })
      );
      const getExecution = createExecutionReader(createAttackDiscoveryChain());

      await verifyWorkerChain(createParams({ cache, getExecution }));

      expect(getExecution).toHaveBeenCalledTimes(3);
    });

    it('does not answer from a chain verified in another space', async () => {
      const cache = createVerifiedChainCache();
      await verifyWorkerChain(createParams({ cache }));

      const result = await verifyWorkerChain(
        createParams({ cache, getExecution: jest.fn().mockResolvedValue(null), spaceId: 'space-b' })
      );

      expect(result).toEqual({ reason: 'lineage_unavailable', verified: false });
    });
  });
});
