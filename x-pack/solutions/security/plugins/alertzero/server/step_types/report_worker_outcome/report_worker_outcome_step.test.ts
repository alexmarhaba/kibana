/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createAnalytics } from '@elastic/ebt/client';
import {
  SYSTEM_SECURITY_WORKER_DETECTION_RULE_COVERAGE_ID,
  SYSTEM_SECURITY_WORKER_DETECTION_RULE_TUNING_ID,
  SYSTEM_SECURITY_WORKER_FLOOR_ALERT_TRIAGE_ID,
  SYSTEM_SECURITY_WORKER_FORENSICS_ENDPOINT_ANALYSIS_ID,
  SYSTEM_SECURITY_WORKER_HUNT_CONTINUOUS_THREAT_HUNT_ID,
} from '@kbn/alertzero-common';
import { coreMock } from '@kbn/core/server/mocks';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { loggerMock } from '@kbn/logging-mocks';
import type { ManagedWorkflowStateApi } from '@kbn/workflows/server/types';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { ReportWorkerOutcomeStepId } from '../../../common/step_types';
import { ALERTZERO_TELEMETRY_EVENTS, registerAlertZeroTelemetryEvents } from '../../telemetry';
import { createManagedWorkflowCache } from './managed_workflow_cache';
import type { ReportWorkerOutcomeStepDeps } from './report_worker_outcome_step';
import {
  HOP_TIMEOUT_MS,
  STEP_DEADLINE_MS,
  getReportWorkerOutcomeStepDefinition,
} from './report_worker_outcome_step';
import { createVerifiedChainCache } from './verified_chain_cache';
import type { WorkerChainExecution } from './verify_worker_chain';
import {
  REVIEW_EXECUTION_ID,
  ROOT_EXECUTION_ID,
  RUNNER_EXECUTION_ID,
  SPACE_ID,
  createAttackDiscoveryChain,
} from './worker_chain.mock';

const FAKE_REQUEST = { fake: true } as never;
const REVIEW_WORKFLOW_ID = 'system-alertzero-attack-discovery-review';
const INVESTIGATION_ID = '0b9f4a3e-1c2d-8e3f-8a4b-5c6d7e8f9a0b';

const RUN_COMPLETED_INPUT = {
  alerts_analyzed: 120,
  attacks_generated: 4,
  attacks_persisted: 3,
  batches_failed: 0,
  batches_total: 6,
  event: 'ad_worker_run_completed',
  run_outcome: 'produced',
};

const INVESTIGATION_CLOSED_INPUT = {
  close_reason: 'false_positive',
  event: 'worker_investigation_closed',
  investigation_id: INVESTIGATION_ID,
};

const EXPECTED_ENVELOPE = {
  autonomy_level: 'assisted',
  autonomy_mode: 'gated',
  execution_id: REVIEW_EXECUTION_ID,
  is_default_space: true,
  run_id: ROOT_EXECUTION_ID,
  trigger_type: 'scheduled',
  watch_tag: 'watch-floor',
  worker_id: 'system-security-floor-attack-discovery',
};

const INSTALLED_STATE = {
  definitionId: REVIEW_WORKFLOW_ID,
  documentVersion: 1,
  spaceId: '*',
  templateValues: null,
  workflowId: REVIEW_WORKFLOW_ID,
};

interface ContextOptions {
  abortSignal?: AbortSignal;
  isTestRun?: boolean;
}

const createContext = (
  input: unknown,
  { abortSignal = new AbortController().signal, isTestRun = false }: ContextOptions = {}
) =>
  ({
    abortSignal,
    config: {},
    contextManager: {
      callKibanaApi: jest.fn(),
      getContext: jest.fn().mockReturnValue({
        execution: { id: REVIEW_EXECUTION_ID, isTestRun },
        workflow: { id: REVIEW_WORKFLOW_ID, spaceId: SPACE_ID },
      }),
      getFakeRequest: jest.fn().mockReturnValue(FAKE_REQUEST),
      getScopedEsClient: jest.fn(),
      renderInputTemplate: jest.fn((value) => value),
    },
    input,
    logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    rawInput: input,
    stepId: 'report_run_completed',
    stepType: ReportWorkerOutcomeStepId,
  } as unknown as StepHandlerContext<never, never>);

