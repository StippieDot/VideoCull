const { parentPort } = require('node:worker_threads');
const { executeCacheOperation } = require('./cache-worker-operations');

const queues = {
  interactive: [],
  foreground: [],
  background: [],
};
let draining = false;

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack,
    code: error?.code,
  };
}

function nextRequest() {
  return queues.interactive.shift() || queues.foreground.shift() || queues.background.shift() || null;
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    let request;
    while ((request = nextRequest())) {
      try {
        const result = await executeCacheOperation(request.operation, request.args);
        parentPort.postMessage({ id: request.id, result });
      } catch (error) {
        parentPort.postMessage({ id: request.id, error: serializeError(error) });
      }
    }
  } finally {
    draining = false;
  }
}

parentPort.on('message', (request) => {
  const priority = queues[request.priority] ? request.priority : 'foreground';
  queues[priority].push(request);
  void drain();
});
