// @ts-check
const path = require('path');
const { spawn } = require('child_process');

const system32 = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

/**
 * Commands for the end-of-processing actions. Sleep goes through SetSuspendState rather than the
 * common `rundll32 powrprof.dll,SetSuspendState` trick, which hibernates instead of sleeping on PCs
 * that have hibernation enabled. Shutdown has no /f, so apps with unsaved work can still stop it.
 *
 * `detached` decides whether the command outlives VideoCull: shutdown runs while VideoCull exits,
 * so it must. Sleep must not be detached: PowerShell started without a console (what detached
 * means on Windows) exits with code 0 without running its command.
 *
 * @param {'sleep' | 'shutdown'} action
 * @returns {{ file: string, args: string[], detached: boolean }}
 */
function powerCommand(action) {
  if (action === 'sleep') {
    return {
      file: path.join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoProfile', '-NonInteractive', '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; if (-not [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)) { exit 1 }",
      ],
      detached: false,
    };
  }
  return { file: path.join(system32(), 'shutdown.exe'), args: ['/s', '/t', '0'], detached: true };
}

/**
 * @param {'sleep' | 'shutdown'} action
 * @param {(error: Error) => void} onError also called when the command reports failure
 */
function runPowerCommand(action, onError) {
  const { file, args, detached } = powerCommand(action);
  const child = spawn(file, args, { detached, stdio: 'ignore', windowsHide: true });
  child.on('error', onError);
  child.on('exit', (code) => {
    if (code !== 0) onError(new Error(`${path.basename(file)} exited with code ${code}`));
  });
  if (detached) child.unref();
  return child;
}

module.exports = { powerCommand, runPowerCommand };
