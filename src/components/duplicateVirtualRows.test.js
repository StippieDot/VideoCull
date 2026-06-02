const test = require('node:test');
const assert = require('node:assert/strict');

const loadModule = () => import('./duplicateVirtualRows.ts');

const groupViews = [
  {
    group: { id: 'group-a', videoIds: ['a1', 'a2', 'a3'] },
    videos: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
  },
  {
    group: { id: 'group-b', videoIds: ['b1', 'b2'] },
    videos: [{ id: 'b1' }, { id: 'b2' }],
  },
];

test('rows mode preserves group and member order', async () => {
  const { buildDuplicateRowsRows } = await loadModule();
  const rows = buildDuplicateRowsRows(groupViews);

  assert.deepEqual(
    rows.map((row) => row.key),
    [
      'group-a:header',
      'group-a:video:a1',
      'group-a:video:a2',
      'group-a:video:a3',
      'group-b:header',
      'group-b:video:b1',
      'group-b:video:b2',
    ]
  );
  assert.equal(rows.filter((row) => row.type === 'group-header').length, 2);
  assert.equal(rows.filter((row) => row.type === 'video-row').length, 5);
  assert.equal(rows[3].isLastInGroup, true);
  assert.equal(rows[6].isLastInGroup, true);
});

test('gallery mode packs card rows by computed column count', async () => {
  const { buildDuplicateGalleryRows, computeDuplicateGalleryLayout } = await loadModule();
  const layout = computeDuplicateGalleryLayout(720);
  const rows = buildDuplicateGalleryRows(groupViews, layout);

  assert.equal(layout.columnCount, 3);
  assert.deepEqual(
    rows.map((row) => row.key),
    [
      'group-a:header',
      'group-a:gallery:0',
      'group-b:header',
      'group-b:gallery:0',
    ]
  );
  assert.deepEqual(rows[1].videoIds, ['a1', 'a2', 'a3']);
  assert.deepEqual(rows[3].videoIds, ['b1', 'b2']);
});

test('gallery mode creates multiple rows for larger groups', async () => {
  const { buildDuplicateGalleryRows, computeDuplicateGalleryLayout } = await loadModule();
  const layout = computeDuplicateGalleryLayout(460);
  const rows = buildDuplicateGalleryRows(groupViews, layout);
  const galleryRows = rows.filter((row) => row.type === 'gallery-card-row');

  assert.equal(layout.columnCount, 1);
  assert.equal(galleryRows.length, 5);
  assert.deepEqual(
    galleryRows.map((row) => row.videoIds[0]),
    ['a1', 'a2', 'a3', 'b1', 'b2']
  );
});

test('virtual row heights stay deterministic by row type', async () => {
  const {
    buildDuplicateGalleryRows,
    buildDuplicateRowsRows,
    computeDuplicateGalleryLayout,
    getDuplicateVirtualRowHeight,
    DUPLICATE_GALLERY_ROW_HEIGHT,
    DUPLICATE_GROUP_GAP,
    DUPLICATE_GROUP_HEADER_HEIGHT,
    DUPLICATE_VIDEO_ROW_HEIGHT,
  } = await loadModule();

  const rows = buildDuplicateRowsRows(groupViews);
  const firstHeaderHeight = getDuplicateVirtualRowHeight(rows[0]);
  const laterHeaderHeight = getDuplicateVirtualRowHeight(rows[4]);
  const videoHeight = getDuplicateVirtualRowHeight(rows[1]);
  const galleryHeight = getDuplicateVirtualRowHeight(
    buildDuplicateGalleryRows(groupViews, computeDuplicateGalleryLayout(720))[1]
  );

  assert.equal(firstHeaderHeight, DUPLICATE_GROUP_HEADER_HEIGHT);
  assert.equal(laterHeaderHeight, DUPLICATE_GROUP_HEADER_HEIGHT + DUPLICATE_GROUP_GAP);
  assert.equal(videoHeight, DUPLICATE_VIDEO_ROW_HEIGHT);
  assert.equal(galleryHeight, DUPLICATE_GALLERY_ROW_HEIGHT);
});
