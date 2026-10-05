// @ts-check
const path = require('path');
const { spawn } = require('child_process');
const { ffmpegPath, ffprobePath } = require('./media-tools');

// Only catches a hung ffprobe. On network drives, many probes in parallel with thumbnail work can
// each take well over 30 s while still making progress.
const PROBE_TIMEOUT_MS = 120_000;
const PROBE_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;

/**
 * Cancellation scope for one pipeline run (metadata, thumbnails, ...). Cancelling one run never
 * touches processes started by another run.
 * @typedef {{ cancelled: boolean, children: Set<import('child_process').ChildProcess> }} MediaRunToken
 */

/** @returns {MediaRunToken} */
function createRunToken() {
  return { cancelled: false, children: new Set() };
}

/** @param {MediaRunToken | null | undefined} token */
function cancelRun(token) {
  if (!token) return;
  token.cancelled = true;
  for (const child of token.children) {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
  token.children.clear();
}

/**
 * FFmpeg needs the extended-length prefix for long local and UNC paths on Windows.
 * @param {string} filePath
 */
function toFfmpegInputPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const resolved = path.resolve(filePath);
  if (resolved.startsWith('\\\\?\\')) return resolved;
  if (resolved.length < 240) return resolved;
  if (resolved.startsWith('\\\\')) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  return `\\\\?\\${resolved}`;
}

/**
 * @param {string} binaryPath
 * @param {string[]} args
 * @param {MediaRunToken} token
 * @param {{ timeoutMs?: number, maxStdoutBytes?: number }} [options]
 *   Without maxStdoutBytes stdout is ignored.
 * @returns {Promise<Buffer>} stdout
 */
function runProcess(binaryPath, args, token, options = {}) {
  const { timeoutMs = 0, maxStdoutBytes = 0 } = options;
  return new Promise((resolve, reject) => {
    if (token.cancelled) {
      reject(new Error('Cancelled'));
      return;
    }
    const name = path.basename(binaryPath);
    const child = spawn(binaryPath, args, { windowsHide: true });
    token.children.add(child);

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderr = '';
    /** @type {Error | null} */
    let failure = null;
    const fail = (/** @type {Error} */ error) => {
      if (failure) return;
      failure = error;
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => fail(Object.assign(new Error(`${name} timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' })), timeoutMs)
      : null;

    child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
      if (!maxStdoutBytes) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        fail(new Error(`${name} output exceeded ${maxStdoutBytes} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (/** @type {Buffer} */ chunk) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      token.children.delete(child);
      if (token.cancelled) {
        reject(new Error('Cancelled'));
      } else if (failure) {
        reject(failure);
      } else if (code !== 0) {
        const reason = code === null ? `was killed with signal ${signal}` : `exited with code ${code}`;
        reject(new Error(`${name} ${reason}${stderr ? `\n${stderr.trim()}` : ''}`));
      } else {
        resolve(Buffer.concat(stdoutChunks));
      }
    });
  });
}

/**
 * @param {string} stdout
 * @returns {{ format: Record<string, any>, streams: Record<string, any>[] }}
 */
function parseProbeOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe returned malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('ffprobe returned malformed JSON');
  return {
    format: parsed.format && typeof parsed.format === 'object' ? parsed.format : {},
    streams: Array.isArray(parsed.streams) ? parsed.streams : [],
  };
}

/**
 * @param {string} filePath
 * @param {MediaRunToken} token
 */
async function probe(filePath, token) {
  const stdout = await runProcess(ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    toFfmpegInputPath(filePath),
  ], token, { timeoutMs: PROBE_TIMEOUT_MS, maxStdoutBytes: PROBE_MAX_STDOUT_BYTES });
  return parseProbeOutput(stdout.toString('utf8'));
}

/**
 * @param {string[]} args
 * @param {MediaRunToken} token
 * @param {{ timeoutMs?: number }} [options]
 */
async function runFfmpeg(args, token, options = {}) {
  await runProcess(ffmpegPath, args, token, { timeoutMs: options.timeoutMs });
}

module.exports = {
  createRunToken,
  cancelRun,
  toFfmpegInputPath,
  probe,
  runFfmpeg,
  __test: { runProcess, parseProbeOutput },
};
