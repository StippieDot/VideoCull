// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PartialClipsView, { mergeClipsByDuplicateGroup } from '../../../src/components/PartialClipsView';
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
        clip({ coverage: 0.95, aId: OTHER, bId: CLIP }),
      ],
    });
    render(<PartialClipsView />);

    expect(screen.getByText('Contains 0:20 of concert.mp4, from 0:30 to 0:50 — sound and picture match')).toBeTruthy();
    expect(screen.getByText('highlight.mp4 is an excerpt of remix.mp4 — sound and picture match')).toBeTruthy();
    expect(screen.getByText('1 pair shares the same sound with different pictures')).toBeTruthy();
    expect(screen.getByText(/Same sound as concert.mp4 from 0:30 to 0:50; pictures differ/)).toBeTruthy();

    await userEvent.click(screen.getAllByRole('button', { name: 'Not a match' })[0]);
    expect(useStore.getState().partialClips).toHaveLength(2);
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).toContain(`${SOURCE}|${CLIP}`);
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
    expect(screen.getByText('Contains 0:20 of concert.mp4, from 0:30 to 0:50 — sound and picture match')).toBeTruthy();
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

  test('an empty result says so', () => {
    useStore.setState({ partialClips: [] });
    render(<PartialClipsView />);
    expect(screen.getByText('No video contains part of another.')).toBeTruthy();
  });
});
