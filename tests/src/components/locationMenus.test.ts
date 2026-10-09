import { collapseSegments, hasSubfolders, listSubfolders, splitPath } from '../../../src/components/locationMenus';
import { makeVideo } from '../../helpers/videoFactory';

const inFolder = (id: string, folder: string) => makeVideo(id, {}, folder);

describe('splitPath', () => {
  test('a drive path keeps the separator on the drive root', () => {
    expect(splitPath('P:\\Clips\\Trip')).toEqual([
      { label: 'P:', path: 'P:\\' },
      { label: 'Clips', path: 'P:\\Clips' },
      { label: 'Trip', path: 'P:\\Clips\\Trip' },
    ]);
  });

  test('a network share is one segment, folders below it follow', () => {
    expect(splitPath('\\\\nas\\media\\Trips')).toEqual([
      { label: '\\\\nas\\media', path: '\\\\nas\\media' },
      { label: 'Trips', path: '\\\\nas\\media\\Trips' },
    ]);
  });

  test('a POSIX path starts at the root separator', () => {
    expect(splitPath('/mnt/media/Trips').map((segment) => segment.path)).toEqual(['/mnt', '/mnt/media', '/mnt/media/Trips']);
  });
});

test('collapsing hides middle segments but never the first or last', () => {
  const segments = ['a', 'b', 'c', 'd'];
  expect(collapseSegments(segments, 0)).toEqual(segments);
  expect(collapseSegments(segments, 1)).toEqual(['a', null, 'c', 'd']);
  expect(collapseSegments(segments, 9)).toEqual(['a', null, 'd']);
  expect(collapseSegments(['a', 'b'], 3)).toEqual(['a', 'b']);
});

describe('subfolders', () => {
  const videos = [
    inFolder('1', 'C:\\a'),
    inFolder('2', 'C:\\a\\Day1'),
    inFolder('3', 'C:\\a\\Day1\\Raw'),
    inFolder('4', 'C:\\ab\\Other'),
    inFolder('5', 'C:\\a\\day2'),
  ];

  test('a folder with a similar prefix is not a subfolder', () => {
    expect(listSubfolders(videos, 'C:\\a').map((entry) => entry.label)).toEqual(['Day1', 'day2']);
    expect(hasSubfolders(videos, 'C:\\a')).toBe(true);
    expect(hasSubfolders([inFolder('6', 'C:\\ab')], 'C:\\a')).toBe(false);
  });

  test('videos in the folder itself do not count as a subfolder', () => {
    expect(hasSubfolders([inFolder('1', 'C:\\a')], 'C:\\a')).toBe(false);
    expect(hasSubfolders([inFolder('1', 'C:\\a')], 'C:\\a\\')).toBe(false);
  });

  test('deeper folders count towards the first folder below the parent', () => {
    const entry = listSubfolders(videos, 'C:\\a').find((candidate) => candidate.label === 'Day1');
    expect(entry).toMatchObject({ path: 'C:\\a\\Day1', count: 2 });
  });

  test('a drive root lists its folders with their paths', () => {
    const drive = [inFolder('1', 'P:\\Clips'), inFolder('2', 'P:\\Clips\\More'), inFolder('3', 'P:')];
    expect(listSubfolders(drive, 'P:\\')).toEqual([{ path: 'P:\\Clips', label: 'Clips', count: 2, toReview: 2 }]);
  });

  test('a network share lists real child folders with labels and paths', () => {
    const share = [inFolder('1', '\\\\nas\\media\\Trips'), inFolder('2', '\\\\nas\\media\\Trips\\Day1')];
    expect(listSubfolders(share, '\\\\nas\\media')).toEqual([{ path: '\\\\nas\\media\\Trips', label: 'Trips', count: 2, toReview: 2 }]);
  });

  test('matching ignores case and separator style', () => {
    expect(hasSubfolders([makeVideo('1', { path: 'c:/A/Day1/1.mp4' })], 'C:\\a')).toBe(true);
  });
});
