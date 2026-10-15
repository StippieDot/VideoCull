const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRendererSaveFlush } = require('../../electron/renderer-save-flush');

function setup({ rendererReachable = true, timeoutMs = 2000 } = {}) {
  const warnings = [];
  const requests = [];
  const flush = createRendererSaveFlush({
    send: () => {
      requests.push('flush-pending-saves');
      return rendererReachable;
    },
    log: { warn: (message) => warnings.push(message) },
    timeoutMs,
  });
  return { flush, warnings, requests };
}

describe('asking the renderer to flush its pending review saves', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('waits for the renderer to report and stays quiet when everything was saved', async () => {
    const { flush, warnings, requests } = setup();

    const done = flush.request();
    assert.deepEqual(requests, ['flush-pending-saves']);
    flush.report(0);
    await done;

    assert.deepEqual(warnings, []);
  });

  test('says in the log how many changes were left unsaved', async () => {
    const { flush, warnings } = setup();

    const done = flush.request();
    flush.report(3);
    await done;

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /3 review changes/);
  });

  test('gives up after the timeout and says so in the log', async () => {
    vi.useFakeTimers();
    const { flush, warnings } = setup({ timeoutMs: 2000 });

    const done = flush.request();
    await vi.advanceTimersByTimeAsync(2000);
    await done;

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /did not answer/);
  });

  test('does not wait when the renderer cannot be reached', async () => {
    const { flush, warnings } = setup({ rendererReachable: false });

    await flush.request();

    assert.deepEqual(warnings, []);
  });

  test('ignores a report nobody asked for', () => {
    const { flush } = setup();

    assert.doesNotThrow(() => flush.report(2));
  });
});

describe('main.js wiring', () => {
  // main.js cannot be required without Electron, so the wiring is checked as text.
  const mainSource = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8').replace(/\r\n/g, '\n');

  test('before-quit asks the renderer to flush before the shutdown starts', () => {
    const handler = mainSource.match(/app\.on\('before-quit'[\s\S]*?\n\}\);/)?.[0] ?? '';
    const flushAt = handler.indexOf('rendererSaveFlush.request()');
    assert.notEqual(flushAt, -1);
    assert.ok(flushAt < handler.indexOf('gracefulShutdown.request'));
  });

  test('closing the window goes through the quit path so the renderer is still there to flush', () => {
    const handler = mainSource.match(/mainWindow\.on\('close'[\s\S]*?\n  \}\);/)?.[0] ?? '';
    assert.match(handler, /event\.preventDefault\(\)/);
    assert.match(handler, /app\.quit\(\)/);
  });
});
