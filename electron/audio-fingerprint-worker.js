// Computes sound words off the main thread. One video at a time: 'start', then 'chunk' messages with
// PCM bytes, then 'end', answered with 'done' (words and state) or 'error'.
const { parentPort } = require('worker_threads');
const { classifyWords, createAudioWordStream } = require('./audio-fingerprint');

let stream = null;

parentPort.on('message', (message) => {
  try {
    if (message.type === 'start') {
      stream = createAudioWordStream();
    } else if (message.type === 'chunk') {
      stream.push(Buffer.from(message.bytes.buffer, message.bytes.byteOffset, message.bytes.byteLength));
    } else if (message.type === 'end') {
      const words = stream.finish();
      stream = null;
      parentPort.postMessage({ type: 'done', words, state: classifyWords(words) }, [words.buffer]);
    }
  } catch (err) {
    stream = null;
    parentPort.postMessage({ type: 'error', message: err?.message || String(err) });
  }
});
