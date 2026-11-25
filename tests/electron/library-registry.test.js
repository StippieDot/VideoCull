const assert = require('node:assert/strict');
const path = require('node:path');
const { createLibraryRegistry } = require('../../electron/library-registry');

const root = path.resolve('/lib/a');
const other = path.resolve('/lib/b');
const video = (dir, name, id) => ({ path: path.join(dir, name), id, fileIdentity: { size: id.length } });

test('recordScanned remembers ids, identities and link targets', () => {
  const registry = createLibraryRegistry();
  const linked = video(root, 'x.mp4', 'id1');
  const real = path.resolve('/elsewhere/x.mp4');
  const kept = registry.recordScanned([linked], new Map([[linked.path, real]]));
  assert.deepEqual(kept, [linked]);
  assert.equal(registry.isKnownPath(linked.path), true);
  assert.equal(registry.idFor(linked.path), 'id1');
  assert.deepEqual(registry.identityFor(linked.path), linked.fileIdentity);
  assert.equal(registry.scannedRealPathFor(linked.path), real);
});

test('a file reached by two paths is listed once', () => {
  const registry = createLibraryRegistry();
  const real = path.resolve('/elsewhere/x.mp4');
  const first = video(root, 'x.mp4', 'id1');
  const second = video(other, 'x.mp4', 'id2');
  registry.recordScanned([first], new Map([[first.path, real]]));
  assert.deepEqual(registry.recordScanned([second], new Map([[second.path, real]])), []);
  assert.equal(registry.isKnownPath(second.path), false);
});

test('forget releases the real path so another path can own it', () => {
  const registry = createLibraryRegistry();
  const real = path.resolve('/elsewhere/x.mp4');
  const first = video(root, 'x.mp4', 'id1');
  const second = video(other, 'x.mp4', 'id2');
  registry.recordScanned([first], new Map([[first.path, real]]));
  registry.forget(first.path);
  assert.equal(registry.idFor(first.path), undefined);
  assert.equal(registry.scannedRealPathFor(first.path), undefined);
  assert.equal(registry.recordScanned([second], new Map([[second.path, real]])).length, 1);
});

test('removeRoot drops that folder and its videos only', () => {
  const registry = createLibraryRegistry();
  const a = video(root, 'a.mp4', 'ida');
  const nested = video(path.join(root, 'sub'), 'n.mp4', 'idn');
  const b = video(other, 'b.mp4', 'idb');
  registry.addRoot(root);
  registry.addRoot(other);
  registry.recordScanned([a, nested, b], new Map());
  registry.removeRoot(root);
  assert.equal(registry.isLoadedRoot(root), false);
  assert.equal(registry.isKnownPath(a.path), false);
  assert.equal(registry.isKnownPath(nested.path), false);
  assert.equal(registry.isKnownPath(b.path), true);
  assert.equal(registry.rootCount(), 1);
});

test('loadedRoots is a copy and reset clears everything', () => {
  const registry = createLibraryRegistry();
  registry.addRoot(root);
  registry.recordFollowedLinks([{ link: 'l', target: 't' }]);
  registry.recordScanned([video(root, 'a.mp4', 'ida')], new Map());
  registry.loadedRoots().add('hacked');
  assert.equal(registry.rootCount(), 1);
  assert.equal(registry.hasFollowedLinks(), true);
  registry.reset();
  assert.equal(registry.rootCount(), 0);
  assert.equal(registry.knownPathCount(), 0);
  assert.equal(registry.hasFollowedLinks(), false);
});
