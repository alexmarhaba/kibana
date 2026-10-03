/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { findOutcomeContradictions } from './find_outcome_contradictions';
import { reportWorkerOutcomeStepInputSchema } from './report_worker_outcome_step';

const parseRun = (override: Record<string, unknown>) =>
  reportWorkerOutcomeStepInputSchema.parse({
    candidates_found: 12,
    degraded: true,
    degraded_reason: 'dependency_unavailable',
    event: 'worker_run_completed',
    run_outcome: 'degraded_partial',
    ...override,
  });

describe('findOutcomeContradictions', () => {
  it.each([
    ['a degraded partial run with a reason', {}],
    ['a run that produced results but is degraded by a failed lookup', { run_outcome: 'produced' }],
    [
      'a run that is not degraded',
      { degraded: false, degraded_reason: 'none', run_outcome: 'produced' },
    ],
    [
      'an empty run whose reason Liquid rendered empty',
      {
        degraded: false,
        degraded_reason: '',
        run_outcome: 'empty_nothing_pending',
      },
    ],
  ])('finds none in %s', (_label, override) => {
    expect(findOutcomeContradictions(parseRun(override))).toEqual([]);
  });

  it.each([
    [
      'degraded_partial without degraded',
      { degraded: false, degraded_reason: 'none' },
      ['run_outcome degraded_partial requires degraded: true'],
    ],
    [
      'a degraded run with degraded_reason none',
      { degraded_reason: 'none' },
      ['a degraded run needs a degraded_reason other than none'],
    ],
    [
      'a degraded_reason on a run that is not degraded',
      { degraded: false, run_outcome: 'produced' },
      ['degraded_reason must be none when degraded is false'],
    ],
  ])('finds %s', (_label, override, expected) => {
    expect(findOutcomeContradictions(parseRun(override))).toEqual(expected);
  });

  it('checks no other event', () => {
    expect(
      findOutcomeContradictions(
        reportWorkerOutcomeStepInputSchema.parse({
          event: 'ad_worker_run_completed',
          run_outcome: 'degraded_partial',
        })
      )
    ).toEqual([]);
  });
});
