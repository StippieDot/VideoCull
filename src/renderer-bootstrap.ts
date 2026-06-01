function disableReactDevUserTiming() {
  if (!import.meta.env.DEV) return;

  try {
    if (typeof console.timeStamp === 'function') {
      // React 19 dev builds use console.timeStamp + performance.measure to
      // publish component render diagnostics. Large virtualized prop graphs can
      // make that structured clone path blow up the Electron renderer.
      Object.defineProperty(console, 'timeStamp', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  } catch {
    try {
      (console as { timeStamp?: unknown }).timeStamp = undefined;
    } catch {
      // Leave the platform default intact if the console cannot be patched.
    }
  }
}

disableReactDevUserTiming();
void import('./main');
