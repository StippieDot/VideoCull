import type { DuplicateGroup, Video } from '../../src/types';

export function makeVideo(
  id: string,
  overrides: Partial<Video> = {},
  rootDir = 'D:\\Media',
): Video {
  return {
    id,
    filename: `${id}.mp4`,
    path: `${rootDir}\\${id}.mp4`,
    sizeBytes: 100,
    date: 0,
    durationSecs: 10,
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
    ...overrides,
  };
}

export function makeDuplicateGroup(overrides: Partial<DuplicateGroup> = {}): DuplicateGroup {
  return {
    id: 'group-1',
    videoIds: ['a', 'b'],
    similarity: 98,
    matchType: 'visual',
    suggestedKeeperId: 'a',
    reason: 'Likely duplicate',
    ...overrides,
  };
}
