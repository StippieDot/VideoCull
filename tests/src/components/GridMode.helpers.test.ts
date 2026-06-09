import { describe, expect, test } from 'vitest';
import { __test__ } from '../../../src/components/GridMode';
import { makeVideo } from '../../helpers/videoFactory';

describe('GridMode helpers', () => {
  test('reuses row structures when the filtered video ID order matches', () => {
    const videos = [
      makeVideo('alpha'),
      makeVideo('beta'),
      makeVideo('gamma'),
    ];

    expect(__test__.sameVideoIdOrder(videos, ['alpha', 'beta', 'gamma'])).toBe(true);
    expect(__test__.sameVideoIdOrder(videos, ['beta', 'alpha', 'gamma'])).toBe(false);
  });

  test('builds grouped rows from stable video IDs instead of storing full video objects', () => {
    const videos = [
      makeVideo('alpha', { path: 'D:\\Media\\Folder A\\alpha.mp4' }),
      makeVideo('beta', { path: 'D:\\Media\\Folder A\\beta.mp4' }),
      makeVideo('gamma', { path: 'D:\\Media\\Folder B\\gamma.mp4' }),
    ];

    const result = __test__.buildGridRows(videos, 2, true, ['D:\\Media']);

    expect(result.headerIndexes).toEqual([0, 2]);
    expect(result.filteredVideoIds).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.rows).toEqual([
      { type: 'header', label: 'Folder A', folderPath: 'D:\\Media\\Folder A', count: 2, videoIds: ['alpha', 'beta'] },
      { type: 'cards', videoIds: ['alpha', 'beta'] },
      { type: 'header', label: 'Folder B', folderPath: 'D:\\Media\\Folder B', count: 1, videoIds: ['gamma'] },
      { type: 'cards', videoIds: ['gamma'] },
    ]);
  });

  test('finds selection anchors from index lookups instead of rescanning the filtered list', () => {
    const indexById = new Map([
      ['alpha', 0],
      ['beta', 1],
      ['gamma', 2],
      ['delta', 3],
    ]);

    expect(__test__.getLastSelectedIdInOrder(new Set(['alpha', 'gamma']), indexById)).toBe('gamma');
    expect(__test__.getRangeAnchorIdForSelection(new Set(['alpha', 'delta']), 2, indexById)).toBe('alpha');
    expect(__test__.getRangeAnchorIdForSelection(new Set(['gamma', 'delta']), 2, indexById)).toBe('gamma');
  });
});
