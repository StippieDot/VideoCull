const assert = require('node:assert/strict');

const { createRunToken, cancelRun, __test } = require('../../electron/media-process');
const processor = require('../../electron/processor');

const { runProcess, parseProbeOutput } = __test;
const node = process.execPath;

describe('frame extraction arguments', () => {
  // Recorded from fluent-ffmpeg 2.1.3 for the command extractFrame used to build, so thumbnails keep
  // the exact same FFmpeg invocation after the wrapper was removed.
  const input = 'C:\\videos\\in.mp4';
  const output = 'C:\\thumbs\\thumb_01.jpg';

  test('default: thread limit on, no hardware acceleration', () => {
    assert.deepEqual(processor.__test.buildFrameArgs(input, 12.5, output, {}), [
      '-ss', '12.5', '-i', input, '-y', '-vframes', '1', '-filter:v', 'scale=320:-1', '-q:v', '5',
      '-threads', '1', output,
    ]);
  });

  test('hardware acceleration goes before the input', () => {
    assert.deepEqual(processor.__test.buildFrameArgs(input, 0, output, { hardwareAccel: true }), [
      '-ss', '0', '-hwaccel', 'auto', '-i', input, '-y', '-vframes', '1', '-filter:v', 'scale=320:-1',
      '-q:v', '5', '-threads', '1', output,
    ]);
  });

  test('thread limit can be turned off', () => {
    assert.deepEqual(
      processor.__test.buildFrameArgs(input, 3, output, { hardwareAccel: true, cpuThreadsLimited: false }),
      ['-ss', '3', '-hwaccel', 'auto', '-i', input, '-y', '-vframes', '1', '-filter:v', 'scale=320:-1',
        '-q:v', '5', output],
    );
  });
});

describe('runProcess', () => {
  test('returns stdout when asked to capture it', async () => {
    const stdout = await runProcess(node, ['-e', 'process.stdout.write("hello")'], createRunToken(), {
      maxStdoutBytes: 1024,
    });
    assert.equal(stdout.toString(), 'hello');
  });

  test('rejects with the exit code and stderr tail', async () => {
    await assert.rejects(
      runProcess(node, ['-e', 'process.stderr.write("broken input"); process.exit(3)'], createRunToken()),
      /exited with code 3\nbroken input/,
    );
  });

  test('cancelling the run kills its running processes', async () => {
    const token = createRunToken();
    const started = Date.now();
    const run = runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], token);
    assert.equal(token.children.size, 1);

    cancelRun(token);

    await assert.rejects(run, /Cancelled/);
    assert.equal(token.children.size, 0);
    assert.ok(Date.now() - started < 10000);
  });

  test('cancelling one run leaves another run alone', async () => {
    const cancelled = createRunToken();
    const other = createRunToken();
    const cancelledRun = runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], cancelled);
    const otherRun = runProcess(node, ['-e', 'setTimeout(() => {}, 300)'], other);

    cancelRun(cancelled);

    await assert.rejects(cancelledRun, /Cancelled/);
    await otherRun;
  });

  test('refuses to start once the run is cancelled', async () => {
    const token = createRunToken();
    cancelRun(token);
    await assert.rejects(runProcess(node, ['-e', ''], token), /Cancelled/);
    assert.equal(token.children.size, 0);
  });

  test('kills a process that exceeds its timeout', async () => {
    await assert.rejects(
      runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], createRunToken(), { timeoutMs: 200 }),
      (error) => error.code === 'ETIMEDOUT' && /timed out after 200 ms/.test(error.message),
    );
  });

  test('kills a process whose output exceeds the limit', async () => {
    await assert.rejects(
      runProcess(node, ['-e', 'process.stdout.write("x".repeat(100000)); setTimeout(() => {}, 60000)'],
        createRunToken(), { maxStdoutBytes: 1000 }),
      /output exceeded 1000 bytes/,
    );
  });

  test('rejects when the binary cannot be started', async () => {
    await assert.rejects(runProcess('Z:\\missing\\ffprobe.exe', [], createRunToken()), /ENOENT/);
  });
});

describe('parseProbeOutput', () => {
  test('keeps format and streams', () => {
    assert.deepEqual(
      parseProbeOutput('{"format":{"duration":"1.5"},"streams":[{"codec_type":"video"}]}'),
      { format: { duration: '1.5' }, streams: [{ codec_type: 'video' }] },
    );
  });

  test('fills in missing sections', () => {
    assert.deepEqual(parseProbeOutput('{}'), { format: {}, streams: [] });
  });

  test('treats malformed JSON as a probe failure', () => {
    assert.throws(() => parseProbeOutput('{"format":'), /malformed JSON/);
    assert.throws(() => parseProbeOutput('null'), /malformed JSON/);
  });
});
