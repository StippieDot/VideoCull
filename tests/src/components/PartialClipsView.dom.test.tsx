// @vitest-environment jsdom

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { vi } from 'vitest';
import PartialClipsView, { buildClipCards, cardFlags, filterAndSortCards, gapsIn, matchesPathFilter, placeOnMaster, laneSpans, matchBadge, matchedSeconds, mergeClipsByDuplicateGroup, type Lane } from '../../../src/components/PartialClipsView';
import useStore, { DEFAULT_PARTIAL_CLIP_KINDS } from '../../../src/store';
import type { PartialClip } from '../../../src/types';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';
import { DEFAULT_DUPLICATE_SETTINGS } from '../../../src/keybind-defaults';

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

const CARD_OPTIONS = { edgeSecs: 10, keeperOrder: DEFAULT_DUPLICATE_SETTINGS.keeperOrder, codecOrder: DEFAULT_DUPLICATE_SETTINGS.codecOrder };
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
      partialClipKinds: DEFAULT_PARTIAL_CLIP_KINDS,
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

    let card = screen.getAllByText('Shares 0:20')[0]!.closest('article')!;
    // The longer video is the master; the clip sits on its timeline where it matches, with its scores.
    expect(within(card).getByText('Longest')).toBeTruthy();
    // The master's row is the time scale; the clip's bar and times say where it sits on it.
    expect(within(card).getByText('Timeline of the longest video')).toBeTruthy();
    expect(within(card).getByRole('img', { name: 'Time scale of the longest video, 0:00 to 10:00' })).toBeTruthy();
    expect(within(card).getByTitle('0:30 to 0:50')).toBeTruthy();
    expect(within(card).getByText('0:30 to 0:50')).toBeTruthy();
    expect(within(card).getByTitle('Sound matches 96%')).toBeTruthy();
    expect(within(card).getByTitle('Picture matches 99%')).toBeTruthy();
    // The 40 s clip's last 20 s are not in the longest: half of it, far past the intro and outro
    // allowance. What the longest lacks is the clip bar's gaps, so its row does not say it again.
    expect(within(card).getByText('Not in the longest: last 0:20')).toBeTruthy();
    expect(within(card).queryByText(/Not in the other videos/)).toBeNull();
    expect(screen.getAllByText('Fully inside').length).toBeGreaterThan(0);
    // With no kind chosen every entry shows; choosing Same sound leaves only that one.
    expect(screen.getByText('Same sound, other picture')).toBeTruthy();
    act(() => useStore.getState().togglePartialClipKind('sameSound'));
    expect(screen.getByText(/1 entry of 3; the rest are filtered out/)).toBeTruthy();
    expect(screen.queryByText('Shares 0:20')).toBeNull();
    act(() => useStore.getState().togglePartialClipKind('sameSound'));
    // The filter redrew the list, so the card is looked up again.
    card = screen.getAllByText('Shares 0:20')[0]!.closest('article')!;

    // Header like a duplicate group: score, size, description; no filter set, so no filter count.
    expect(within(card).getByText('99.0%')).toBeTruthy();
    expect(within(card).getByTitle('1 matching part')).toBeTruthy();
    expect(screen.queryByText(/filtered out/)).toBeNull();
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
    expect(matchBadge(clip({ bId: OTHER, shorterId: OTHER, coverage: 1, segments: whole }), reencode, concert, 10))
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
    const lane = (id: string, kbps: number, role: Lane['role']): Lane => ({ video: makeVideo(id, { videoBitrate: kbps * 1000 }), role, segments: [], via: null, missing: [] });
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
    expect(placeOnMaster(entries, byId, 10).map((lane) => lane.video.filename)).toEqual(['disc.mp4', 'scene1.mp4', 'scene2.mp4']);
  });

  test('gaps leave out what the bars join, and spans past either end', () => {
    // 1% of 1000 s is 10 s: the 5 s gap is joined, the 50 s one and the 100 s start are not.
    expect(gapsIn([{ start: 100, end: 400 }, { start: 405, end: 600 }, { start: 650, end: 1200 }], 1000, 30))
      .toEqual([{ start: 0, end: 100 }, { start: 600, end: 650 }]);
    expect(gapsIn([{ start: -20, end: 1000 }], 1000, 30)).toEqual([]);
    // A 2 s gap in the middle is the search being off; 25 s at the start is within a 30 s intro.
    expect(gapsIn([{ start: 25, end: 500 }, { start: 502, end: 1000 }], 1000, 30)).toEqual([]);
    // The allowance is never more than a tenth of the video: 16 s of a 160 s clip.
    expect(gapsIn([{ start: 25, end: 160 }], 160, 30)).toEqual([{ start: 0, end: 25 }]);
    expect(gapsIn([{ start: 15, end: 160 }], 160, 30)).toEqual([]);
  });

  test('with several videos inside the longest, its row says what none of them has', () => {
    const scene = (startA: number) => [{ startA, startB: 0, lengthSecs: 200, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 96 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'disc.mp4', durationSecs: 600 }),
        makeVideo(CLIP, { filename: 'scene1.mp4', durationSecs: 200 }),
        makeVideo(OTHER, { filename: 'scene2.mp4', durationSecs: 200 }),
      ],
      partialClips: [clip({ segments: scene(0), coverage: 1 }), clip({ bId: OTHER, shorterId: OTHER, segments: scene(300), coverage: 1 })],
    });
    render(<PartialClipsView />);
    expect(screen.getByText('Not in the other videos: 3:20 to 5:00, 8:20 to 10:00')).toBeTruthy();
  });

  test('the keeper is the best copy by the keeper order; what lies fully inside it is suggested, a better picture with a warning', async () => {
    const COPY = '00000000000000dd';
    const WEAK = '00000000000000ee';
    const whole = (startA: number, lengthSecs: number) => [{ startA, startB: 0, lengthSecs, soundSimilarity: 97, pictureState: 'confirmed' as const, pictureSimilarity: 98 }];
    useStore.setState({
      videos: [
        makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600, width: 854, height: 480 }),
        makeVideo(COPY, { filename: 'concert-720.mp4', durationSecs: 598, width: 1280, height: 720 }),
        makeVideo(CLIP, { filename: 'highlight-1080.mp4', durationSecs: 40, width: 1920, height: 1080, status: 'keep' }),
        makeVideo(WEAK, { filename: 'mashup.mp4', durationSecs: 300 }),
      ],
      partialClips: [
        clip({ bId: COPY, shorterId: COPY, segments: whole(2, 596) }),
        clip({ aId: COPY, segments: whole(100, 40) }),
        // Shares 20 s of a 5-minute video: never suggested.
        clip({ aId: COPY, bId: WEAK, shorterId: WEAK }),
      ],
    });
    render(<PartialClipsView />);
    const family = screen.getByText('Same footage').closest('article')!;
    const row = (name: string) => within(family).getByText(name).closest('.partial-clip-video') as HTMLElement;
    // 720p beats 480p by the default keeper order; the 1080p clip is still suggested, but says so.
    expect(within(row('concert-720.mp4')).getByText('Keeper')).toBeTruthy();
    expect(within(row('concert.mp4')).queryByText('Keeper')).toBeNull();
    expect(within(row('highlight-1080.mp4')).getByText('Better picture than the keeper')).toBeTruthy();

    // A video marked Keep is protected, as in duplicate review.
    await userEvent.click(screen.getByRole('button', { name: 'Select suggested deletions' }));
    expect((screen.getByRole('checkbox', { name: 'Select concert.mp4' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Select highlight-1080.mp4' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Select mashup.mp4' }) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select highlight-1080.mp4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark selected as Delete (2)' }));
    const status = (id: string) => useStore.getState().videos.find((video) => video.id === id)?.status;
    expect([status(SOURCE), status(COPY), status(CLIP), status(WEAK)]).toEqual(['delete', 'pending', 'delete', 'pending']);
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

  test('a copy split into parts is the same video, and only matching pictures count toward the shared length', () => {
    const concert = makeVideo(SOURCE, { filename: 'concert.mp4', durationSecs: 600 });
    const recut = makeVideo(OTHER, { filename: 'concert-recut.mp4', durationSecs: 590 });
    const segment = (startA: number, startB: number, lengthSecs: number, pictureState: 'confirmed' | 'differentPicture') => (
      { startA, startB, lengthSecs, soundSimilarity: 96, pictureState, pictureSimilarity: 90 }
    );
    const recutClip = clip({ bId: OTHER, shorterId: OTHER, segments: [segment(0, 0, 300, 'confirmed'), segment(310, 300, 290, 'confirmed'), segment(400, 20, 15, 'differentPicture')] });
    expect(matchBadge(recutClip, recut, concert, 10).label).toBe('Same video');
    expect(matchedSeconds(recutClip)).toBe(590);

    // Many sound-only stretches do not lift a pair above one with more matching picture.
    const noisy = clip({ segments: [segment(30, 0, 20, 'confirmed'), ...Array.from({ length: 40 }, (_, i) => segment(100 + i * 12, 0, 10, 'differentPicture'))] });
    const videosById = new Map([concert, recut, makeVideo(CLIP, { durationSecs: 40 })].map((video) => [video.id, video]));
    const cards = buildClipCards([{ primary: noisy, others: [] }, { primary: recutClip, others: [] }], videosById, CARD_OPTIONS);
    const sorted = filterAndSortCards(cards, { kinds: DEFAULT_PARTIAL_CLIP_KINDS, sortBy: 'sharedLength', sortOrder: 'desc' });
    expect(sorted.map((card) => card.entries[0]!.primary)).toEqual([recutClip, noisy]);
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
    expect(screen.getByTitle('0:00 to 0:32')).toBeTruthy();
  });

  test('stretches a few seconds apart on the longest video are drawn and listed as one', () => {
    const lane = (segments: Lane['segments']): Lane => ({ video: makeVideo(CLIP), role: 'excerpt', segments, via: null, missing: [] });
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
    // The pressed Keep button shows the mark; the name line has no room for it.
    expect(screen.getByRole('button', { name: 'Unmark keep: highlight.mp4' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('cards filter by path and kind, and sort by shared length, score, space to free and size', () => {
    const video = (id: string, durationSecs: number, sizeBytes: number) => makeVideo(id, { filename: `${id}.mp4`, path: `D:\\${id}.mp4`, durationSecs, sizeBytes });
    const videosById = new Map([video('long1', 600, 600), video('clip1', 40, 40), video('long2', 600, 300), video('clip2', 30, 30)].map((v) => [v.id, v]));
    const stretch = (startA: number, lengthSecs: number) => [{ startA, startB: 0, lengthSecs, soundSimilarity: 96, pictureState: 'confirmed' as const, pictureSimilarity: 95 }];
    // 20 s of a 40 s clip: it shares, and nothing could be freed. All 30 s of the other clip: fully inside.
    const shares = { primary: clip({ aId: 'long1', bId: 'clip1', shorterId: 'clip1', segments: stretch(30, 20), pictureSimilarity: 99 }), others: [] };
    const inside = { primary: clip({ aId: 'long2', bId: 'clip2', shorterId: 'clip2', segments: stretch(100, 30), pictureSimilarity: 90 }), others: [] };
    const cards = buildClipCards([shares, inside], videosById, CARD_OPTIONS);
    expect(cards.map((card) => [card.kinds, card.sharedSecs, card.score, card.freeBytes, card.totalBytes, card.keeperId, card.deleteIds]))
      .toEqual([[['contains'], 20, 99, 0, 640, 'long1', []], [['excerpt'], 30, 90, 30, 330, 'long2', ['clip2']]]);
    const order = (sortBy: 'sharedLength' | 'similarity' | 'spaceToFree' | 'totalSize', kinds = DEFAULT_PARTIAL_CLIP_KINDS) =>
      filterAndSortCards(cards, { kinds, sortBy, sortOrder: 'desc' }).map((card) => card.entries[0]);
    expect(order('sharedLength')).toEqual([inside, shares]);
    expect(order('similarity')).toEqual([shares, inside]);
    expect(order('spaceToFree')).toEqual([inside, shares]);
    expect(order('totalSize')).toEqual([shares, inside]);
    expect(order('totalSize', { ...DEFAULT_PARTIAL_CLIP_KINDS, contains: true })).toEqual([shares]);
    expect(order('totalSize', { ...DEFAULT_PARTIAL_CLIP_KINDS, contains: true, excerpt: true })).toEqual([shares, inside]);
    expect(cards.filter((card) => matchesPathFilter(card, 'LONG2')).map((card) => card.entries[0])).toEqual([inside]);
  });

  test('reports its first entry to the title bar and clears it when closed', () => {
    useStore.setState({ partialClips: [clip(), clip({ bId: OTHER, shorterId: OTHER })] });
    const { unmount } = render(<PartialClipsView />);
    expect(useStore.getState().duplicatePosition).toEqual({ group: 0, total: 2 });
    unmount();
    expect(useStore.getState().duplicatePosition).toBeNull();
  });

  test('an empty result says so', () => {
    useStore.setState({ partialClips: [] });
    render(<PartialClipsView />);
    expect(screen.getByText('No video contains part of another.')).toBeTruthy();
  });
});
