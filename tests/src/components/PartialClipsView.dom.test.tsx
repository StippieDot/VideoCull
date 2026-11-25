// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PartialClipsView, { describePartialClip, filterAndSortPartialClips, matchedSeconds, mergeClipsByDuplicateGroup } from '../../../src/components/PartialClipsView';
import useStore from '../../../src/store';
import type { PartialClip } from '../../../src/types';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';

const SOURCE = '00000000000000aa';
const CLIP = '00000000000000bb';
const OTHER = '00000000000000cc';

function clip(overrides: Partial<PartialClip> = {}): PartialClip {
  return {
    aId: SOURCE,
    bId: CLIP,
    relation: 'partial',
    state: 'confirmed',
    shorterId: CLIP,
    segments: [{ startA: 30, startB: 0, lengthSecs: 20, soundSimilarity: 96, pictureState: 'confirmed', pictureSimilarity: 99 }],
    coverage: 0.5,
    soundSimilarity: 96,
    pictureSimilarity: 99,
    ...overrides,
  };
}

describe('partial clips list', () => {
  beforeEach(() => {
    Object.assign(window, { electronAPI: { saveConfig: vi.fn().mockResolvedValue(true), saveSettings: vi.fn().mockResolvedValue(true) } });
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600 }),
        makeVideo(CLIP, { filename: 'highlight.mp4', durationSecs: 40 }),
        makeVideo(OTHER, { filename: 'remix.mp4', durationSecs: 600 }),
      ],
    });
  });

  test('says what each video contains, collapses shared sound with other pictures, and dismisses a pair', async () => {
    useStore.setState({
      partialClips: [
        clip(),
        clip({ bId: OTHER, shorterId: OTHER, relation: 'audioOnly', state: 'differentPicture', pictureSimilarity: 52, coverage: 1 }),
        clip({ coverage: 0.95, aId: OTHER, bId: CLIP, segments: [{ ...clip().segments[0]!, lengthSecs: 38 }] }),
      ],
    });
    render(<PartialClipsView />);

    expect(screen.getByText('Contains 0:20 of the longer video, 0:30 to 0:50')).toBeTruthy();
    // The time bar runs from the start to the end of the longer video.
    expect(screen.getAllByText('10:00').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('0:30 to 0:50').length).toBeGreaterThan(0);
    expect(screen.getByText('Excerpt of the longer video')).toBeTruthy();
    expect(screen.getByText('1 pair with the same sound and a different picture')).toBeTruthy();
    expect(screen.getByText('Same sound, different picture')).toBeTruthy();

    const card = screen.getByText('Contains 0:20 of the longer video, 0:30 to 0:50').closest('article')!;
    await userEvent.click(within(card).getByRole('button', { name: 'Not a match' }));
    expect(useStore.getState().partialClips).toHaveLength(2);
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).toContain(`${SOURCE}|${CLIP}`);

    // Undo brings the entry back at its place.
    useStore.getState().toasts[useStore.getState().toasts.length - 1]?.action?.();
    expect(useStore.getState().partialClips?.map((entry) => `${entry.aId}|${entry.bId}`)).toEqual([`${SOURCE}|${CLIP}`, `${SOURCE}|${OTHER}`, `${OTHER}|${CLIP}`]);
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).not.toContain(`${SOURCE}|${CLIP}`);
  });

  test('a full match between videos of the same length is described as the same video', () => {
    const concert = makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600 });
    const reencode = makeVideo(OTHER, { filename: 'concert-reencode.mp4', durationSecs: 598 });
    const whole = [{ startA: 0, startB: 0, lengthSecs: 598, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    expect(describePartialClip(clip({ bId: OTHER, shorterId: OTHER, coverage: 1, segments: whole }), reencode, concert))
      .toBe('Same video');
  });

  test('two copies of the same video show which has the better picture; other pairs mark nothing', () => {
    const whole = [{ startA: 0, startB: 0, lengthSecs: 598, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600, width: 1920, height: 1080 }),
        makeVideo(OTHER, { filename: 'concert-small.mp4', durationSecs: 598, width: 640, height: 360 }),
        makeVideo(CLIP, { filename: 'highlight.mp4', durationSecs: 40 }),
      ],
      partialClips: [clip({ bId: OTHER, shorterId: OTHER, segments: whole }), clip()],
    });
    const { container } = render(<PartialClipsView />);
    const [sameVideo, excerpt] = [...container.querySelectorAll('article')];
    expect(within(sameVideo!).getByText('Same video')).toBeTruthy();
    expect(within(sameVideo!).getByText('1080p').className).toContain('best');
    expect(within(sameVideo!).getByText('360p').className).toContain('worse');
    expect(excerpt!.querySelectorAll('.meta-chip.best, .meta-chip.worse')).toHaveLength(0);
  });

  test('keeps one copy of the same video and marks the other, and warns when both are kept', async () => {
    const whole = [{ startA: 0, startB: 0, lengthSecs: 598, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600, status: 'keep' }),
        makeVideo(OTHER, { filename: 'concert-small.mp4', durationSecs: 598, status: 'keep' }),
      ],
      partialClips: [clip({ bId: OTHER, shorterId: OTHER, segments: whole })],
    });
    render(<PartialClipsView />);
    expect(screen.getByText('Both copies are marked keep.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep concert.mp4, delete the other copy' }));
    const status = (id: string) => useStore.getState().videos.find((video) => video.id === id)?.status;
    expect([status(SOURCE), status(OTHER)]).toEqual(['keep', 'delete']);
    expect(screen.queryByText('Both copies are marked keep.')).toBeNull();
  });

  test('an excerpt offers no keep-one action', () => {
    useStore.setState({ partialClips: [clip()] });
    render(<PartialClipsView />);
    expect(screen.queryByRole('button', { name: /delete the other copy/ })).toBeNull();
  });

  test('a copy split into parts is the same video, and only matching pictures count toward the shared length', () => {
    const concert = makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600 });
    const recut = makeVideo(OTHER, { filename: 'concert-recut.mp4', durationSecs: 590 });
    const segment = (startA: number, startB: number, lengthSecs: number, pictureState: 'confirmed' | 'differentPicture') => (
      { startA, startB, lengthSecs, soundSimilarity: 96, pictureState, pictureSimilarity: 90 }
    );
    const recutClip = clip({ bId: OTHER, shorterId: OTHER, segments: [segment(0, 0, 300, 'confirmed'), segment(310, 300, 290, 'confirmed'), segment(400, 20, 15, 'differentPicture')] });
    expect(describePartialClip(recutClip, recut, concert)).toBe('Same video');
    expect(matchedSeconds(recutClip)).toBe(590);

    // Many sound-only stretches do not lift a pair above one with more matching picture.
    const noisy = clip({ segments: [segment(30, 0, 20, 'confirmed'), ...Array.from({ length: 40 }, (_, i) => segment(100 + i * 12, 0, 10, 'differentPicture'))] });
    const videosById = new Map([concert, recut, makeVideo(CLIP, { durationSecs: 40 })].map((video) => [video.id, video]));
    const sorted = filterAndSortPartialClips([{ primary: noisy, others: [] }, { primary: recutClip, others: [] }], { pathFilter: '', sortBy: 'sharedLength', sortOrder: 'desc' }, videosById);
    expect(sorted.map((entry) => entry.primary)).toEqual([recutClip, noisy]);
  });

  test('one clip found in several copies of a video is one entry, and Not a match covers them all', async () => {
    const COPY = '00000000000000dd';
    useStore.setState({
      videos: [...useStore.getState().videos, makeVideo(COPY, { filename: 'concert-copy.mp4', durationSecs: 600 })],
      duplicateGroups: [makeDuplicateGroup({ id: 'g', videoIds: [SOURCE, COPY], suggestedKeeperId: SOURCE })],
      partialClips: [clip({ aId: COPY }), clip()],
    });
    render(<PartialClipsView />);
    // The keeper's pair leads; the copy is listed under it.
    expect(screen.getByText('Contains 0:20 of the longer video, 0:30 to 0:50')).toBeTruthy();
    expect(screen.getByText('Also found in 1 other copy of these videos')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Not a match' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Not a match' }));
    expect(useStore.getState().partialClips).toEqual([]);
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).toEqual(expect.arrayContaining([`${SOURCE}|${CLIP}`, `${CLIP}|${COPY}`]));
  });

  test('pairs are merged only when both sides share their duplicate groups', () => {
    const groups = [makeDuplicateGroup({ id: 'g', videoIds: ['a', 'a2'], suggestedKeeperId: 'a2' })];
    const pair = (aId: string, bId: string, state: PartialClip['state'] = 'confirmed') => clip({ aId, bId, shorterId: bId, state });
    const entries = mergeClipsByDuplicateGroup([pair('a', 'x'), pair('a2', 'x'), pair('a', 'y'), pair('b', 'x', 'unconfirmed')], groups);
    expect(entries.map((entry) => [entry.primary.aId, entry.primary.bId, entry.others.length])).toEqual([
      ['a2', 'x', 1],
      ['a', 'y', 0],
      ['b', 'x', 0],
    ]);
  });

  test('marks a video from its row', async () => {
    useStore.setState({ partialClips: [clip()] });
    render(<PartialClipsView />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark delete: highlight.mp4' }));
    expect(useStore.getState().videos.find((video) => video.id === CLIP)?.status).toBe('delete');
  });

  test('a stretch from the start of the longer video starts at 0:00', () => {
    const segment = { startA: 0, startB: 0, lengthSecs: 32, soundSimilarity: 99, pictureState: 'differentPicture' as const, pictureSimilarity: 48 };
    useStore.setState({ partialClips: [clip({ relation: 'audioOnly', state: 'differentPicture', segments: [segment] })] });
    render(<PartialClipsView />);
    expect(screen.getByTitle('0:00 to 0:32')).toBeTruthy();
  });

  test('a row offers the video menu without group actions, and shows its mark', async () => {
    useStore.setState({ partialClips: [clip()] });
    render(<PartialClipsView />);
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText('highlight.mp4') });
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Play', 'Mark Delete', 'Mark Keep', 'Copy full path']));
    expect(labels).not.toContain('Exclude from this group');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark Keep' }));
    expect(useStore.getState().videos.find((video) => video.id === CLIP)?.status).toBe('keep');
    expect(screen.getByText('Marked keep')).toBeTruthy();
  });

  test('the path filter matches any copy in an entry, and entries sort by the chosen field', () => {
    const videosById = new Map(useStore.getState().videos.map((video) => [video.id, { ...video, path: `D:\\${video.filename}` }]));
    const short = { primary: clip({ coverage: 0.9 }), others: [] };
    const long = { primary: clip({ aId: OTHER, coverage: 0.2, segments: [{ ...clip().segments[0]!, lengthSecs: 90 }] }), others: [clip()] };
    const sorted = (pathFilter: string, sortBy: 'sharedLength' | 'coverage', sortOrder: 'asc' | 'desc' = 'desc') =>
      filterAndSortPartialClips([short, long], { pathFilter, sortBy, sortOrder }, videosById);
    expect(sorted('', 'sharedLength')).toEqual([long, short]);
    expect(sorted('', 'coverage')).toEqual([short, long]);
    expect(sorted('', 'coverage', 'asc')).toEqual([long, short]);
    // remix.mp4 is only in the second entry; concert.mp4 is in both, once as another copy.
    expect(sorted('remix', 'sharedLength')).toEqual([long]);
    expect(sorted('CONCERT', 'sharedLength')).toEqual([long, short]);
  });

  test('reports its first entry to the title bar and opens a collapsed entry it is sent to', () => {
    useStore.setState({
      partialClips: [clip(), clip({ bId: OTHER, shorterId: OTHER, relation: 'audioOnly', state: 'differentPicture' })],
    });
    const { container, unmount } = render(<PartialClipsView />);
    expect(useStore.getState().duplicatePosition).toEqual({ group: 0, total: 2 });
    act(() => useStore.getState().requestDuplicateGroupJump(1));
    expect(container.querySelector('details.partial-clips-collapsed')?.hasAttribute('open')).toBe(true);
    unmount();
    expect(useStore.getState().duplicatePosition).toBeNull();
  });

  test('an empty result says so', () => {
    useStore.setState({ partialClips: [] });
    render(<PartialClipsView />);
    expect(screen.getByText('No video contains part of another.')).toBeTruthy();
  });
});
