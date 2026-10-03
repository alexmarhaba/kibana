/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { coreMock } from '@kbn/core/server/mocks';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { ALERTZERO_TELEMETRY_EVENTS } from './constants';
import type { AlertZeroWorkerActivatedPayload } from './event_types';
import { createAlertZeroTelemetryReporter, safeReportEvent } from './safe_report_event';

const payload: AlertZeroWorkerActivatedPayload = {
  autonomy_level: 'manual',
  enabled: true,
  is_default_space: true,
  watch_tag: 'watch-floor',
  worker_id: 'system-security-floor-attack-discovery',
};

const createDeps = () => ({
  analytics: coreMock.createSetup().analytics,
  logger: loggingSystemMock.createLogger(),
});

describe('safeReportEvent', () => {
  it('reports the event type and payload through core analytics', () => {
    const { analytics, logger } = createDeps();

    safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });

    expect(analytics.reportEvent).toHaveBeenCalledWith(
      ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      payload
    );
  });

  it('does not throw when reportEvent throws', () => {
    const { analytics, logger } = createDeps();
    analytics.reportEvent.mockImplementation(() => {
      throw new Error('Attempted to report event type before registering it');
    });

    expect(() =>
      safeReportEvent({
        analytics,
        eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
        logger,
        payload,
      })
    ).not.toThrow();
  });

  it('logs the failure lazily at debug level', () => {
    const { analytics, logger } = createDeps();
    analytics.reportEvent.mockImplementation(() => {
      throw new Error('boom');
    });

    safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });

    expect(logger.debug).toHaveBeenCalledWith(expect.any(Function));
  });

  it('names the event type and the error in the debug message', () => {
    const { analytics, logger } = createDeps();
    analytics.reportEvent.mockImplementation(() => {
      throw new Error('boom');
    });

    safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });
    const message = (logger.debug.mock.calls[0][0] as () => string)();

    expect(message).toBe(
      `Failed to report telemetry event ${ALERTZERO_TELEMETRY_EVENTS.WorkerActivated}: boom`
    );
  });

  it('describes a non-Error throw in the debug message', () => {
    const { analytics, logger } = createDeps();
    const notAnError: unknown = 'not an error';
    analytics.reportEvent.mockImplementation(() => {
      throw notAnError;
    });

    safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });
    const message = (logger.debug.mock.calls[0][0] as () => string)();

    expect(message).toBe(
      `Failed to report telemetry event ${ALERTZERO_TELEMETRY_EVENTS.WorkerActivated}: not an error`
    );
  });

  it('returns true when the event is reported', () => {
    const { analytics, logger } = createDeps();

    const reported = safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });

    expect(reported).toBe(true);
  });

  it('returns false when reportEvent throws', () => {
    const { analytics, logger } = createDeps();
    analytics.reportEvent.mockImplementation(() => {
      throw new Error('boom');
    });

    const reported = safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });

    expect(reported).toBe(false);
  });

  it('does not log when the event is reported', () => {
    const { analytics, logger } = createDeps();

    safeReportEvent({
      analytics,
      eventType: ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      logger,
      payload,
    });

    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe('createAlertZeroTelemetryReporter', () => {
  it('returns a reporter bound to the analytics service', () => {
    const { analytics, logger } = createDeps();
    const reportEvent = createAlertZeroTelemetryReporter({ analytics, logger });

    reportEvent(ALERTZERO_TELEMETRY_EVENTS.WorkerActivated, payload);

    expect(analytics.reportEvent).toHaveBeenCalledWith(
      ALERTZERO_TELEMETRY_EVENTS.WorkerActivated,
      payload
    );
  });

  it('returns a reporter that never throws', () => {
    const { analytics, logger } = createDeps();
    analytics.reportEvent.mockImplementation(() => {
      throw new Error('boom');
    });
    const reportEvent = createAlertZeroTelemetryReporter({ analytics, logger });

    expect(() => reportEvent(ALERTZERO_TELEMETRY_EVENTS.WorkerActivated, payload)).not.toThrow();
  });

  it('returns a reporter that tells whether the event was reported', () => {
    const { analytics, logger } = createDeps();
    const reportEvent = createAlertZeroTelemetryReporter({ analytics, logger });

    expect(reportEvent(ALERTZERO_TELEMETRY_EVENTS.WorkerActivated, payload)).toBe(true);
  });
});
