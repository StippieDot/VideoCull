import {
  buildCopyPathSuccessDetail,
  canPlayDuplicateGroupKeeper,
  normalizePath,
} from '../../../src/components/contextMenuBuilders';
import type { DuplicateGroup, Video } from '../../../src/types';

function makeVideo(id: string): Video {
  return {
    id,
    filename: `${id}.mp4`,
    path: `C:\\clips\\${id}.mp4`,
    sizeBytes: 1,
    date: 0,
    durationSecs: null,
    duplicateHash: null,
    status: 'pending',
    thumbnails: [],
    rating: 0,
    favorite: false,
    compatible: true,
    videoCodec: null,
    audioCodec: null,
    containerFormat: null,
    width: null,
    height: null,
    fps: null,
  };
}

test('normalizePath folds slashes and casing for path identity checks', () => {
  expect(normalizePath('F:/Videos//Trips\\clip.mp4')).toBe('f:\\videos\\trips\\clip.mp4');
});

test('buildCopyPathSuccessDetail truncates long paths but preserves short ones', () => {
  expect(buildCopyPathSuccessDetail('  C:\\clips\\a.mp4  ')).toBe('Copied C:\\clips\\a.mp4');
  expect(buildCopyPathSuccessDetail(`C:\\${'x'.repeat(100)}`)).toMatch(/^Copied .*\.\.\.$/);
});

test('canPlayDuplicateGroupKeeper only allows resolved keeper videos', () => {
  const group = {
    id: 'g1',
    videoIds: ['a', 'b'],
    similarity: 99,
    matchType: 'mixed',
    suggestedKeeperId: 'a',
    reason: 'Likely duplicate',
  } satisfies DuplicateGroup;

  expect(canPlayDuplicateGroupKeeper(group, new Map([['a', makeVideo('a')]]))).toBe(true);
  expect(canPlayDuplicateGroupKeeper(group, new Map())).toBe(false);
  expect(canPlayDuplicateGroupKeeper({ ...group, suggestedKeeperId: null }, new Map([['a', makeVideo('a')]]))).toBe(false);
});
