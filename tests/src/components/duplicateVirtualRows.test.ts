import {
  buildDuplicateGalleryRows,
  buildDuplicateRowsRows,
  computeDuplicateGalleryLayout,
  DUPLICATE_GALLERY_ROW_HEIGHT,
  DUPLICATE_GROUP_GAP,
  DUPLICATE_GROUP_HEADER_HEIGHT,
  DUPLICATE_VIDEO_ROW_HEIGHT,
  getDuplicateVirtualRowHeight,
  type DuplicateVirtualizableGroup,
} from '../../../src/components/duplicateVirtualRows';

const groupViews: DuplicateVirtualizableGroup[] = [
  {
    group: { id: 'group-a', videoIds: ['a1', 'a2', 'a3'] },
    videos: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
  },
  {
    group: { id: 'group-b', videoIds: ['b1', 'b2'] },
    videos: [{ id: 'b1' }, { id: 'b2' }],
  },
];

test('rows mode preserves group and member order', () => {
  const rows = buildDuplicateRowsRows(groupViews);

  expect(rows.map((row) => row.key)).toEqual([
    'group-a:header',
    'group-a:video:a1',
    'group-a:video:a2',
    'group-a:video:a3',
    'group-b:header',
    'group-b:video:b1',
    'group-b:video:b2',
  ]);
  expect(rows.filter((row) => row.type === 'group-header')).toHaveLength(2);
  expect(rows.filter((row) => row.type === 'video-row')).toHaveLength(5);
  expect(rows[3]?.isLastInGroup).toBe(true);
  expect(rows[6]?.isLastInGroup).toBe(true);
});

test('gallery mode packs card rows by computed column count', () => {
  const layout = computeDuplicateGalleryLayout(720);
  const rows = buildDuplicateGalleryRows(groupViews, layout);

  expect(layout.columnCount).toBe(2);
  expect(rows.map((row) => row.key)).toEqual([
    'group-a:header',
    'group-a:gallery:0',
    'group-a:gallery:2',
    'group-b:header',
    'group-b:gallery:0',
  ]);
  expect(rows[1]).toMatchObject({ type: 'gallery-card-row', videoIds: ['a1', 'a2'] });
  expect(rows[2]).toMatchObject({ type: 'gallery-card-row', videoIds: ['a3'] });
  expect(rows[4]).toMatchObject({ type: 'gallery-card-row', videoIds: ['b1', 'b2'] });
});

test('gallery mode creates multiple rows for larger groups', () => {
  const layout = computeDuplicateGalleryLayout(460);
  const rows = buildDuplicateGalleryRows(groupViews, layout);
  const galleryRows = rows.filter((row) => row.type === 'gallery-card-row');

  expect(layout.columnCount).toBe(1);
  expect(galleryRows).toHaveLength(5);
  expect(galleryRows.map((row) => row.videoIds[0])).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
});

test('virtual row heights stay deterministic by row type', () => {
  const rows = buildDuplicateRowsRows(groupViews);
  const firstHeaderHeight = getDuplicateVirtualRowHeight(rows[0]!);
  const laterHeaderHeight = getDuplicateVirtualRowHeight(rows[4]!);
  const videoHeight = getDuplicateVirtualRowHeight(rows[1]!);
  const galleryHeight = getDuplicateVirtualRowHeight(
    buildDuplicateGalleryRows(groupViews, computeDuplicateGalleryLayout(720))[1]!
  );

  expect(firstHeaderHeight).toBe(DUPLICATE_GROUP_HEADER_HEIGHT);
  expect(laterHeaderHeight).toBe(DUPLICATE_GROUP_HEADER_HEIGHT + DUPLICATE_GROUP_GAP);
  expect(videoHeight).toBe(DUPLICATE_VIDEO_ROW_HEIGHT);
  expect(galleryHeight).toBe(DUPLICATE_GALLERY_ROW_HEIGHT);
});
