// @vitest-environment jsdom

import { vi } from 'vitest';
import useStore from '../../src/store';
import type { StoredDuplicateResults } from '../../src/types';
import { makeVideo } from '../helpers/videoFactory';

const A = '0123456789abcdef';
const B = 'fedcba9876543210';
const C = '00112233445566ff';

function storedResults(): StoredDuplicateResults {
  return {
    version: 1,
    createdAt: 1_700_000_000_000,
    settingsKey: 'key',
    scope: 'all',
    videos: [A, B, C].map((id) => ({ id, sizeBytes: 100, date: 5 })),
    groups: [{
      id: 'dup-0123456789abcdef',
      videoIds: [A, B, C],
      pairs: [
        { aId: A, bId: B, similarity: 99, matchType: 'phash', comparedSamples: 3, confidence: 'normal' },
        { aId: B, bId: C, similarity: 97, matchType: 'phash', comparedSamples: 3, confidence: 'normal' },
      ],
      manualSuggestedKeeperId: null,
      sampleCount: 3,
      matchType: 'phash',
      unreadableSamples: {},
    }],
  };
}

describe('stored duplicate results in the store', () => {
  const store = useStore as typeof useStore & { getInitialState: () => ReturnType<typeof useStore.getState> };
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.useFakeTimers();
    store.setState(store.getInitialState(), true);
    api = {
      loadDuplicateResults: vi.fn().mockResolvedValue({ status: 'ok', results: storedResults() }),
      saveDuplicateResults: vi.fn().mockResolvedValue(true),
      clearDuplicateResults: vi.fn().mockResolvedValue(true),
    };
    Object.assign(window, { electronAPI: api });
    useStore.setState({
      directories: ['D:\\Videos'],
      includeSubfolders: true,
      videos: [A, B, C].map((id) => makeVideo(id, { sizeBytes: 100, date: 5, path: `D:\\Videos\\${id}.mp4` })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('groups come back after a scan, and later changes are stored again', async () => {
    expect(await useStore.getState().restoreDuplicateResults()).toBe('ok');
    const [group] = useStore.getState().duplicateGroups;
    expect(group).toMatchObject({ videoIds: [A, B, C], similarity: 97, reason: 'Same content at 3 of 3 sampled moments' });
    expect(useStore.getState().duplicateRun).toMatchObject({ restored: true, createdAt: 1_700_000_000_000 });
    expect(useStore.getState().duplicateGroupsMode).toBe(false);

    // The restore itself is written back, so pruning on load sticks.
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.saveDuplicateResults).toHaveBeenCalledTimes(1);
    expect(api.saveDuplicateResults.mock.calls[0]![0]).toEqual({ folders: ['D:\\Videos'], includeSubfolders: true, scope: 'all' });

    // Once the last group is gone, so is the file.
    useStore.getState().setDuplicateGroups([]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.clearDuplicateResults).toHaveBeenCalledTimes(1);
  });

  test('nothing is restored over groups that are already on screen', async () => {
    useStore.setState({ duplicateGroups: [{ id: 'g', videoIds: [A, B], similarity: 99, matchType: 'phash', suggestedKeeperId: A, reason: '' }] });
    expect(await useStore.getState().restoreDuplicateResults()).toBe('skipped');
    expect(api.loadDuplicateResults).not.toHaveBeenCalled();
  });

  test('a result from a run without run details is not stored', async () => {
    useStore.getState().applyDuplicateResult({ status: 'ok', groups: [], settingsKey: 'key' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.saveDuplicateResults).not.toHaveBeenCalled();
    expect(api.clearDuplicateResults).not.toHaveBeenCalled();
  });
});
