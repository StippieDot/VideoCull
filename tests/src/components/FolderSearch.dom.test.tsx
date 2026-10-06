// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import FolderSearch, { rankFolders } from '../../../src/components/FolderSearch';
import useStore from '../../../src/store';
import { makeVideo } from '../../helpers/videoFactory';

// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const FOLDERS = [
  { path: 'D:\\Media\\Trips', label: 'Trips', count: 4, toReview: 1 },
  { path: 'D:\\Media\\Clips\\Old', label: 'Clips\\Old', count: 9, toReview: 6 },
  { path: 'D:\\Media\\Clips', label: 'Clips', count: 2, toReview: 0 },
];

test('typed words must all appear in the path; without a query, recent jumps and most to review come first', () => {
  expect(rankFolders(FOLDERS, 'clips old', []).map((folder) => folder.label)).toEqual(['Clips\\Old']);
  expect(rankFolders(FOLDERS, '', []).map((folder) => folder.label)).toEqual(['Clips\\Old', 'Trips', 'Clips']);
  expect(rankFolders(FOLDERS, '', ['D:\\Media\\Clips']).map((folder) => folder.label)).toEqual(['Clips', 'Clips\\Old', 'Trips']);
});

test('Enter leaves Review and jumps the grid to the chosen folder', () => {
  const videos = [makeVideo('a', {}, 'D:\\Media\\Trips'), makeVideo('b', {}, 'D:\\Media\\Clips')];
  useStore.setState({ directories: ['D:\\Media'], videos, filteredVideos: videos, reviewMode: true, gridFolderJump: null });
  const onClose = vi.fn();
  render(<FolderSearch onClose={onClose} />);

  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'clip' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onClose).toHaveBeenCalled();
  expect(useStore.getState().reviewMode).toBe(false);
  expect(useStore.getState().gridFolderJump?.folderPath).toBe('D:\\Media\\Clips');
});
