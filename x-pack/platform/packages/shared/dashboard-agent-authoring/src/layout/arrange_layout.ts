/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import {
  isSection,
  type AttachmentPanel,
  type DashboardAttachmentData,
} from '@kbn/agent-builder-dashboards-common';
import { indexPanelsById } from '../dashboard_state';
import { getErrorMessage } from '../utils';
import type { PanelAuthoringNote } from '../resolve_panel';
import {
  GRID_COLUMNS,
  layoutArrangementSchema,
  type ArrangeDashboardLayout,
  type LayoutArrangement,
  type LayoutPanel,
  type LayoutRequest,
} from './types';

interface ArrangeLayoutParams {
  originalDashboardData: DashboardAttachmentData;
  dashboardData: DashboardAttachmentData;
  /** Existing panels whose content was edited in this call. */
  editedPanelIds: ReadonlySet<string>;
  panelAuthoringNotes: readonly PanelAuthoringNote[];
  /** The user's own arrangement or size request. */
  instructions?: string;
  arrangeLayout: ArrangeDashboardLayout;
  logger: Logger;
}

/**
 * Sets the grid of every panel and section with the injected `arrangeLayout` model call, when the
 * panels changed or the user asked for a layout change. When the call fails, the dashboard keeps
 * its current layout.
 */
export const arrangeDashboardLayout = async ({
  originalDashboardData,
  dashboardData,
  editedPanelIds,
  panelAuthoringNotes,
  instructions,
  arrangeLayout,
  logger,
}: ArrangeLayoutParams): Promise<DashboardAttachmentData> => {
  if (
    dashboardData.panels.length === 0 ||
    (instructions === undefined &&
      JSON.stringify(originalDashboardData.panels) === JSON.stringify(dashboardData.panels))
  ) {
    return dashboardData;
  }

  const originalPanelIds = new Set(indexPanelsById(originalDashboardData.panels).keys());
  const originalSectionIds = new Set(
    originalDashboardData.panels.filter(isSection).map(({ id }) => id)
  );
  const authoringNotesByPanelId = new Map(
    panelAuthoringNotes.map(({ panelId, authoringNote }) => [panelId, authoringNote])
  );

  const toLayoutPanel = ({ id, type, config, grid }: AttachmentPanel): LayoutPanel => ({
    id,
    type,
    ...(typeof config.type === 'string' ? { chartType: config.type } : {}),
    ...(typeof config.title === 'string' ? { title: config.title } : {}),
    ...(authoringNotesByPanelId.has(id) ? { authoringNote: authoringNotesByPanelId.get(id) } : {}),
    ...(typeof config.content === 'string' ? { markdownLength: config.content.length } : {}),
    grid,
    isNew: !originalPanelIds.has(id),
    contentChanged: editedPanelIds.has(id),
  });

  const toLayoutPanels = (panels: AttachmentPanel[]): LayoutPanel[] =>
    [...panels].sort(byReadingOrder).map(toLayoutPanel);

  const request: LayoutRequest = {
    dashboardTitle: dashboardData.title,
    ...(dashboardData.description ? { dashboardDescription: dashboardData.description } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    panels: toLayoutPanels(
      dashboardData.panels.filter((widget): widget is AttachmentPanel => !isSection(widget))
    ),
    sections: dashboardData.panels.filter(isSection).map((section) => ({
      id: section.id,
      title: section.title,
      y: section.grid.y,
      isNew: !originalSectionIds.has(section.id),
      panels: toLayoutPanels(section.panels),
    })),
  };

  const arrangement = await requestArrangement({ arrangeLayout, request, logger });
  return arrangement ? applyArrangement(dashboardData, arrangement) : dashboardData;
};

const byReadingOrder = (a: AttachmentPanel, b: AttachmentPanel): number =>
  a.grid.y - b.grid.y || a.grid.x - b.grid.x;

const requestArrangement = async ({
  arrangeLayout,
  request,
  logger,
}: {
  arrangeLayout: ArrangeDashboardLayout;
  request: LayoutRequest;
  logger: Logger;
}): Promise<LayoutArrangement | undefined> => {
  try {
    const result = layoutArrangementSchema.safeParse(await arrangeLayout(request));
    if (result.success) {
      return result.data;
    }
    logger.warn(`Dashboard layout returned an invalid arrangement: ${result.error.message}`);
  } catch (error) {
    logger.warn(`Dashboard layout failed, keeping the current layout: ${getErrorMessage(error)}`);
  }
  return undefined;
};

/** Applies the returned grids; panels that are missing or would overflow the grid keep theirs. */
const applyArrangement = (
  dashboardData: DashboardAttachmentData,
  { panels, sections }: LayoutArrangement
): DashboardAttachmentData => {
  const gridByPanelId = new Map(
    panels.filter(({ x, w }) => x + w <= GRID_COLUMNS).map(({ id, ...grid }) => [id, grid])
  );
  const sectionYById = new Map(sections.map(({ id, y }) => [id, y]));
  const placePanel = (panel: AttachmentPanel): AttachmentPanel => ({
    ...panel,
    grid: gridByPanelId.get(panel.id) ?? panel.grid,
  });

  return {
    ...dashboardData,
    panels: dashboardData.panels.map((widget) =>
      isSection(widget)
        ? {
            ...widget,
            grid: { y: sectionYById.get(widget.id) ?? widget.grid.y },
            panels: widget.panels.map(placePanel),
          }
        : placePanel(widget)
    ),
  };
};
