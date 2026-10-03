/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StepCategory } from '@kbn/workflows';
import { z } from '@kbn/zod/v4';
import {
  AD_WORKER_ANALYSIS_VERDICTS,
  AD_WORKER_HANDOFF_OUTCOMES,
  AD_WORKER_RUN_OUTCOMES,
  ALERT_TRIAGE_CLOSURE_OUTCOMES,
  ENDPOINT_ANALYSIS_OUTCOMES,
  HUNT_REPORT_HUNT_STATUSES,
  HUNT_REPORT_MINT_SUPPRESSIONS,
  HUNT_REPORT_PACKAGE_STATUSES,
  INVESTIGATION_CLOSE_REASONS,
  RULE_COVERAGE_PROPOSAL_KINDS,
  RULE_COVERAGE_VERDICTS,
  RULE_TUNING_CHANGE_TYPES,
  RULE_TUNING_ENTRY_GATES,
  WORKER_DEGRADED_REASONS,
  WORKER_RECOMMENDATION_CONFIDENCES,
  WORKER_REVIEW_DECISIONS,
  WORKER_RUN_OUTCOMES,
} from '../telemetry/constants';
import {
  MAX_REPORTED_COUNT,
  REPORT_WORKER_OUTCOME_EVENTS,
  ReportWorkerOutcomeStepId,
  reportWorkerOutcomeStepCommonDefinition,
  reportWorkerOutcomeStepInputSchema,
  reportWorkerOutcomeStepOutputSchema,
} from './report_worker_outcome_step';

const INVESTIGATION_ID = '0b9f4a3e-1c2d-8e3f-8a4b-5c6d7e8f9a0b';

const parse = (input: unknown) => reportWorkerOutcomeStepInputSchema.safeParse(input);

/** The parsed `ad_worker_review_started` branch, or undefined when the input did not parse to it. */
const parseReviewStarted = (input: Record<string, unknown>) => {
  const result = parse({ event: 'ad_worker_review_started', ...input });
  return result.success && result.data.event === 'ad_worker_review_started'
    ? result.data
    : undefined;
};

describe('alertzero.reportWorkerOutcome common definition', () => {
  it('uses the alertzero step id', () => {
    expect(reportWorkerOutcomeStepCommonDefinition.id).toBe('alertzero.reportWorkerOutcome');
  });

  it('exports the step id constant', () => {
    expect(ReportWorkerOutcomeStepId).toBe(reportWorkerOutcomeStepCommonDefinition.id);
  });

  it('is a beta Kibana step', () => {
    expect({
      category: reportWorkerOutcomeStepCommonDefinition.category,
      stability: reportWorkerOutcomeStepCommonDefinition.stability,
    }).toEqual({ category: StepCategory.Kibana, stability: 'beta' });
  });

  it('documents at least one example', () => {
    expect(reportWorkerOutcomeStepCommonDefinition.documentation?.examples?.length).toBeGreaterThan(
      0
    );
  });

  it('covers the Attack Discovery events, the two Worker-generic events and each Worker item event', () => {
    expect(REPORT_WORKER_OUTCOME_EVENTS).toEqual([
      'ad_worker_run_completed',
      'ad_worker_review_started',
      'ad_worker_analysis_completed',
      'ad_worker_handoff_resolved',
      'worker_investigation_closed',
      'worker_run_completed',
      'alert_triage_batch_classified',
      'alert_triage_closure_resolved',
      'rule_tuning_review_completed',
      'rule_coverage_review_completed',
      'hunt_report_completed',
      'endpoint_analysis_completed',
    ]);
  });

  it('outputs only `reported`', () => {
    expect(Object.keys(reportWorkerOutcomeStepOutputSchema.shape)).toEqual(['reported']);
  });
});

