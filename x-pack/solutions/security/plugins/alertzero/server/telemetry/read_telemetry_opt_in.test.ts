/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { BehaviorSubject, NEVER, Subject, throwError } from 'rxjs';
import { readTelemetryOptIn } from './read_telemetry_opt_in';

describe('readTelemetryOptIn', () => {
  it('is opted out without the telemetry plugin', async () => {
    await expect(readTelemetryOptIn({ isOptedIn$: undefined, timeoutMs: 10 })).resolves.toBe(false);
  });

  it.each([true, false])('returns the current opt-in value %s', async (optedIn) => {
    await expect(
      readTelemetryOptIn({ isOptedIn$: new BehaviorSubject(optedIn), timeoutMs: 10 })
    ).resolves.toBe(optedIn);
  });

  it('is opted out when no opt-in decision arrives in time', async () => {
    await expect(readTelemetryOptIn({ isOptedIn$: NEVER, timeoutMs: 10 })).resolves.toBe(false);
  });

  it('is opted out when the stream completes without a value', async () => {
    const isOptedIn$ = new Subject<boolean>();
    const result = readTelemetryOptIn({ isOptedIn$, timeoutMs: 1_000 });
    isOptedIn$.complete();

    await expect(result).resolves.toBe(false);
  });

  it('is opted out when the stream errors', async () => {
    await expect(
      readTelemetryOptIn({ isOptedIn$: throwError(() => new Error('boom')), timeoutMs: 10 })
    ).resolves.toBe(false);
  });
});
