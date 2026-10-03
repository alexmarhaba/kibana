/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ReportWorkerOutcomeStepInput } from './report_worker_outcome_step';

/**
 * Fixed descriptions of every way a parsed outcome contradicts itself; empty when it does not.
 * The shared run event's `run_outcome`, `degraded` and `degraded_reason` describe one fact, so
 * the server step skips a contradictory one as `invalid_input` instead of reporting it. Kept out
 * of the input schema, so each event stays a plain object schema for the YAML editor.
 */
export const findOutcomeContradictions = (input: ReportWorkerOutcomeStepInput): string[] => {
  if (input.event !== 'worker_run_completed') {
    return [];
  }
  const { degraded, degraded_reason: degradedReason, run_outcome: runOutcome } = input;
  return [
    ...(runOutcome === 'degraded_partial' && !degraded
      ? ['run_outcome degraded_partial requires degraded: true']
      : []),
    ...(degraded && degradedReason === 'none'
      ? ['a degraded run needs a degraded_reason other than none']
      : []),
    ...(!degraded && degradedReason !== 'none'
      ? ['degraded_reason must be none when degraded is false']
      : []),
  ];
};
