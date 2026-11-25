import { selectShortVideosForDelete, type ShortVideoSelection } from '../../src/short-videos';
import type { Video } from '../../src/types';
import { makeVideo } from '../helpers/videoFactory';

const short = (id: string, extra: Parameters<typeof makeVideo>[1] = {}) =>
  makeVideo(id, { durationSecs: 4, sizeBytes: 1000, status: 'pending', rating: 0, favorite: false, ...extra });

describe('selectShortVideosForDelete', () => {
  test('selects pending videos shorter than the threshold and adds up their size', () => {
    const result = selectShortVideosForDelete([short('a'), short('b', { sizeBytes: 500 }), short('long', { durationSecs: 60 })], 10);
    expect(result.eligible.map((video) => video.id)).toEqual(['a', 'b']);
    expect(result.eligibleBytes).toBe(1500);
  });

  test('the threshold itself is not short', () => {
    expect(selectShortVideosForDelete([short('edge', { durationSecs: 10 })], 10).eligible).toEqual([]);
    expect(selectShortVideosForDelete([short('edge', { durationSecs: 9.99 })], 10).eligible).toHaveLength(1);
  });

  const protectedCases: Array<[string, Partial<Video>, keyof ShortVideoSelection['protectedCounts']]> = [
    ['delete', { status: 'delete' }, 'alreadyDelete'],
    ['keep', { status: 'keep' }, 'keep'],
    ['skipped', { status: 'skipped' }, 'skipped'],
    ['rated', { rating: 3 }, 'rated'],
    ['favorite', { favorite: true }, 'favorite'],
    ['bookmarked', { bookmarks: [1.5] }, 'bookmarked'],
  ];
  test.each(protectedCases)('a %s video is left alone and counted', (_name, extra, counter) => {
    const result = selectShortVideosForDelete([short('p', extra)], 10);
    expect(result.eligible).toEqual([]);
    expect(result.protectedCounts[counter]).toBe(1);
  });

  test('a video with several protections is counted once, under the first that applies', () => {
    const result = selectShortVideosForDelete([short('p', { status: 'keep', rating: 5, favorite: true, bookmarks: [1] })], 10);
    expect(result.protectedCounts).toEqual({ alreadyDelete: 0, keep: 1, skipped: 0, rated: 0, favorite: 0, bookmarked: 0 });
  });

  test('a video with an empty bookmark list is not protected', () => {
    expect(selectShortVideosForDelete([short('p', { bookmarks: [] })], 10).eligible).toHaveLength(1);
  });

  test.each([null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY])('a duration of %s is unknown and never marked', (durationSecs) => {
    const result = selectShortVideosForDelete([short('u', { durationSecs })], 10);
    expect(result.eligible).toEqual([]);
    expect(result.unknownDuration).toBe(1);
  });

  test.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('a threshold of %s selects nothing', (threshold) => {
    const result = selectShortVideosForDelete([short('a'), short('u', { durationSecs: null })], threshold);
    expect(result.eligible).toEqual([]);
    expect(result.unknownDuration).toBe(0);
  });

  test('does not change the videos it is given', () => {
    const videos = [short('a')];
    const copy = structuredClone(videos);
    selectShortVideosForDelete(videos, 10);
    expect(videos).toEqual(copy);
  });
});
