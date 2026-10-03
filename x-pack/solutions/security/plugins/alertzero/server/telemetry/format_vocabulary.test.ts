/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { formatVocabulary } from './format_vocabulary';

describe('formatVocabulary', () => {
  it('lists three or more values with commas and a final `or`', () => {
    const result = formatVocabulary(['manual', 'assisted', 'supervised']);

    expect(result).toBe('`manual`, `assisted` or `supervised`');
  });

  it('joins two values with `or`', () => {
    const result = formatVocabulary(['gated', 'auto_accept']);

    expect(result).toBe('`gated` or `auto_accept`');
  });

  it('returns a single value on its own', () => {
    const result = formatVocabulary(['produced']);

    expect(result).toBe('`produced`');
  });

  it('returns an empty string for no values', () => {
    const result = formatVocabulary([]);

    expect(result).toBe('');
  });
});
