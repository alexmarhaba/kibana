/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SYSTEM_SECURITY_WORKER_CATALOG } from '@kbn/alertzero-common';
import { OTHER_WATCH_TAG, OTHER_WORKER_ID } from '../constants';
import { resolveWorkerCatalogFields } from './resolve_worker_catalog_fields';

describe('resolveWorkerCatalogFields', () => {
  it.each(SYSTEM_SECURITY_WORKER_CATALOG.map(({ id, watchTag }) => [id, watchTag]))(
    'returns the catalog id and watch tag for %s',
    (workerId, watchTag) => {
      const result = resolveWorkerCatalogFields(workerId);

      expect(result).toEqual({ watch_tag: watchTag, worker_id: workerId });
    }
  );

  it('returns the `other` fallback for a worker id outside the catalog', () => {
    const result = resolveWorkerCatalogFields('my-custom-workflow');

    expect(result).toEqual({ watch_tag: OTHER_WATCH_TAG, worker_id: OTHER_WORKER_ID });
  });

  it('returns the `other` fallback for a space-suffixed document id of a catalog worker', () => {
    const result = resolveWorkerCatalogFields(`${SYSTEM_SECURITY_WORKER_CATALOG[0].id}-my-space`);

    expect(result).toEqual({ watch_tag: OTHER_WATCH_TAG, worker_id: OTHER_WORKER_ID });
  });

  it.each([[null], [undefined], ['']])(
    'returns the `other` fallback when the worker id is %p',
    (workerId) => {
      const result = resolveWorkerCatalogFields(workerId);

      expect(result).toEqual({ watch_tag: OTHER_WATCH_TAG, worker_id: OTHER_WORKER_ID });
    }
  );
});
