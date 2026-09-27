function createKeyedOperationQueue() {
  const states = new Map();
  let sequence = 0;
  const priorities = { background: 0, foreground: 1, interactive: 2 };

  function takeNext(queue) {
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i++) {
      const candidate = queue[i];
      const best = queue[bestIndex];
      if (candidate.priority > best.priority || (
        candidate.priority === best.priority && candidate.sequence < best.sequence
      )) bestIndex = i;
    }
    return queue.splice(bestIndex, 1)[0];
  }

  function pump(key, state) {
    if (state.running || state.queue.length === 0) return;
    state.running = true;
    const item = takeNext(state.queue);
    const finish = () => {
      state.running = false;
      if (state.queue.length === 0) states.delete(key);
      else pump(key, state);
    };
    Promise.resolve()
      .then(item.operation)
      .then(
        (value) => {
          finish();
          item.resolve(value);
        },
        (error) => {
          finish();
          item.reject(error);
        },
      );
  }

  function run(key, operation, priority = 'foreground') {
    let state = states.get(key);
    if (!state) {
      state = { running: false, queue: [] };
      states.set(key, state);
    }
    const result = new Promise((resolve, reject) => {
      state.queue.push({
        operation,
        priority: priorities[priority] ?? priorities.foreground,
        sequence: sequence++,
        resolve,
        reject,
      });
    });
    pump(key, state);
    return result;
  }

  function pendingCount() {
    return states.size;
  }

  return { run, pendingCount };
}

module.exports = { createKeyedOperationQueue };
