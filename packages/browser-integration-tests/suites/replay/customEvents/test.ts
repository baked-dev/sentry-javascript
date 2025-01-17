import { expect } from '@playwright/test';

import { sentryTest } from '../../../utils/fixtures';
import {
  expectedClickBreadcrumb,
  expectedFCPPerformanceSpan,
  expectedFPPerformanceSpan,
  expectedLCPPerformanceSpan,
  expectedMemoryPerformanceSpan,
  expectedNavigationPerformanceSpan,
  getExpectedReplayEvent,
} from '../../../utils/replayEventTemplates';
import type { PerformanceSpan } from '../../../utils/replayHelpers';
import {
  getCustomRecordingEvents,
  getReplayEvent,
  shouldSkipReplayTest,
  waitForReplayRequest,
} from '../../../utils/replayHelpers';

sentryTest(
  'replay recording should contain default performance spans',
  async ({ getLocalTestPath, page, browserName }) => {
    // We only test this against the NPM package and replay bundles
    // and only on chromium as most performance entries are only available in chromium
    if (shouldSkipReplayTest() || browserName !== 'chromium') {
      sentryTest.skip();
    }

    const reqPromise0 = waitForReplayRequest(page, 0);
    const reqPromise1 = waitForReplayRequest(page, 1);

    await page.route('https://dsn.ingest.sentry.io/**/*', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-id' }),
      });
    });

    const url = await getLocalTestPath({ testDir: __dirname });

    await page.goto(url);
    const replayEvent0 = getReplayEvent(await reqPromise0);
    const { performanceSpans: performanceSpans0 } = getCustomRecordingEvents(await reqPromise0);

    expect(replayEvent0).toEqual(getExpectedReplayEvent({ segment_id: 0 }));

    await page.click('button');

    const replayEvent1 = getReplayEvent(await reqPromise1);
    const { performanceSpans: performanceSpans1 } = getCustomRecordingEvents(await reqPromise1);

    expect(replayEvent1).toEqual(
      getExpectedReplayEvent({ segment_id: 1, urls: [], replay_start_timestamp: undefined }),
    );

    // We can't guarantee the order of the performance spans, or in which of the two segments they are sent
    // So to avoid flakes, we collect them all and check that they are all there
    const collectedPerformanceSpans = [...performanceSpans0, ...performanceSpans1];

    expect(collectedPerformanceSpans).toEqual(
      expect.arrayContaining([
        expectedNavigationPerformanceSpan,
        expectedLCPPerformanceSpan,
        expectedFPPerformanceSpan,
        expectedFCPPerformanceSpan,
        expectedMemoryPerformanceSpan, // two memory spans - once per flush
        expectedMemoryPerformanceSpan,
      ]),
    );

    const lcpSpan = collectedPerformanceSpans.find(
      s => s.description === 'largest-contentful-paint',
    ) as PerformanceSpan;

    // LCP spans should be point-in-time spans
    expect(lcpSpan?.startTimestamp).toBeCloseTo(lcpSpan?.endTimestamp);
  },
);

sentryTest(
  'replay recording should contain a click breadcrumb when a button is clicked',
  async ({ getLocalTestPath, page }) => {
    if (shouldSkipReplayTest()) {
      sentryTest.skip();
    }

    const reqPromise0 = waitForReplayRequest(page, 0);
    const reqPromise1 = waitForReplayRequest(page, 1);

    await page.route('https://dsn.ingest.sentry.io/**/*', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-id' }),
      });
    });

    const url = await getLocalTestPath({ testDir: __dirname });

    await page.goto(url);
    const replayEvent0 = getReplayEvent(await reqPromise0);
    const { breadcrumbs: breadcrumbs0 } = getCustomRecordingEvents(await reqPromise0);

    expect(replayEvent0).toEqual(getExpectedReplayEvent({ segment_id: 0 }));
    expect(breadcrumbs0.length).toEqual(0);

    await page.click('button');

    const replayEvent1 = getReplayEvent(await reqPromise1);
    const { breadcrumbs: breadcrumbs1 } = getCustomRecordingEvents(await reqPromise1);

    expect(replayEvent1).toEqual(
      getExpectedReplayEvent({ segment_id: 1, urls: [], replay_start_timestamp: undefined }),
    );

    expect(breadcrumbs1).toEqual([expectedClickBreadcrumb]);
  },
);
