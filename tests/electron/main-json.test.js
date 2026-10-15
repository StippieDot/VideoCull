const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const mainSource = readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
const jsonSource = ['readJsonFile', 'writeJsonFile'].map((name) => {
  const match = mainSource.match(new RegExp(`^async function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `${name} not found`);
  return match[0];
}).join('\n');

// Load the actual helpers without starting Electron; inject faults only at the filesystem boundary.
function loadJsonIo(profile, fsImpl = fs) {
  const context = {
    fs: fsImpl, path, randomUUID, process,
    app: { getPath: () => profile },
    currentScanDiagnostics: null,
    CACHE_INDEX_FILE: 'cache-index.json',
    DISTRIBUTED_INDEX_FILE: 'distributed-index.json',
    CONFIG_FILE: 'settings.json',
  };
  vm.createContext(context);
  vm.runInContext(jsonSource, context);
  return context;
}

async function withProfile(operation) {
  const tempRoot = path.resolve(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(tempRoot, 'videocull-json-'));
  try {
    await operation(profile);
  } finally {
    assert.equal(path.dirname(profile), tempRoot);
    assert.ok(path.basename(profile).startsWith('videocull-json-'));
    await fs.rm(profile, { recursive: true, force: true });
  }
}

test('an interrupted JSON write preserves the previous file and removes its partial output', async () => {
  await withProfile(async (profile) => {
    const target = path.join(profile, 'settings.json');
    const previous = '{"saved":"before"}\n';
    await fs.writeFile(target, previous);
    const failure = new Error('disk full during write');
    const io = loadJsonIo(profile, {
      ...fs,
      async writeFile(file) {
        await fs.writeFile(file, '{"interrupted":');
        throw failure;
      },
      async open(file, flags) {
        const handle = await fs.open(file, flags);
        return {
          async writeFile() {
            await handle.writeFile('{"interrupted":');
            throw failure;
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    });

    await assert.rejects(io.writeJsonFile('settings.json', { saved: 'after' }), (error) => error === failure);
    assert.equal(await fs.readFile(target, 'utf8'), previous);
    assert.deepEqual(await fs.readdir(profile), ['settings.json']);
  });
});

for (const stage of ['sync', 'rename']) {
  test(`a JSON ${stage} failure preserves the previous file and cleans up`, async () => {
    await withProfile(async (profile) => {
      const target = path.join(profile, 'cache-index.json');
      const previous = '{"knownFolders":["before"]}';
      await fs.writeFile(target, previous);
      const failure = new Error(`${stage} failed`);
      const io = loadJsonIo(profile, {
        ...fs,
        async open(file, flags) {
          const handle = await fs.open(file, flags);
          return {
            writeFile: (...args) => handle.writeFile(...args),
            async sync() {
              if (stage === 'sync') throw failure;
              await handle.sync();
            },
            close: () => handle.close(),
          };
        },
        async rename(...args) {
          if (stage === 'rename') throw failure;
          await fs.rename(...args);
        },
      });

      await assert.rejects(io.writeJsonFile('cache-index.json', { knownFolders: ['after'] }), (error) => error === failure);
      assert.equal(await fs.readFile(target, 'utf8'), previous);
      assert.deepEqual(await fs.readdir(profile), ['cache-index.json']);
    });
  });
}

test('JSON publication keeps the old file readable until its replacement has been flushed and closed', async () => {
  await withProfile(async (profile) => {
    const target = path.join(profile, 'settings.json');
    const previous = '{"saved":"before"}';
    await fs.writeFile(target, previous);
    let flushed = false;
    let closed = false;
    const io = loadJsonIo(profile, {
      ...fs,
      async open(file, flags) {
        assert.equal(path.dirname(file), profile);
        assert.notEqual(file, target);
        assert.equal(flags, 'wx');
        const handle = await fs.open(file, flags);
        return {
          writeFile: (...args) => handle.writeFile(...args),
          async sync() { await handle.sync(); flushed = true; },
          async close() { await handle.close(); closed = true; },
        };
      },
      async rename(from, to) {
        assert.equal(flushed && closed, true);
        assert.equal(to, target);
        assert.equal(await fs.readFile(target, 'utf8'), previous);
        assert.equal(JSON.parse(await fs.readFile(from, 'utf8')).saved, 'after');
        await fs.rename(from, to);
      },
    });

    await io.writeJsonFile('settings.json', { saved: 'after' });
    assert.equal((await io.readJsonFile('settings.json', null)).saved, 'after');
    assert.deepEqual(await fs.readdir(profile), ['settings.json']);
  });
});

test('overlapping JSON saves publish complete documents without temporary-file collisions', async () => {
  await withProfile(async (profile) => {
    const io = loadJsonIo(profile);
    const first = { saved: 'first', payload: 'a'.repeat(32_000) };
    const second = { saved: 'second', payload: 'b'.repeat(32_000) };
    await Promise.all([
      io.writeJsonFile('settings.json', first),
      io.writeJsonFile('settings.json', second),
    ]);
    const result = await io.readJsonFile('settings.json', null);
    assert.ok(JSON.stringify(result) === JSON.stringify(first) || JSON.stringify(result) === JSON.stringify(second));
    assert.deepEqual(await fs.readdir(profile), ['settings.json']);
  });
});

test('JSON serialization failures leave the previous file alone', async () => {
  await withProfile(async (profile) => {
    const target = path.join(profile, 'settings.json');
    await fs.writeFile(target, '{"saved":"before"}');
    const io = loadJsonIo(profile);
    const circular = {};
    circular.self = circular;

    await assert.rejects(io.writeJsonFile('settings.json', circular), /circular/i);
    assert.equal((await io.readJsonFile('settings.json', null)).saved, 'before');
    assert.deepEqual(await fs.readdir(profile), ['settings.json']);
  });
});

test('missing and malformed JSON still return the supplied fallback', async () => {
  await withProfile(async (profile) => {
    const io = loadJsonIo(profile);
    const fallback = { saved: 'fallback' };
    assert.equal(await io.readJsonFile('missing.json', fallback), fallback);
    await fs.writeFile(path.join(profile, 'settings.json'), '{');
    assert.equal(await io.readJsonFile('settings.json', fallback), fallback);
  });
});

test('save-config reports a failed save without destroying the previous settings', async () => {
  await withProfile(async (profile) => {
    const target = path.join(profile, 'settings.json');
    const previous = '{"theme":"dark"}';
    await fs.writeFile(target, previous);
    const failure = new Error('settings publication failed');
    const io = loadJsonIo(profile, {
      ...fs,
      async writeFile(file) {
        await fs.writeFile(file, '{"interrupted":');
        throw failure;
      },
      async rename() { throw failure; },
    });
    let saveConfig;
    const logged = [];
    Object.assign(io, {
      ipcMain: { handle: (_channel, handler) => { saveConfig = handler; } },
      normalizeColorTheme: require('../../electron/theme-utils').normalizeColorTheme,
      log: { error: (_message, error) => { logged.push(error); } },
    });
    const handlerSource = mainSource.match(/^ipcMain.handle\('save-config'[\s\S]*?^\}\);/m);
    assert.ok(handlerSource);
    vm.runInContext(handlerSource[0], io);

    assert.equal(await saveConfig({}, { theme: 'light' }), false);
    assert.deepEqual(logged, [failure]);
    assert.equal(await fs.readFile(target, 'utf8'), previous);
    assert.deepEqual(await fs.readdir(profile), ['settings.json']);
  });
});
