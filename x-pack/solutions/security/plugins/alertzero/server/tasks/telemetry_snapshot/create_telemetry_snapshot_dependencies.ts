/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { firstValueFrom } from 'rxjs';
import type { CoreStart } from '@kbn/core/server';
import { DEFAULT_SPACE_ID } from '@kbn/core-spaces-common';
import type { SpacesPluginStart } from '@kbn/spaces-plugin/server';
import type { TelemetryPluginStart } from '@kbn/telemetry-plugin/server';
import { ATTACK_DISCOVERY_WORKFLOWS_FEATURE_FLAG } from '../../telemetry';
import { SPACES_PAGE_SIZE } from './constants';
import { createReadOnlySavedObjectsClient } from './create_read_only_saved_objects_client';
import { enumerateSpaceIds } from './enumerate_space_ids';
import type { TelemetrySnapshotDependencies, TelemetrySnapshotManagedWorkflows } from './types';

/** Builds a snapshot run's dependencies from the plugin's start services. */
export const createTelemetrySnapshotDependencies = ({
  core,
  getManagedWorkflows,
  spaces,
  telemetry,
}: {
  core: CoreStart;
  getManagedWorkflows: () => Promise<TelemetrySnapshotManagedWorkflows | undefined>;
  spaces?: SpacesPluginStart;
  telemetry?: TelemetryPluginStart;
}): TelemetrySnapshotDependencies => ({
  analytics: core.analytics,
  // Defaults to on, like every other reader of this flag.
  getAttackDiscoveryWorkflowsEnabled: () =>
    firstValueFrom(
      core.featureFlags.getBooleanValue$(ATTACK_DISCOVERY_WORKFLOWS_FEATURE_FLAG, true)
    ),
  getManagedWorkflows,
  // Advanced Settings live in the space's `config` saved object. The unsafe internal client
  // carries the spaces extension, so `asScopedToNamespace` really scopes each read to the space.
  // A settings read creates or upgrades a missing `config` object, so the client it reads through
  // refuses every write: the task reads the space's settings without changing them.
  getUiSettingsClient: (spaceId) =>
    core.uiSettings.asScopedToClient(
      createReadOnlySavedObjectsClient(
        core.savedObjects.getUnsafeInternalClient().asScopedToNamespace(spaceId)
      )
    ),
  isOptedIn$: telemetry?.isOptedIn$,
  // `space` is a hidden, namespace-agnostic type, so an internal repository that includes it can
  // list every space. Without the spaces plugin there is only the default space.
  listSpaceIds: async (signal) =>
    spaces
      ? enumerateSpaceIds({
          pageSize: SPACES_PAGE_SIZE,
          signal,
          spaceRepository: core.savedObjects.createInternalRepository(['space']),
        })
      : [DEFAULT_SPACE_ID],
  serviceAccountsEnabled: core.security.serviceAccounts.isEnabled(),
});