describe('alertzero.reportWorkerOutcome input schema', () => {
  describe('ad_worker_run_completed', () => {
    const valid = {
      alerts_analyzed: 120,
      attacks_generated: 4,
      attacks_persisted: 3,
      batches_failed: 1,
      batches_total: 6,
      event: 'ad_worker_run_completed',
      run_outcome: 'produced',
    };

    it('accepts every run outcome', () => {
      const results = AD_WORKER_RUN_OUTCOMES.map(
        (runOutcome) => parse({ ...valid, run_outcome: runOutcome }).success
      );

      expect(results.every(Boolean)).toBe(true);
    });

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('defaults a count Liquid rendered as the empty string to 0', () => {
      const result = parse({ ...valid, batches_failed: '' });

      expect(result.success && result.data).toEqual(expect.objectContaining({ batches_failed: 0 }));
    });

    it('defaults an omitted count to 0', () => {
      const { alerts_analyzed: _omitted, ...withoutAlerts } = valid;

      const result = parse(withoutAlerts);

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ alerts_analyzed: 0 })
      );
    });

    it('coerces a count Liquid rendered as an integer string', () => {
      const result = parse({ ...valid, attacks_generated: '4' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ attacks_generated: 4 })
      );
    });

    it.each([
      ['a negative count', -1],
      ['a fractional count', 1.5],
      ['a count above the bound', MAX_REPORTED_COUNT + 1],
      ['a non-numeric string', 'many'],
    ])('rejects %s', (_label, value) => {
      expect(parse({ ...valid, alerts_analyzed: value }).success).toBe(false);
    });

    it('rejects an unknown run outcome', () => {
      expect(parse({ ...valid, run_outcome: 'skipped_space_disabled' }).success).toBe(false);
    });

    it('rejects a missing run outcome', () => {
      expect(parse({ ...valid, run_outcome: '' }).success).toBe(false);
    });
  });

  describe('ad_worker_review_started', () => {
    it('accepts an investigation id and a re-review flag', () => {
      const input = {
        event: 'ad_worker_review_started',
        investigation_id: INVESTIGATION_ID,
        is_rereview: true,
      };

      expect(parse(input)).toEqual({ data: input, success: true });
    });

    it('treats an empty investigation id as absent', () => {
      const result = parseReviewStarted({ investigation_id: '' });

      expect(result).toEqual({ event: 'ad_worker_review_started', investigation_id: undefined });
    });

    it('rejects an investigation id that is not a UUID', () => {
      expect(
        parse({ event: 'ad_worker_review_started', investigation_id: 'Suspicious login' }).success
      ).toBe(false);
    });

    it('coerces a re-review flag Liquid rendered as text', () => {
      const result = parseReviewStarted({ is_rereview: 'false' });

      expect(result?.is_rereview).toBe(false);
    });

    it('treats an empty re-review flag as absent', () => {
      const result = parseReviewStarted({ is_rereview: '' });

      expect(result).toEqual({ event: 'ad_worker_review_started', is_rereview: undefined });
    });
  });

  describe('ad_worker_analysis_completed', () => {
    it('accepts every verdict', () => {
      const results = AD_WORKER_ANALYSIS_VERDICTS.map(
        (verdict) => parse({ event: 'ad_worker_analysis_completed', verdict }).success
      );

      expect(results.every(Boolean)).toBe(true);
    });

    it('defaults an empty analysis_error to false', () => {
      const result = parse({
        analysis_error: '',
        event: 'ad_worker_analysis_completed',
        verdict: 'false_positive',
      });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ analysis_error: false })
      );
    });

    it('coerces analysis_error Liquid rendered as text', () => {
      const result = parse({
        analysis_error: 'true',
        event: 'ad_worker_analysis_completed',
        verdict: 'failed',
      });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ analysis_error: true })
      );
    });

    it('rejects an unknown verdict', () => {
      expect(parse({ event: 'ad_worker_analysis_completed', verdict: 'maybe' }).success).toBe(
        false
      );
    });
  });

  describe('ad_worker_handoff_resolved', () => {
    it('accepts every handoff outcome', () => {
      const results = AD_WORKER_HANDOFF_OUTCOMES.map(
        (outcome) => parse({ event: 'ad_worker_handoff_resolved', outcome }).success
      );

      expect(results.every(Boolean)).toBe(true);
    });

    it('treats an empty verdict as absent', () => {
      const result = parse({
        event: 'ad_worker_handoff_resolved',
        outcome: 'approved',
        verdict: '',
      });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ verdict: undefined })
      );
    });

    it('accepts auto_approve_requested', () => {
      const result = parse({
        auto_approve_requested: true,
        event: 'ad_worker_handoff_resolved',
        outcome: 'approved',
        verdict: 'true_positive',
      });

      expect(result.success).toBe(true);
    });

    it('rejects an unknown outcome', () => {
      expect(parse({ event: 'ad_worker_handoff_resolved', outcome: 'escalated' }).success).toBe(
        false
      );
    });
  });

  describe('worker_investigation_closed', () => {
    const valid = {
      close_reason: 'false_positive',
      event: 'worker_investigation_closed',
      investigation_id: INVESTIGATION_ID,
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every Investigation template close reason', () => {
      const results = INVESTIGATION_CLOSE_REASONS.map(
        (closeReason) => parse({ ...valid, close_reason: closeReason }).success
      );

      expect(results.every(Boolean)).toBe(true);
    });

    it('rejects a close reason outside the template vocabulary', () => {
      expect(parse({ ...valid, close_reason: 'declined' }).success).toBe(false);
    });

    it('accepts a UUID v5 Investigation id, as the Hunt Worker mints', () => {
      expect(
        parse({ ...valid, investigation_id: '3f1c2b4a-5d6e-5f70-8a9b-0c1d2e3f4a5b' }).success
      ).toBe(true);
    });

    it('rejects the Attack Discovery-only event name it replaced', () => {
      expect(parse({ ...valid, event: 'ad_worker_investigation_closed' }).success).toBe(false);
    });

    it('does not accept a worker id, which comes from the run instead', () => {
      expect(
        parse({ ...valid, worker_id: 'system-security-hunt-continuous-threat-hunt' }).success
      ).toBe(false);
    });

    it.each([
      ['a missing close reason', { close_reason: undefined }],
      ['an empty close reason', { close_reason: '' }],
      ['a missing investigation id', { investigation_id: undefined }],
      ['an empty investigation id', { investigation_id: '' }],
      ['an investigation id that is not a UUID', { investigation_id: 'Suspicious login' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });

    it.each([
      ['the verdict prose the close writes', { verdict: 'Closed without escalation.' }],
      ['a status', { status: 'closed' }],
      ['an analyst name', { decided_by: 'jdoe' }],
    ])('rejects %s', (_label, extra) => {
      expect(parse({ ...valid, ...extra }).success).toBe(false);
    });
  });

  describe('worker_run_completed', () => {
    const valid = {
      candidates_found: 12,
      degraded: true,
      degraded_reason: 'dependency_unavailable',
      event: 'worker_run_completed',
      items_dispatched: 5,
      items_failed: 1,
      items_in_flight: 3,
      lookup_failed: true,
      run_outcome: 'degraded_partial',
      source_read_failed: false,
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every run outcome and degraded reason', () => {
      expect({
        outcomes: WORKER_RUN_OUTCOMES.every(
          (runOutcome) => parse({ ...valid, run_outcome: runOutcome }).success
        ),
        reasons: WORKER_DEGRADED_REASONS.every(
          (degradedReason) => parse({ ...valid, degraded_reason: degradedReason }).success
        ),
      }).toEqual({ outcomes: true, reasons: true });
    });

    it('defaults every count and flag, and the degraded reason to none, when only the outcome is given', () => {
      expect(
        parse({ event: 'worker_run_completed', run_outcome: 'empty_nothing_pending' })
      ).toEqual({
        data: {
          candidates_found: 0,
          degraded: false,
          degraded_reason: 'none',
          event: 'worker_run_completed',
          items_dispatched: 0,
          items_failed: 0,
          items_in_flight: 0,
          lookup_failed: false,
          run_outcome: 'empty_nothing_pending',
          source_read_failed: false,
        },
        success: true,
      });
    });

    it('treats a degraded reason Liquid rendered as the empty string as none', () => {
      const result = parse({ ...valid, degraded_reason: '' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ degraded_reason: 'none' })
      );
    });

    it('coerces counts and flags Liquid rendered as text', () => {
      const result = parse({ ...valid, items_dispatched: '7', source_read_failed: 'true' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ items_dispatched: 7, source_read_failed: true })
      );
    });

    it.each([
      ['an unknown run outcome', { run_outcome: 'skipped' }],
      ['a missing run outcome', { run_outcome: '' }],
      ['an unknown degraded reason', { degraded_reason: 'model timeout on host-01' }],
      ['a count above the bound', { candidates_found: MAX_REPORTED_COUNT + 1 }],
      ['a worker id', { worker_id: 'system-security-floor-alert-triage' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  describe('alert_triage_batch_classified', () => {
    const valid = {
      alerts_total: 40,
      alerts_without_verdict: 2,
      event: 'alert_triage_batch_classified',
      fp_below_floor: 3,
      fp_candidates: 20,
      investigation_id: INVESTIGATION_ID,
      verdicts_false_positive: 23,
      verdicts_inconclusive: 5,
      verdicts_true_positive: 10,
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('treats an empty investigation id as absent', () => {
      const result = parse({ ...valid, investigation_id: '' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ investigation_id: undefined })
      );
    });

    it.each([
      ['a negative count', { fp_candidates: -1 }],
      ['an investigation id that is not a UUID', { investigation_id: 'Alert Triage - rule' }],
      ['a rule name', { rule_name: 'Suspicious PowerShell' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  describe('alert_triage_closure_resolved', () => {
    const valid = {
      alerts_proposed: 20,
      alerts_retag_failed: 0,
      auto_approve_requested: false,
      event: 'alert_triage_closure_resolved',
      investigation_id: INVESTIGATION_ID,
      outcome: 'dismissed',
      proposal_read_failed: false,
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every closure outcome', () => {
      expect(
        ALERT_TRIAGE_CLOSURE_OUTCOMES.every((outcome) => parse({ ...valid, outcome }).success)
      ).toBe(true);
    });

    it.each([
      ['an unknown outcome', { outcome: 'failed' }],
      ['a dismiss reason', { dismiss_reason: 'risk_accepted' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  describe('rule_tuning_review_completed', () => {
    const valid = {
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
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every change type, confidence, decision and entry gate', () => {
      expect({
        changeTypes: RULE_TUNING_CHANGE_TYPES.every(
          (changeType) => parse({ ...valid, change_type: changeType }).success
        ),
        confidences: WORKER_RECOMMENDATION_CONFIDENCES.every(
          (confidence) => parse({ ...valid, confidence }).success
        ),
        decisions: WORKER_REVIEW_DECISIONS.every(
          (decision) => parse({ ...valid, decision }).success
        ),
        entryGates: RULE_TUNING_ENTRY_GATES.every(
          (entryGate) => parse({ ...valid, entry_gate: entryGate }).success
        ),
      }).toEqual({ changeTypes: true, confidences: true, decisions: true, entryGates: true });
    });

    it('treats a confidence Liquid rendered as the empty string as none', () => {
      const result = parse({ ...valid, confidence: '' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ confidence: 'none' })
      );
    });

    it.each([
      ['a change type the model invented', { change_type: 'disable_rule' }],
      ['a proposed query', { proposed_query: 'process.name: "powershell.exe"' }],
      ['a rule id', { rule_uuid: 'a1b2c3' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  describe('rule_coverage_review_completed', () => {
    const valid = {
      applied: false,
      approved_not_applied: false,
      check_failed: false,
      creation_failed: false,
      creation_skipped: false,
      decision: 'approved',
      event: 'rule_coverage_review_completed',
      investigation_id: INVESTIGATION_ID,
      ki_processed: true,
      proposal_kind: 'create_rule',
      rule_created: true,
      verdict: 'no_coverage',
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every verdict and proposal kind', () => {
      expect({
        kinds: RULE_COVERAGE_PROPOSAL_KINDS.every(
          (proposalKind) => parse({ ...valid, proposal_kind: proposalKind }).success
        ),
        verdicts: RULE_COVERAGE_VERDICTS.every((verdict) => parse({ ...valid, verdict }).success),
      }).toEqual({ kinds: true, verdicts: true });
    });

    it.each([
      ['the free-text check error', { check_error: 'coverage_check produced no verdict' }],
      ['a created rule name', { created_rule_name: 'Credential dumping via LSASS' }],
      ['an unknown verdict', { verdict: 'partially_covered' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  describe('hunt_report_completed', () => {
    const valid = {
      closed_clean: false,
      coverage_kis_skipped: 1,
      coverage_kis_written: 2,
      event: 'hunt_report_completed',
      has_confirmed_hit: true,
      hunt_status: 'success',
      investigation_id: '3f1c2b4a-5d6e-5f70-8a9b-0c1d2e3f4a5b',
      mint_suppression: 'none',
      package_status: 'success',
      proposals_dispatch_failed: 0,
      proposals_prepared: 3,
      tier2_invoked: true,
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every hunt status, package status and mint suppression', () => {
      expect({
        hunt: HUNT_REPORT_HUNT_STATUSES.every(
          (huntStatus) => parse({ ...valid, hunt_status: huntStatus }).success
        ),
        mint: HUNT_REPORT_MINT_SUPPRESSIONS.every(
          (mintSuppression) => parse({ ...valid, mint_suppression: mintSuppression }).success
        ),
        packaging: HUNT_REPORT_PACKAGE_STATUSES.every(
          (packageStatus) => parse({ ...valid, package_status: packageStatus }).success
        ),
      }).toEqual({ hunt: true, mint: true, packaging: true });
    });

    it('leaves tier2_invoked absent when the Worker did not pass it', () => {
      const result = parse({ ...valid, tier2_invoked: '' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ tier2_invoked: undefined })
      );
    });

    it('defaults an empty mint suppression to none', () => {
      const result = parse({ ...valid, mint_suppression: '' });

      expect(result.success && result.data).toEqual(
        expect.objectContaining({ mint_suppression: 'none' })
      );
    });

    it.each([
      ['a report id', { report_id: 'report-1' }],
      ['the packaging summary', { summary: 'Packaging prepared 3 proposals' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  describe('endpoint_analysis_completed', () => {
    const valid = {
      actions_recommended: 2,
      agent_failed: false,
      analysis_outcome: 'processed',
      auto_approve_requested: false,
      event: 'endpoint_analysis_completed',
      findings_attached: true,
      host_resolved: true,
      iocs_found: true,
      proposals_dispatch_failed: 0,
      proposals_dispatched: 2,
      reused_prior_assessment: false,
      timeline_found: true,
    };

    it('parses a complete payload unchanged', () => {
      expect(parse(valid)).toEqual({ data: valid, success: true });
    });

    it('accepts every analysis outcome', () => {
      expect(
        ENDPOINT_ANALYSIS_OUTCOMES.every(
          (analysisOutcome) => parse({ ...valid, analysis_outcome: analysisOutcome }).success
        )
      ).toBe(true);
    });

    it.each([
      ['a host name', { host_name: 'fin-dc-01' }],
      ['an action id', { action_id: 'system-alertzero-action-isolate-host' }],
      ['an unknown outcome', { analysis_outcome: 'retired' }],
    ])('rejects %s', (_label, override) => {
      expect(parse({ ...valid, ...override }).success).toBe(false);
    });
  });

  it('rejects an event outside the union', () => {
    expect(parse({ event: 'rule_tuning_worker_run_completed' }).success).toBe(false);
  });

  it('rejects a free-text field the schema does not declare', () => {
    expect(
      parse({
        event: 'ad_worker_analysis_completed',
        summary: 'Lateral movement from fin-dc-01',
        verdict: 'true_positive',
      }).success
    ).toBe(false);
  });

  it('rejects an id the schema does not declare', () => {
    expect(
      parse({
        event: 'ad_worker_review_started',
        execution_id: INVESTIGATION_ID,
      }).success
    ).toBe(false);
  });

  it('converts to a JSON schema the YAML editor can use', () => {
    const jsonSchema = z.toJSONSchema(reportWorkerOutcomeStepInputSchema, {
      reused: 'ref',
      target: 'draft-7',
      unrepresentable: 'any',
    }) as { oneOf?: Array<{ properties: { event: { const: string } } }> };

    expect(jsonSchema.oneOf?.map(({ properties }) => properties.event.const)).toEqual([
      ...REPORT_WORKER_OUTCOME_EVENTS,
    ]);
  });
});
