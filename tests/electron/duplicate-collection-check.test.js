const assert = require('node:assert/strict');
const { compareWithManifest, diffSnapshots } = require('../../scripts/duplicate-collection-check');

const manifest = {
  files: [
    { file: 'a.mp4', seed: 'a', expect: 'exact' },
    { file: 'a__small.mp4', seed: 'a', expect: 'sameSpan' },
    { file: 'a__bars.mp4', seed: 'a', expect: 'sameSpan' },
    { file: 'a__clip.mp4', seed: 'a', expect: 'partial' },
    { file: 'b.mp4', seed: 'b', expect: 'exact' },
  ],
  negatives: [{ a: 'a.mp4', b: 'b.mp4', why: 'unrelated' }],
  measuredOnly: [{ a: 'a__small.mp4', b: 'b.mp4', why: 'hard case' }],
};

function grouping(...groups) {
  const byFile = new Map();
  for (const group of groups) for (const file of group.files) byFile.set(file, group);
  return (file) => byFile.get(file);
}

test('a manifest comparison counts found, missed, wrong and correctly separate pairs', () => {
  const { rows, summary } = compareWithManifest(manifest, grouping(
    { similarity: 98, files: ['a.mp4', 'a__small.mp4', 'a__clip.mp4'] },
  ));

  assert.deepEqual(summary, { found: 1, missed: 1, wrong: 1, correctlyApart: 1 });
  assert.equal(rows.find((row) => row.a === 'a__small.mp4' && row.b === 'a.mp4').similarity, 98);
  // A partial clip grouped as a full duplicate is a wrong result, not a find.
  assert.equal(rows.find((row) => row.a === 'a__clip.mp4').expected, false);
  // Measured-only pairs are reported and never judged.
  assert.equal(rows.find((row) => row.kind === 'measured').expected, null);
});

test('two ungrouped files are not treated as one group', () => {
  const { summary } = compareWithManifest(manifest, () => undefined);

  assert.deepEqual(summary, { found: 0, missed: 2, wrong: 0, correctlyApart: 2 });
});

test('a snapshot comparison lists added and removed groups', () => {
  const before = [{ similarity: 97, files: ['a.mp4', 'b.mp4'] }, { similarity: 99, files: ['c.mp4', 'd.mp4'] }];
  const after = [{ similarity: 99, files: ['c.mp4', 'd.mp4'] }, { similarity: 96, files: ['a.mp4', 'b.mp4', 'e.mp4'] }];

  const { added, removed } = diffSnapshots(before, after);

  assert.deepEqual(added.map((group) => group.files), [['a.mp4', 'b.mp4', 'e.mp4']]);
  assert.deepEqual(removed.map((group) => group.files), [['a.mp4', 'b.mp4']]);
});
