function createKeyedOperationQueue() {
  const tails = new Map();

  function run(key, operation) {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    let tail;
    tail = result.finally(() => {
      if (tails.get(key) !== tail) return;
      tails.delete(key);
    });
    tails.set(key, tail);
    return tail;
  }

  function pendingCount() {
    return tails.size;
  }

  return { run, pendingCount };
}

module.exports = { createKeyedOperationQueue };
