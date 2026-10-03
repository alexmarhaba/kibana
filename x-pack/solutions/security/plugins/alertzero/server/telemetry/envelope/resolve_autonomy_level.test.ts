/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { WATCH_AUTONOMY_LEVELS } from '@kbn/alertzero-common';
import { resolveAutonomyLevel } from './resolve_autonomy_level';

describe('resolveAutonomyLevel', () => {
  it.each(WATCH_AUTONOMY_LEVELS.map((level) => [level]))(
    'returns %s from the persisted `worker_settings` const',
    (level) => {
      const result = resolveAutonomyLevel({ worker_settings: { autonomy: level } });

      expect(result).toBe(level);
    }
  );

  it('returns undefined when the definition has no consts', () => {
    const result = resolveAutonomyLevel(undefined);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the consts carry no `worker_settings`', () => {
    const result = resolveAutonomyLevel({ other: 'value' });

    expect(result).toBeUndefined();
  });

  it.each([['a string'], [42], [true], [['manual']]])(
    'returns undefined when `worker_settings` is not an object (%p)',
    (workerSettings) => {
      const result = resolveAutonomyLevel({ worker_settings: workerSettings });

      expect(result).toBeUndefined();
    }
  );

  it('returns undefined for the unrendered template placeholder', () => {
    const result = resolveAutonomyLevel({
      worker_settings: { autonomy: '__WORKER_AUTONOMY_LEVEL__' },
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined for a level outside the shared autonomy scale', () => {
    const result = resolveAutonomyLevel({ worker_settings: { autonomy: 'autonomous' } });

    expect(result).toBeUndefined();
  });

  it('returns undefined when the autonomy value is not a string', () => {
    const result = resolveAutonomyLevel({ worker_settings: { autonomy: 1 } });

    expect(result).toBeUndefined();
  });
});