const createManagedWorkflowState = (): jest.Mocked<ManagedWorkflowStateApi> => ({
  getInstalledWorkflowState: jest.fn(async (_workflowId: string, spaceId: string) =>
    spaceId === '*' ? INSTALLED_STATE : null
  ),
  listInstalledWorkflowStates: jest.fn(),
});

const createWorkflowsManagement = (
  executions: Record<string, WorkerChainExecution> = createAttackDiscoveryChain()
) => ({
  getWorkflowExecution: jest.fn(async (executionId: string) => executions[executionId] ?? null),
});

const createDeps = (overrides: Partial<ReportWorkerOutcomeStepDeps> = {}) => {
  const analytics = coreMock.createSetup().analytics;
  const logger = loggingSystemMock.createLogger();
  const managedWorkflowState = createManagedWorkflowState();
  const workflowsManagement = createWorkflowsManagement();
  const deps: ReportWorkerOutcomeStepDeps = {
    analytics,
    areServiceAccountsEnabled: () => true,
    cache: createVerifiedChainCache(),
    getManagedWorkflowState: async () => managedWorkflowState,
    getWorkflowsManagement: () => workflowsManagement as never,
    isTelemetryOptedIn: async () => true,
    logger,
    managedWorkflowCache: createManagedWorkflowCache(),
    ...overrides,
  };
  return { analytics, deps, logger, managedWorkflowState, workflowsManagement };
};

const run = async (deps: ReportWorkerOutcomeStepDeps, context: StepHandlerContext<never, never>) =>
  getReportWorkerOutcomeStepDefinition(deps).handler(context);

/** The skip reason in the plugin logger's lazy debug or eager warn message, if any. */
const loggedMessages = (logger: ReturnType<typeof loggingSystemMock.createLogger>): string[] => [
  ...logger.debug.mock.calls.map(([message]) =>
    typeof message === 'function' ? message() : String(message)
  ),
  ...logger.warn.mock.calls.map(([message]) => String(message)),
];

