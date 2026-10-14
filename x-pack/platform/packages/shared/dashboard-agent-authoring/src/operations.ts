/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { DashboardAttachmentData } from '@kbn/agent-builder-dashboards-common';
import type { Logger } from '@kbn/logging';
import type { ResolvePanelContent } from './operations/panels';
import type { ResolveAttachmentPanel, ResolveControlFieldCapabilities } from './operations/types';
import type { OperationFailure } from './utils';
import type { PanelAuthoringNote } from './resolve_panel';
import { discardInvalidChanges, type ValidateDashboard } from './validate_dashboard';
import {
  dashboardOperationSchema,
  executeOperationHandler,
  prepareOperationExecution,
  type DashboardOperation,
} from './operations/registry';

export { dashboardOperationSchema };
export type { DashboardOperation };

interface ExecuteDashboardOperationsParams {
  dashboardData?: DashboardAttachmentData;
  operations: DashboardOperation[];
  logger: Logger;
  resolvePanelContent?: ResolvePanelContent;
  resolveAttachmentPanel?: ResolveAttachmentPanel;
  resolveControlFieldCapabilities?: ResolveControlFieldCapabilities;
  finalizeDashboard?: FinalizeDashboard;
  validateDashboard?: ValidateDashboard;
}

/** What the operations changed, for hooks that complete the dashboard (e.g. its layout). */
export interface FinalizeDashboardContext {
  originalDashboardData: DashboardAttachmentData;
  /** Existing panels whose content was edited. */
  editedPanelIds: ReadonlySet<string>;
  panelAuthoringNotes: readonly PanelAuthoringNote[];
  /** Reports a failure to the agent alongside the operation failures. */
  reportFailure: (failure: OperationFailure) => void;
}

/**
 * Completes the dashboard after all operations ran and their invalid changes were discarded. What
 * it changes is validated again.
 */
export type FinalizeDashboard = (
  dashboardData: DashboardAttachmentData,
  context: FinalizeDashboardContext
) => Promise<DashboardAttachmentData>;

/**
 * Environment-agnostic dashboard generation: turns a prior dashboard payload (or
 * an empty one) plus an ordered list of operations into a new payload. Identity,
 * persistence, and result shape belong to the calling tool. Inline panel content
 * is resolved via the injected `resolvePanelContent` callback, so the core never
 * reads any store. Control fields are validated against index mappings when
 * the host provides `resolveControlFieldCapabilities`. New panels and sections
 * are placed below the existing ones, two panels per row. When the host provides
 * `validateDashboard`, changes that make the dashboard invalid are discarded and
 * reported as failures. The host can then complete the result with
 * `finalizeDashboard` (e.g. a default time range, or arranging the layout),
 * whose changes are validated again.
 */
export const executeDashboardOperations = async ({
  dashboardData,
  operations,
  logger,
  resolvePanelContent,
  resolveAttachmentPanel,
  resolveControlFieldCapabilities,
  finalizeDashboard,
  validateDashboard,
}: ExecuteDashboardOperationsParams): Promise<{
  dashboardData: DashboardAttachmentData;
  failures: OperationFailure[];
  panelAuthoringNotes: PanelAuthoringNote[];
}> => {
  const originalDashboardData = structuredClone(
    dashboardData ?? {
      title: 'User Dashboard',
      description: undefined,
      panels: [],
    }
  );
  let nextDashboardData = structuredClone(originalDashboardData);
  const failures: OperationFailure[] = [];
  const panelAuthoringNotes: PanelAuthoringNote[] = [];

  const context = await prepareOperationExecution({
    operations,
    logger,
    resolvePanelContent,
    resolveAttachmentPanel,
    resolveControlFieldCapabilities,
    failures,
    panelAuthoringNotes,
  });

  for (const [operationIndex, operation] of operations.entries()) {
    nextDashboardData = await executeOperationHandler({
      dashboardData: nextDashboardData,
      operation,
      operationIndex,
      context,
    });
  }

  const discardedPanelIds = new Set<string>();
  const validate = (dashboardDataToValidate: DashboardAttachmentData) => {
    if (!validateDashboard) {
      return dashboardDataToValidate;
    }
    const validationResult = discardInvalidChanges({
      originalDashboardData,
      dashboardData: dashboardDataToValidate,
      validateDashboard,
    });
    failures.push(...validationResult.failures);
    validationResult.discardedPanelIds.forEach((panelId) => discardedPanelIds.add(panelId));
    return validationResult.dashboardData;
  };
  const getKeptAuthoringNotes = () =>
    panelAuthoringNotes.filter(({ panelId }) => !discardedPanelIds.has(panelId));

  // Discard invalid changes before finalizing, so the layout is arranged for the panels that are kept.
  nextDashboardData = validate(nextDashboardData);
  // Validation returns the original dashboard when it discarded all changes. Finalizing must not then
  // add changes of its own, such as a default time range.
  const allChangesDiscarded = nextDashboardData === originalDashboardData;

  if (finalizeDashboard && !allChangesDiscarded) {
    nextDashboardData = validate(
      await finalizeDashboard(nextDashboardData, {
        originalDashboardData,
        editedPanelIds: new Set(
          [...context.editedPanelIds].filter((panelId) => !discardedPanelIds.has(panelId))
        ),
        panelAuthoringNotes: getKeptAuthoringNotes(),
        reportFailure: (failure) => failures.push(failure),
      })
    );
  }

  return {
    dashboardData: nextDashboardData,
    failures,
    panelAuthoringNotes: getKeptAuthoringNotes(),
  };
};
