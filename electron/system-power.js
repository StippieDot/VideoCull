// @ts-check
const path = require('path');
const { spawn } = require('child_process');

const system32 = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

/**
 * Commands for the end-of-processing actions. Sleep goes through SetSuspendState rather than the
 * common `rundll32 powrprof.dll,SetSuspendState` trick, which hibernates instead of sleeping on PCs
 * that have hibernation enabled. Shutdown has no /f, so apps with unsaved work can still stop it.
 *
 * @param {'sleep' | 'shutdown'} action
 * @returns {{ file: string, args: string[] }}
 */
function powerCommand(action) {
  if (action === 'sleep') {
    return {
      file: path.join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoProfile', '-NonInteractive', '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
      ],
    };
  }
  return { file: path.join(system32(), 'shutdown.exe'), args: ['/s', '/t', '0'] };
}

/**
 * Starts the command detached, so a shutdown still runs after VideoCull has exited.
 * @param {'sleep' | 'shutdown'} action
 * @param {(error: Error) => void} onError
 */
function runPowerCommand(action, onError) {
  const { file, args } = powerCommand(action);
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', onError);
  child.unref();
  return child;
}

module.exports = { powerCommand, runPowerCommand };
