// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ThumbnailStrip from '../../../src/components/ThumbnailStrip';

afterEach(() => {
  vi.restoreAllMocks();
});

test('loads strip images immediately once ThumbnailStrip is mounted', () => {
  render(<ThumbnailStrip thumbnails={['D:\\Cache\\thumb_1.jpg']} />);

  const image = screen.getByRole('img', { name: 'Frame 1' });
  expect(image.getAttribute('loading')).toBeNull();
  expect(image.getAttribute('decoding')).toBe('async');
});

test('shows a thumbnail after its normal load event', () => {
  render(<ThumbnailStrip thumbnails={['D:\\Cache\\thumb_1.jpg']} />);
  const image = screen.getByRole('img', { name: 'Frame 1' });

  expect(image.classList.contains('thumb-img-loaded')).toBe(false);
  fireEvent.load(image);
  expect(image.classList.contains('thumb-img-loaded')).toBe(true);
});

test('shows an already-complete cached thumbnail without waiting for another load event', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(320);

  render(<ThumbnailStrip thumbnails={['D:\\Cache\\thumb_1.jpg']} />);

  await waitFor(() => {
    expect(screen.getByRole('img', { name: 'Frame 1' }).classList.contains('thumb-img-loaded')).toBe(true);
  });
});