describe('alertzero.reportWorkerOutcome step', () => {
  it('registers under the common step id', () => {
    const { deps } = createDeps();

    expect(getReportWorkerOutcomeStepDefinition(deps).id).toBe(ReportWorkerOutcomeStepId);
  });

  describe('a managed Worker chain', () => {
    it('reports the outcome with the envelope built from the root', async () => {
      const { analytics, deps } = createDeps();

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(analytics.reportEvent).toHaveBeenCalledWith(
        ALERTZERO_TELEMETRY_EVENTS.AdWorkerRunCompleted,
        {
          ...EXPECTED_ENVELOPE,
          alerts_analyzed: 120,
          attacks_generated: 4,
          attacks_persisted: 3,
          batches_failed: 0,
          batches_total: 6,
          run_outcome: 'produced',
        }
      );
    });

    it('returns only `reported: true`', async () => {
      const { deps } = createDeps();

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(result).toEqual({ output: { reported: true } });
    });

    it('reads every execution of the chain without step executions, as the workflow', async () => {
      const { deps, workflowsManagement } = createDeps();

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(workflowsManagement.getWorkflowExecution.mock.calls).toEqual(
        [REVIEW_EXECUTION_ID, RUNNER_EXECUTION_ID, ROOT_EXECUTION_ID].map((id) => [
          id,
          SPACE_ID,
          { omitStepExecutions: true, request: FAKE_REQUEST },
        ])
      );
    });

    it('checks the global space when the workflow is not installed in the execution space', async () => {
      const { deps, managedWorkflowState } = createDeps();

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(managedWorkflowState.getInstalledWorkflowState.mock.calls).toEqual([
        [REVIEW_WORKFLOW_ID, SPACE_ID],
        [REVIEW_WORKFLOW_ID, '*'],
      ]);
    });

    it('reports a Worker installed in the execution space without the global lookup', async () => {
      const managedWorkflowState = createManagedWorkflowState();
      managedWorkflowState.getInstalledWorkflowState.mockResolvedValue(INSTALLED_STATE);
      const { deps } = createDeps({ getManagedWorkflowState: async () => managedWorkflowState });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(managedWorkflowState.getInstalledWorkflowState).toHaveBeenCalledTimes(1);
    });

    it('omits an optional field Liquid rendered as the empty string', async () => {
      const { analytics, deps } = createDeps();

      await run(
        deps,
        createContext({
          event: 'ad_worker_review_started',
          investigation_id: '',
          is_rereview: false,
        })
      );

      expect(analytics.reportEvent.mock.calls[0][1]).not.toHaveProperty('investigation_id');
    });

    it('coerces a count Liquid rendered as the empty string to 0', async () => {
      const { analytics, deps } = createDeps();

      await run(deps, createContext({ ...RUN_COMPLETED_INPUT, batches_failed: '' }));

      expect(analytics.reportEvent.mock.calls[0][1]).toEqual(
        expect.objectContaining({ batches_failed: 0 })
      );
    });

    it.each([
      [ALERTZERO_TELEMETRY_EVENTS.AdWorkerRunCompleted, RUN_COMPLETED_INPUT],
      [
        ALERTZERO_TELEMETRY_EVENTS.AdWorkerReviewStarted,
        { event: 'ad_worker_review_started', investigation_id: INVESTIGATION_ID, is_rereview: '' },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.AdWorkerAnalysisCompleted,
        { analysis_error: '', event: 'ad_worker_analysis_completed', verdict: 'false_positive' },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.AdWorkerHandoffResolved,
        {
          auto_approve_requested: '',
          event: 'ad_worker_handoff_resolved',
          outcome: 'approved',
          verdict: 'true_positive',
        },
      ],
      [ALERTZERO_TELEMETRY_EVENTS.WorkerInvestigationClosed, INVESTIGATION_CLOSED_INPUT],
    ])('reports a %s payload the registered schema accepts', async (eventType, input) => {
      const analytics = createAnalytics({ isDev: true, logger: loggerMock.create() });
      registerAlertZeroTelemetryEvents(analytics);
      const reportEvent = jest.spyOn(analytics, 'reportEvent');
      const { deps } = createDeps({ analytics });

      const result = await run(deps, createContext(input));

      expect({ eventType: reportEvent.mock.calls[0]?.[0], result }).toEqual({
        eventType,
        result: { output: { reported: true } },
      });
    });

    it('answers a second report from the same execution from the cache', async () => {
      const { deps, workflowsManagement } = createDeps();
      await run(deps, createContext(RUN_COMPLETED_INPUT));
      workflowsManagement.getWorkflowExecution.mockClear();

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(workflowsManagement.getWorkflowExecution).not.toHaveBeenCalled();
    });

    it('answers the managed check of a second report from the same workflow from the cache', async () => {
      const { analytics, deps, managedWorkflowState } = createDeps();
      await run(deps, createContext(RUN_COMPLETED_INPUT));
      managedWorkflowState.getInstalledWorkflowState.mockClear();

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        getInstalledWorkflowState: 0,
        reportEvent: 2,
        result: { output: { reported: true } },
      });
    });

    it('never writes to the workflow event log', async () => {
      const { deps } = createDeps();
      const context = createContext(RUN_COMPLETED_INPUT);

      await run(deps, context);

      expect(Object.values(context.logger).flatMap((fn) => (fn as jest.Mock).mock.calls)).toEqual(
        []
      );
    });
  });

  describe('an Investigation close', () => {
    it('reports once, with the envelope built from the root', async () => {
      const { analytics, deps } = createDeps();

      const result = await run(deps, createContext(INVESTIGATION_CLOSED_INPUT));

      expect({ calls: analytics.reportEvent.mock.calls, result }).toEqual({
        calls: [
          [
            ALERTZERO_TELEMETRY_EVENTS.WorkerInvestigationClosed,
            {
              ...EXPECTED_ENVELOPE,
              close_reason: 'false_positive',
              investigation_id: INVESTIGATION_ID,
            },
          ],
        ],
        result: { output: { reported: true } },
      });
    });

    it('reports the close of any catalogued Worker, with that Worker in the envelope', async () => {
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement({
        ...chain,
        [ROOT_EXECUTION_ID]: {
          ...chain[ROOT_EXECUTION_ID],
          originManagedWorkflowId: SYSTEM_SECURITY_WORKER_DETECTION_RULE_TUNING_ID,
        },
      });
      const { analytics, deps } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      await run(deps, createContext({ ...INVESTIGATION_CLOSED_INPUT, close_reason: 'resolved' }));

      expect(analytics.reportEvent.mock.calls).toEqual([
        [
          ALERTZERO_TELEMETRY_EVENTS.WorkerInvestigationClosed,
          {
            ...EXPECTED_ENVELOPE,
            close_reason: 'resolved',
            investigation_id: INVESTIGATION_ID,
            watch_tag: 'watch-detection',
            worker_id: SYSTEM_SECURITY_WORKER_DETECTION_RULE_TUNING_ID,
          },
        ],
      ]);
    });

    it('reports nothing for a test run', async () => {
      const { analytics, deps, logger } = createDeps();

      const result = await run(
        deps,
        createContext(INVESTIGATION_CLOSED_INPUT, { isTestRun: true })
      );

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(test_run)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('reports nothing for a chain with a persisted test-run hop', async () => {
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement({
        ...chain,
        [ROOT_EXECUTION_ID]: { ...chain[ROOT_EXECUTION_ID], isTestRun: true },
      });
      const { analytics, deps } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const result = await run(deps, createContext(INVESTIGATION_CLOSED_INPUT));

      expect({ reportEvent: analytics.reportEvent.mock.calls.length, result }).toEqual({
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('reports nothing, at warn level, when the close reason is not in the template vocabulary', async () => {
      const { analytics, deps, logger } = createDeps();

      await run(deps, createContext({ ...INVESTIGATION_CLOSED_INPUT, close_reason: 'declined' }));

      expect({
        reportEvent: analytics.reportEvent.mock.calls.length,
        warn: logger.warn.mock.calls.map(([message]) => message),
      }).toEqual({ reportEvent: 0, warn: [expect.stringContaining('(invalid_input)')] });
    });
  });

  describe('a Worker run event or item event', () => {
    /** The Attack Discovery chain, re-rooted at another catalogued Worker. */
    const createWorkflowsManagementRootedAt = (workerId: string) => {
      const chain = createAttackDiscoveryChain();
      return createWorkflowsManagement({
        ...chain,
        [ROOT_EXECUTION_ID]: { ...chain[ROOT_EXECUTION_ID], originManagedWorkflowId: workerId },
      });
    };

    const ITEM_EVENTS: Array<[string, string, Record<string, unknown>]> = [
      [
        ALERTZERO_TELEMETRY_EVENTS.AlertTriageBatchClassified,
        SYSTEM_SECURITY_WORKER_FLOOR_ALERT_TRIAGE_ID,
        {
          alerts_total: '40',
          alerts_without_verdict: '',
          event: 'alert_triage_batch_classified',
          fp_below_floor: 3,
          fp_candidates: 20,
          investigation_id: INVESTIGATION_ID,
          verdicts_false_positive: 23,
          verdicts_inconclusive: 5,
          verdicts_true_positive: 10,
        },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.AlertTriageClosureResolved,
        SYSTEM_SECURITY_WORKER_FLOOR_ALERT_TRIAGE_ID,
        {
          alerts_proposed: 20,
          auto_approve_requested: 'false',
          event: 'alert_triage_closure_resolved',
          investigation_id: INVESTIGATION_ID,
          outcome: 'approved',
        },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.RuleTuningReviewCompleted,
        SYSTEM_SECURITY_WORKER_DETECTION_RULE_TUNING_ID,
        {
          applied: true,
          backtest_ran: true,
          backtest_reduced_alerts: true,
          change_type: 'query',
          confidence: 'high',
          decision: 'approved',
          entry_gate: 'skipped',
          event: 'rule_tuning_review_completed',
          investigation_id: INVESTIGATION_ID,
          rule_unavailable: false,
        },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.RuleCoverageReviewCompleted,
        SYSTEM_SECURITY_WORKER_DETECTION_RULE_COVERAGE_ID,
        {
          decision: 'dismissed',
          event: 'rule_coverage_review_completed',
          investigation_id: '',
          proposal_kind: 'install_prebuilt_rule',
          verdict: 'prebuilt_available',
        },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.HuntReportCompleted,
        SYSTEM_SECURITY_WORKER_HUNT_CONTINUOUS_THREAT_HUNT_ID,
        {
          event: 'hunt_report_completed',
          has_confirmed_hit: true,
          hunt_status: 'partial',
          package_status: 'run_incomplete',
          proposals_prepared: 2,
          tier2_invoked: '',
        },
      ],
      [
        ALERTZERO_TELEMETRY_EVENTS.EndpointAnalysisCompleted,
        SYSTEM_SECURITY_WORKER_FORENSICS_ENDPOINT_ANALYSIS_ID,
        {
          actions_recommended: 1,
          analysis_outcome: 'proposals_lost',
          event: 'endpoint_analysis_completed',
          findings_attached: true,
          host_resolved: true,
          proposals_dispatch_failed: 1,
        },
      ],
    ];

    it.each(ITEM_EVENTS)(
      'reports a %s payload from its own Worker that the registered schema accepts',
      async (eventType, workerId, input) => {
        const analytics = createAnalytics({ isDev: true, logger: loggerMock.create() });
        registerAlertZeroTelemetryEvents(analytics);
        const reportEvent = jest.spyOn(analytics, 'reportEvent');
        const workflowsManagement = createWorkflowsManagementRootedAt(workerId);
        const { deps } = createDeps({
          analytics,
          getWorkflowsManagement: () => workflowsManagement as never,
        });

        const result = await run(deps, createContext(input));

        expect({
          eventType: reportEvent.mock.calls[0]?.[0],
          result,
          workerId: (reportEvent.mock.calls[0]?.[1] as { worker_id?: string } | undefined)
            ?.worker_id,
        }).toEqual({ eventType, result: { output: { reported: true } }, workerId });
      }
    );

    it.each(ITEM_EVENTS)(
      'reports nothing, at warn level, for a %s payload from the Attack Discovery Worker',
      async (_eventType, _workerId, input) => {
        const { analytics, deps, logger } = createDeps();

        const result = await run(deps, createContext(input));

        expect({
          reportEvent: analytics.reportEvent.mock.calls.length,
          result,
          warn: logger.warn.mock.calls.map(([message]) => message),
        }).toEqual({
          reportEvent: 0,
          result: { output: { reported: false } },
          warn: [expect.stringContaining('(wrong_worker)')],
        });
      }
    );

    it('reports nothing for an Attack Discovery event from another Worker', async () => {
      const workflowsManagement = createWorkflowsManagementRootedAt(
        SYSTEM_SECURITY_WORKER_HUNT_CONTINUOUS_THREAT_HUNT_ID
      );
      const { analytics, deps, logger } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        reportEvent: analytics.reportEvent.mock.calls.length,
        warn: logger.warn.mock.calls.map(([message]) => message),
      }).toEqual({ reportEvent: 0, warn: [expect.stringContaining('(wrong_worker)')] });
    });

    it.each([
      [SYSTEM_SECURITY_WORKER_FLOOR_ALERT_TRIAGE_ID],
      [SYSTEM_SECURITY_WORKER_FORENSICS_ENDPOINT_ANALYSIS_ID],
    ])(
      'reports the generic run event from %s with that Worker in the envelope',
      async (workerId) => {
        const analytics = createAnalytics({ isDev: true, logger: loggerMock.create() });
        registerAlertZeroTelemetryEvents(analytics);
        const reportEvent = jest.spyOn(analytics, 'reportEvent');
        const workflowsManagement = createWorkflowsManagementRootedAt(workerId);
        const { deps } = createDeps({
          analytics,
          getWorkflowsManagement: () => workflowsManagement as never,
        });

        await run(
          deps,
          createContext({
            candidates_found: '2',
            degraded_reason: '',
            event: 'worker_run_completed',
            items_dispatched: 2,
            run_outcome: 'produced',
          })
        );

        expect(reportEvent.mock.calls).toEqual([
          [
            ALERTZERO_TELEMETRY_EVENTS.WorkerRunCompleted,
            expect.objectContaining({
              candidates_found: 2,
              degraded: false,
              degraded_reason: 'none',
              items_dispatched: 2,
              run_outcome: 'produced',
              worker_id: workerId,
            }),
          ],
        ]);
      }
    );
  });

  describe('skips', () => {
    it('a test run, before any lookup', async () => {
      const { analytics, deps, logger, managedWorkflowState } = createDeps();

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT, { isTestRun: true }));

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        getInstalledWorkflowState: 0,
        logged: [expect.stringContaining('(test_run)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('an opted-out cluster, before any Elasticsearch read', async () => {
      const { analytics, deps, logger, managedWorkflowState, workflowsManagement } = createDeps({
        isTelemetryOptedIn: async () => false,
      });

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        getWorkflowExecution: workflowsManagement.getWorkflowExecution.mock.calls.length,
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        getInstalledWorkflowState: 0,
        getWorkflowExecution: 0,
        logged: [expect.stringContaining('(opted_out)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('a run aborted during the opt-in read, before any Elasticsearch read', async () => {
      const controller = new AbortController();
      const { analytics, deps, logger, managedWorkflowState } = createDeps({
        isTelemetryOptedIn: async () => {
          controller.abort();
          return true;
        },
      });

      const result = await run(
        deps,
        createContext(RUN_COMPLETED_INPUT, { abortSignal: controller.signal })
      );

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        getInstalledWorkflowState: 0,
        logged: [expect.stringContaining('(aborted)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('a test run without reading the opt-in', async () => {
      const isTelemetryOptedIn = jest.fn(async () => true);
      const { deps } = createDeps({ isTelemetryOptedIn });

      await run(deps, createContext(RUN_COMPLETED_INPUT, { isTestRun: true }));

      expect(isTelemetryOptedIn).not.toHaveBeenCalled();
    });

    it('cleanly when the opt-in read throws', async () => {
      const { analytics, deps } = createDeps({
        isTelemetryOptedIn: async () => {
          throw new Error('telemetry unavailable');
        },
      });

      await expect(run(deps, createContext(RUN_COMPLETED_INPUT))).resolves.toEqual({
        output: { reported: false },
      });
      expect(analytics.reportEvent).not.toHaveBeenCalled();
    });

    it('a chain with a persisted test-run hop', async () => {
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement({
        ...chain,
        [RUNNER_EXECUTION_ID]: { ...chain[RUNNER_EXECUTION_ID], isTestRun: true },
      });
      const { analytics, deps, logger } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
      }).toEqual({ logged: [expect.stringContaining('(test_run)')], reportEvent: 0 });
    });

    it('a workflow AlertZero does not manage', async () => {
      const managedWorkflowState = createManagedWorkflowState();
      managedWorkflowState.getInstalledWorkflowState.mockResolvedValue(null);
      const { analytics, deps, logger, workflowsManagement } = createDeps({
        getManagedWorkflowState: async () => managedWorkflowState,
      });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        getWorkflowExecution: workflowsManagement.getWorkflowExecution.mock.calls.length,
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
      }).toEqual({
        getWorkflowExecution: 0,
        logged: [expect.stringContaining('(not_managed)')],
        reportEvent: 0,
      });
    });

    it('a chain with an unmanaged hop', async () => {
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement({
        ...chain,
        [RUNNER_EXECUTION_ID]: { ...chain[RUNNER_EXECUTION_ID], managed: false, managedBy: null },
      });
      const { analytics, deps, logger } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(not_managed)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('a chain with a parent in another space', async () => {
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement({
        ...chain,
        [RUNNER_EXECUTION_ID]: { ...chain[RUNNER_EXECUTION_ID], spaceId: 'space-b' },
      });
      const { analytics, deps } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({ reportEvent: analytics.reportEvent.mock.calls.length, result }).toEqual({
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('a chain whose root is not a catalog Worker', async () => {
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement({
        ...chain,
        [ROOT_EXECUTION_ID]: { ...chain[ROOT_EXECUTION_ID], originManagedWorkflowId: 'custom' },
      });
      const { analytics, deps, logger } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(not_catalog_root)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('a chain with a missing ancestor, as lineage_unavailable at debug level', async () => {
      const { [RUNNER_EXECUTION_ID]: _missing, ...chain } = createAttackDiscoveryChain();
      const workflowsManagement = createWorkflowsManagement(chain);
      const { analytics, deps, logger } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        debug: logger.debug.mock.calls.map(([message]) => (message as () => string)()),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
        warn: logger.warn.mock.calls.length,
      }).toEqual({
        debug: [expect.stringContaining('(lineage_unavailable)')],
        reportEvent: 0,
        result: { output: { reported: false } },
        warn: 0,
      });
    });

    it('when the managed workflows client is unavailable', async () => {
      const { analytics, deps, logger } = createDeps({
        getManagedWorkflowState: async () => undefined,
      });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
      }).toEqual({ logged: [expect.stringContaining('(lineage_unavailable)')], reportEvent: 0 });
    });

    it('when the managed state lookup throws', async () => {
      const managedWorkflowState = createManagedWorkflowState();
      managedWorkflowState.getInstalledWorkflowState.mockRejectedValue(
        new Error('Workflows is not available in this environment')
      );
      const { analytics, deps, logger } = createDeps({
        getManagedWorkflowState: async () => managedWorkflowState,
      });

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(lineage_unavailable)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('with service accounts off, at debug level, as service_accounts_disabled', async () => {
      const { analytics, deps, logger } = createDeps({
        areServiceAccountsEnabled: () => false,
        getManagedWorkflowState: async () => undefined,
      });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        debug: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        warn: logger.warn.mock.calls.length,
      }).toEqual({
        debug: [expect.stringContaining('(service_accounts_disabled)')],
        reportEvent: 0,
        warn: 0,
      });
    });

    it('when the Workflows management API is unavailable', async () => {
      const { analytics, deps, logger } = createDeps({ getWorkflowsManagement: () => undefined });

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
      }).toEqual({ logged: [expect.stringContaining('(lineage_unavailable)')], reportEvent: 0 });
    });

    it('an invalid input at warn level, before any lookup', async () => {
      const { analytics, deps, logger, managedWorkflowState } = createDeps();

      const result = await run(
        deps,
        createContext({ ...RUN_COMPLETED_INPUT, run_outcome: 'skipped_space_disabled' })
      );

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
        warn: logger.warn.mock.calls.map(([message]) => message),
      }).toEqual({
        getInstalledWorkflowState: 0,
        reportEvent: 0,
        result: { output: { reported: false } },
        warn: [expect.stringContaining('(invalid_input)')],
      });
    });

    it('a run event whose degraded fields contradict its outcome, at warn level, before any lookup', async () => {
      const { analytics, deps, logger, managedWorkflowState } = createDeps();

      const result = await run(
        deps,
        createContext({
          degraded: false,
          event: 'worker_run_completed',
          run_outcome: 'degraded_partial',
        })
      );

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
        warn: logger.warn.mock.calls.map(([message]) => message),
      }).toEqual({
        getInstalledWorkflowState: 0,
        reportEvent: 0,
        result: { output: { reported: false } },
        warn: [expect.stringContaining('(invalid_input)')],
      });
    });

    it('an invalid input without echoing the rendered values', async () => {
      const { deps, logger } = createDeps();

      await run(
        deps,
        createContext({ ...RUN_COMPLETED_INPUT, run_outcome: 'Lateral movement on fin-dc-01' })
      );

      expect(String(logger.warn.mock.calls[0][0])).not.toContain('fin-dc-01');
    });

    it('an already aborted run, before any lookup', async () => {
      const controller = new AbortController();
      controller.abort();
      const { analytics, deps, logger, managedWorkflowState } = createDeps();

      const result = await run(
        deps,
        createContext(RUN_COMPLETED_INPUT, { abortSignal: controller.signal })
      );

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        getInstalledWorkflowState: 0,
        logged: [expect.stringContaining('(aborted)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('a run aborted after the walk, immediately before reporting', async () => {
      const controller = new AbortController();
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = {
        getWorkflowExecution: jest.fn(async (executionId: string) => {
          if (executionId === ROOT_EXECUTION_ID) {
            controller.abort();
          }
          return chain[executionId] ?? null;
        }),
      };
      const { analytics, deps, logger } = createDeps({
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const result = await run(
        deps,
        createContext(RUN_COMPLETED_INPUT, { abortSignal: controller.signal })
      );

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(aborted)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });
  });

  describe('the deadline', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const after = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    it('stays well under the 30s timeout every report step sets', () => {
      expect(STEP_DEADLINE_MS).toBeLessThanOrEqual(20_000);
    });

    it('returns `reported: false` as deadline_exceeded when the checks outlast it', async () => {
      const { analytics, deps, logger } = createDeps({
        isTelemetryOptedIn: async () => {
          await after(STEP_DEADLINE_MS + 5000);
          return true;
        },
      });

      const pending = run(deps, createContext(RUN_COMPLETED_INPUT));
      await jest.advanceTimersByTimeAsync(STEP_DEADLINE_MS);
      const result = await pending;

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(deadline_exceeded)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('stops the checks still in flight, so they read nothing more and never report', async () => {
      const { analytics, deps, managedWorkflowState, workflowsManagement } = createDeps({
        isTelemetryOptedIn: async () => {
          await after(STEP_DEADLINE_MS + 5000);
          return true;
        },
      });

      const pending = run(deps, createContext(RUN_COMPLETED_INPUT));
      await jest.advanceTimersByTimeAsync(STEP_DEADLINE_MS + 10_000);
      await pending;

      expect({
        getInstalledWorkflowState: managedWorkflowState.getInstalledWorkflowState.mock.calls.length,
        getWorkflowExecution: workflowsManagement.getWorkflowExecution.mock.calls.length,
        reportEvent: analytics.reportEvent.mock.calls.length,
      }).toEqual({ getInstalledWorkflowState: 0, getWorkflowExecution: 0, reportEvent: 0 });
    });

    it('gives up on a chain whose reads each stay within their own timeout but add up past it', async () => {
      const slowRead = <T>(value: T) => after(HOP_TIMEOUT_MS - 100).then(() => value);
      const managedWorkflowState = createManagedWorkflowState();
      managedWorkflowState.getInstalledWorkflowState.mockImplementation(
        (_workflowId: string, spaceId: string) => slowRead(spaceId === '*' ? INSTALLED_STATE : null)
      );
      const chain = createAttackDiscoveryChain();
      const workflowsManagement = {
        getWorkflowExecution: jest.fn((executionId: string) =>
          slowRead(chain[executionId] ?? null)
        ),
      };
      const { analytics, deps, logger } = createDeps({
        getManagedWorkflowState: async () => managedWorkflowState,
        getWorkflowsManagement: () => workflowsManagement as never,
      });

      const pending = run(deps, createContext(RUN_COMPLETED_INPUT));
      await jest.advanceTimersByTimeAsync(STEP_DEADLINE_MS);
      const result = await pending;
      await jest.advanceTimersByTimeAsync(HOP_TIMEOUT_MS * 3);

      expect({
        logged: loggedMessages(logger),
        reportEvent: analytics.reportEvent.mock.calls.length,
        result,
      }).toEqual({
        logged: [expect.stringContaining('(deadline_exceeded)')],
        reportEvent: 0,
        result: { output: { reported: false } },
      });
    });

    it('reports a run whose checks finish just inside it', async () => {
      const { analytics, deps } = createDeps({
        isTelemetryOptedIn: async () => {
          await after(STEP_DEADLINE_MS - 1000);
          return true;
        },
      });

      const pending = run(deps, createContext(RUN_COMPLETED_INPUT));
      await jest.advanceTimersByTimeAsync(STEP_DEADLINE_MS - 1000);
      const result = await pending;

      expect({ reportEvent: analytics.reportEvent.mock.calls.length, result }).toEqual({
        reportEvent: 1,
        result: { output: { reported: true } },
      });
    });
  });

  describe('a failing analytics client', () => {
    const createThrowingDeps = () => {
      const created = createDeps();
      created.analytics.reportEvent.mockImplementation(() => {
        throw new Error('Attempted to report event type before registering it');
      });
      return created;
    };

    it('still returns cleanly with `reported: false`', async () => {
      const { deps } = createThrowingDeps();

      const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(result).toEqual({ output: { reported: false } });
    });

    it('logs report_error at warn level', async () => {
      const { deps, logger } = createThrowingDeps();

      await run(deps, createContext(RUN_COMPLETED_INPUT));

      expect(logger.warn.mock.calls.map(([message]) => message)).toEqual([
        expect.stringContaining('(report_error)'),
      ]);
    });
  });

  it('never throws, even when a dependency getter throws', async () => {
    const { deps, logger } = createDeps({
      getWorkflowsManagement: () => {
        throw new Error('unexpected');
      },
    });

    const result = await run(deps, createContext(RUN_COMPLETED_INPUT));

    expect({ logged: loggedMessages(logger), result }).toEqual({
      logged: [expect.stringContaining('(report_error)')],
      result: { output: { reported: false } },
    });
  });
});
