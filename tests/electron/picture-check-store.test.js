const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPictureCheckStore, pictureCheckKey } = require('../../electron/picture-check-store');

describe('picture check store', () => {
  let rootDir;
  const writeJsonFile = async (name, data, root) => fs.promises.writeFile(path.join(root, name), JSON.stringify(data));
  const file = () => path.join(rootDir, 'partial-clip-picture-checks.json');
  const key = pictureCheckKey({ id: 'a', date: 1 }, { id: 'b', date: 2 }, { startShort: 1, startOther: 2.5, lengthSecs: 30 }, false);

  beforeEach(() => { rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picture-check-store-')); });
  afterEach(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  test('a saved verdict is read back by a new store and gone after clear', async () => {
    const store = createPictureCheckStore({ rootDir, writeJsonFile });
    await store.load();
    store.set(key, { state: 'confirmed', pictureSimilarity: 96.5, checks: 3 });
    await store.save();
    const next = createPictureCheckStore({ rootDir, writeJsonFile });
    await next.load();
    expect(next.get(key)).toEqual({ state: 'confirmed', pictureSimilarity: 96.5 });
    await next.clear();
    expect(fs.existsSync(file())).toBe(false);
  });

  test('a broken file, another format version and invalid entries are ignored', async () => {
    const errors = [];
    fs.writeFileSync(file(), '{ broken');
    const broken = createPictureCheckStore({ rootDir, writeJsonFile, onError: (error) => errors.push(error) });
    await broken.load();
    expect(broken.get(key)).toBeNull();
    expect(errors).toHaveLength(1);

    fs.writeFileSync(file(), JSON.stringify({ version: 1, entries: [[key, 'maybe', 50], ['other', 'confirmed', 'high']] }));
    const invalid = createPictureCheckStore({ rootDir, writeJsonFile });
    await invalid.load();
    expect(invalid.get(key)).toBeNull();
    expect(invalid.get('other')).toBeNull();

    fs.writeFileSync(file(), JSON.stringify({ version: 0, entries: [[key, 'confirmed', 99]] }));
    const old = createPictureCheckStore({ rootDir, writeJsonFile });
    await old.load();
    expect(old.get(key)).toBeNull();
  });

  test('a failed write is reported and tried again at the next save', async () => {
    const errors = [];
    let fail = true;
    const store = createPictureCheckStore({
      rootDir,
      writeJsonFile: async (...args) => {
        if (fail) throw new Error('disk full');
        return writeJsonFile(...args);
      },
      onError: (error) => errors.push(error.message),
    });
    await store.load();
    store.set(key, { state: 'differentPicture', pictureSimilarity: 41 });
    await store.save();
    expect(errors).toEqual(['disk full']);
    fail = false;
    await store.save();
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).entries).toEqual([[key, 'differentPicture', 41]]);
  });
});
