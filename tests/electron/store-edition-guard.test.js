const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const {
  acquireEditionGuard,
  closeEditionGuard,
  createEditionGuardName,
  shouldAcquireEditionGuard,
} = require('../../electron/edition-guard');

function fakeNet(outcome = 'listening') {
  let created;
  return {
    get server() { return created; },
    createServer() {
      created = new EventEmitter();
      created.close = () => { created.closed = true; };
      created.listen = (name) => {
        created.name = name;
        queueMicrotask(() => {
          if (outcome === 'listening') created.emit('listening');
          else created.emit('error', Object.assign(new Error(outcome), { code: outcome }));
        });
      };
      return created;
    },
  };
}

test('uses the required packaged-app LOCAL named-pipe namespace', () => {
  const name = createEditionGuardName();
  assert.match(name, /^\\\\\.\\pipe\\LOCAL\\VideoCull-EditionGuard-[a-f0-9]{16}$/);
  assert.equal(createEditionGuardName(), name);
});

test('enables exclusion only for packaged Windows production launches', () => {
  assert.equal(shouldAcquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false }), true);
  assert.equal(shouldAcquireEditionGuard({ isPackaged: false, platform: 'win32', isE2E: false }), false);
  assert.equal(shouldAcquireEditionGuard({ isPackaged: true, platform: 'linux', isE2E: false }), false);
  assert.equal(shouldAcquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: true }), false);
});

test('first launch owns the atomic guard until it closes', async () => {
  const netImpl = fakeNet();
  const guard = await acquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false, netImpl });
  assert.equal(guard.pipeName, netImpl.server.name);
  closeEditionGuard(guard);
  assert.equal(netImpl.server.closed, true);
});

test('address collisions and permission failures fail closed without PID logic', async () => {
  await assert.rejects(
    acquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false, netImpl: fakeNet('EADDRINUSE') }),
    (error) => error.code === 'VIDEOCULL_ALREADY_RUNNING',
  );
  await assert.rejects(
    acquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false, netImpl: fakeNet('EACCES') }),
    (error) => error.code === 'VIDEOCULL_GUARD_FAILED',
  );
});

test('Windows releases a real LOCAL pipe after its owner closes', { skip: process.platform !== 'win32' }, async () => {
  const pipeName = `\\\\.\\pipe\\LOCAL\\VideoCull-EditionGuard-Test-${process.pid}-${Date.now()}`;
  const first = await acquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false, pipeName });
  await assert.rejects(
    acquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false, pipeName }),
    (error) => error.code === 'VIDEOCULL_ALREADY_RUNNING',
  );
  await new Promise((resolve, reject) => first.server.close((error) => (error ? reject(error) : resolve())));
  const relaunched = await acquireEditionGuard({ isPackaged: true, platform: 'win32', isE2E: false, pipeName });
  await new Promise((resolve, reject) => relaunched.server.close((error) => (error ? reject(error) : resolve())));
});
