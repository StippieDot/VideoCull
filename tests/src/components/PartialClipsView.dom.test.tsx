// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { vi } from 'vitest';
import PartialClipsView, { cardFlags, filterAndSortPartialClips, placeOnMaster, laneSpans, matchBadge, matchedSeconds, mergeClipsByDuplicateGroup, type Lane } from '../../../src/components/PartialClipsView';
import useStore from '../../../src/store';
import type { PartialClip } from '../../../src/types';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';

// Every row is drawn: jsdom has no layout for the list to measure.
vi.mock('react-window', () => ({
  List: ({ rowCount, rowComponent: Row, rowProps }: {
    rowCount: number;
    rowComponent: ComponentType<Record<string, unknown>>;
    rowProps: Record<string, unknown>;
  }) => (
    <div>
      {Array.from({ length: rowCount }, (_, index) => <Row key={index} index={index} style={{}} ariaAttributes={{}} {...rowProps} />)}
    </div>
  ),
}));

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

    const card = screen.getAllByText('Shares 0:20')[0]!.closest('article')!;
    // The longer video is the master; the clip sits on its timeline where it matches, with its scores.
    expect(within(card).getByText('Longest')).toBeTruthy();
    // The master's row is the time scale; the clip's bar and times say where it sits on it.
    expect(within(card).getByText('Timeline of the longest video')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Time scale of the longest video, 0:00 to 10:00' })).toBeTruthy();
    expect(within(card).getByTitle('0:30 to 0:50')).toBeTruthy();
    expect(within(card).getByText('0:30 to 0:50')).toBeTruthy();
    expect(within(card).getByTitle('Sound matches 96%')).toBeTruthy();
    expect(within(card).getByTitle('Picture matches 99%')).toBeTruthy();
    expect(screen.getAllByText('Fully inside').length).toBeGreaterThan(0);
    // The pair with another picture is behind a switch below the list.
    expect(screen.queryByText('Same sound, other picture')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '1 pair with the same sound and a different picture' }));
    expect(screen.getByText('Same sound, other picture')).toBeTruthy();

    // Header like a duplicate group: score, size, description; no filter set, so no filter count.
    expect(within(card).getByText('99.0%')).toBeTruthy();
    expect(within(card).getByTitle('1 matching part')).toBeTruthy();
    expect(screen.queryByText(/match the filter/)).toBeNull();
    // A two-video card is dismissed from its header; rows have no Not a match of their own.
    expect(within(card).queryByRole('button', { name: /^Not a match:/ })).toBeNull();
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
    expect(matchBadge(clip({ bId: OTHER, shorterId: OTHER, coverage: 1, segments: whole }), reencode, concert))
      .toEqual({ label: 'Same video', tone: 'exact' });
  });

  test('two copies of the same video show which has the better picture; other pairs mark only resolution', () => {
    const whole = [{ startA: 0, startB: 0, lengthSecs: 598, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600, width: 1920, height: 1080 }),
        makeVideo(OTHER, { filename: 'concert-small.mp4', durationSecs: 598, width: 640, height: 360 }),
        makeVideo(CLIP, { filename: 'highlight.mp4', durationSecs: 40, width: 1280, height: 720 }),
      ],
      partialClips: [clip({ bId: OTHER, shorterId: OTHER, segments: whole }), clip()],
    });
    const { container } = render(<PartialClipsView />);
    const [sameVideo, excerpt] = [...container.querySelectorAll('article')];
    expect(within(sameVideo!).getAllByText('Same video').length).toBeGreaterThan(0);
    expect(within(sameVideo!).getByText('1080p').className).toContain('best');
    expect(within(sameVideo!).getByText('360p').className).toContain('worse');
    // Length and size say nothing between an excerpt and its source; resolution still does.
    expect([...excerpt!.querySelectorAll('.meta-chip.best, .meta-chip.worse')].map((chip) => chip.textContent)).toEqual(['1080p', '720p']);
  });

  test('between an excerpt and its source only a bitrate far apart is marked', () => {
    const lane = (id: string, kbps: number, role: Lane['role']): Lane => ({ video: makeVideo(id, { videoBitrate: kbps * 1000 }), role, segments: [], via: null });
    const bitrates = (lanes: Lane[]) => [...cardFlags(lanes).values()].map((flags) => flags.bitrate);
    expect(bitrates([lane(SOURCE, 1500, 'master'), lane(CLIP, 1400, 'excerpt'), lane(OTHER, 1000, 'excerpt')])).toEqual(['best', 'best', 'worse']);
    expect(bitrates([lane(SOURCE, 1500, 'master'), lane(CLIP, 1200, 'excerpt')])).toEqual(['equal', 'equal']);
  });

  test('rows follow the order their pictures appear in the longest video, not a sound every scene shares', () => {
    const disc = makeVideo(SOURCE, { filename: 'disc.mp4', durationSecs: 3600 });
    const scene1 = makeVideo(CLIP, { filename: 'scene1.mp4', durationSecs: 1200 });
    const scene2 = makeVideo(OTHER, { filename: 'scene2.mp4', durationSecs: 1300 });
    const jingle = (startA: number) => ({ startA, startB: 0, lengthSecs: 5, soundSimilarity: 99, pictureState: 'differentPicture' as const, pictureSimilarity: 40 });
    const scene = (startA: number, lengthSecs: number) => ({ startA, startB: 0, lengthSecs, soundSimilarity: 98, pictureState: 'confirmed' as const, pictureSimilarity: 95 });
    const entries = [
      { primary: clip({ bId: OTHER, shorterId: OTHER, segments: [jingle(0), jingle(1200), scene(1200, 1300)] }), others: [] },
      { primary: clip({ segments: [jingle(0), jingle(1200), scene(0, 1200)] }), others: [] },
    ];
    const byId = new Map([disc, scene1, scene2].map((video) => [video.id, video]));
    expect(placeOnMaster(entries, byId).map((lane) => lane.video.filename)).toEqual(['disc.mp4', 'scene1.mp4', 'scene2.mp4']);
  });

  test('keeps one copy of the same video and marks the other', async () => {
    const whole = [{ startA: 0, startB: 0, lengthSecs: 598, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600, status: 'keep' }),
        makeVideo(OTHER, { filename: 'concert-small.mp4', durationSecs: 598, status: 'keep' }),
      ],
      partialClips: [clip({ bId: OTHER, shorterId: OTHER, segments: whole })],
    });
    render(<PartialClipsView />);
    await userEvent.click(screen.getByRole('button', { name: 'Keep concert.mp4, delete the other copy' }));
    const status = (id: string) => useStore.getState().videos.find((video) => video.id === id)?.status;
    expect([status(SOURCE), status(OTHER)]).toEqual(['keep', 'delete']);
  });

  test('copies and excerpts of one video become one card; a weaker pair stays apart', async () => {
    const COPY = '00000000000000dd';
    const WEAK = '00000000000000ee';
    const whole = (lengthSecs: number) => [{ startA: 0, startB: 0, lengthSecs, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600 }),
        makeVideo(COPY, { filename: 'concert-copy.mp4', durationSecs: 598 }),
        makeVideo(CLIP, { filename: 'highlight.mp4', durationSecs: 40 }),
        makeVideo(WEAK, { filename: 'mashup.mp4', durationSecs: 300 }),
      ],
      partialClips: [
        // The copy starts 2 s into the master.
        clip({ bId: COPY, shorterId: COPY, segments: [{ startA: 2, startB: 0, lengthSecs: 596, soundSimilarity: 97, pictureState: 'confirmed', pictureSimilarity: 98 }] }),
        // The clip is found in the copy only, 100 s in.
        clip({ aId: COPY, segments: [{ startA: 100, startB: 0, lengthSecs: 40, soundSimilarity: 95, pictureState: 'confirmed', pictureSimilarity: 97 }] }),
        // 20 s of a 5-minute video: not a copy or an excerpt, so it does not join the family.
        clip({ aId: COPY, bId: WEAK, shorterId: WEAK }),
      ],
    });
    const { container } = render(<PartialClipsView />);
    expect(container.querySelectorAll('article')).toHaveLength(2);
    const family = screen.getByText('Same footage').closest('article')!;
    expect(within(family).getByText('3 videos')).toBeTruthy();
    // Longest first, each video once, with its part in the family.
    const rows = [...family.querySelectorAll('.partial-clip-video')];
    expect(rows.map((row) => [row.querySelector('strong')?.textContent, row.querySelector('.partial-clip-role')?.textContent]))
      .toEqual([['concert.mp4', 'Longest'], ['concert-copy.mp4', 'Same video'], ['highlight.mp4', 'Fully inside']]);
    // Placed through the copy: 100 s into the copy is 102 s into the master.
    expect(within(rows[2] as HTMLElement).getByTitle('1:42 to 2:22')).toBeTruthy();
    expect(useStore.getState().duplicatePosition?.total).toBe(2);

    // Not a match takes out one pair; the other stays as a card of its own.
    await userEvent.click(within(family).getByRole('button', { name: 'Not a match: highlight.mp4 and concert-copy.mp4' }));
    expect(screen.queryByText('Same footage')).toBeNull();
    expect(screen.getAllByText('Same video').length).toBeGreaterThan(0);
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
    expect(matchBadge(recutClip, recut, concert).label).toBe('Same video');
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
    const { container } = render(<PartialClipsView />);
    // One card: the keeper is the master, its copy and the clip each get a row.
    expect(container.querySelectorAll('article')).toHaveLength(1);
    expect([...container.querySelectorAll('.partial-clip-video strong')].map((name) => name.textContent)).toEqual(['concert.mp4', 'concert-copy.mp4', 'highlight.mp4']);
    // The clip's Not a match also covers the copy's pair, so it does not come back through the copy.
    await userEvent.click(screen.getByRole('button', { name: 'Not a match: highlight.mp4 and concert.mp4' }));
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

  test('a stretch from the start of the longer video starts at 0:00', async () => {
    const segment = { startA: 0, startB: 0, lengthSecs: 32, soundSimilarity: 99, pictureState: 'differentPicture' as const, pictureSimilarity: 48 };
    useStore.setState({ partialClips: [clip({ relation: 'audioOnly', state: 'differentPicture', segments: [segment] })] });
    render(<PartialClipsView />);
    await userEvent.click(screen.getByRole('button', { name: /with the same sound and a different picture/ }));
    expect(screen.getByTitle('0:00 to 0:32')).toBeTruthy();
  });

  test('stretches a few seconds apart on the longest video are drawn and listed as one', () => {
    const lane = (segments: Lane['segments']): Lane => ({ video: makeVideo(CLIP), role: 'excerpt', segments, via: null });
    // 1% of 6000 s is 60 s: a 30 s gap joins, a 200 s gap does not, and a sound-only stretch stays apart.
    expect(laneSpans(lane([
      { start: 1000, end: 2000, state: 'confirmed' },
      { start: 0, end: 500, state: 'confirmed' },
      { start: 530, end: 900, state: 'confirmed' },
      { start: 2010, end: 2100, state: 'unconfirmed' },
      { start: 5900, end: 6500, state: 'confirmed' },
    ]), 6000)).toEqual([
      { start: 0, end: 900, state: 'confirmed' },
      { start: 1000, end: 2000, state: 'confirmed' },
      { start: 2010, end: 2100, state: 'unconfirmed' },
      { start: 5900, end: 6000, state: 'confirmed' },
    ]);
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
    expect(container.querySelector('.partial-clips-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Same sound, other picture')).toBeTruthy();
    unmount();
    expect(useStore.getState().duplicatePosition).toBeNull();
  });

  test('an empty result says so', () => {
    useStore.setState({ partialClips: [] });
    render(<PartialClipsView />);
    expect(screen.getByText('No video contains part of another.')).toBeTruthy();
  });
});
