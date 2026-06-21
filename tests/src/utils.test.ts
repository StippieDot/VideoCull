import { expect, test, vi } from 'vitest';
import {
  calcThumbGrid,
  detectVideoCompatibility,
  formatCodecLabel,
  formatDeleteConfirmation,
  formatDuration,
  formatFps,
  formatRecentPath,
  formatRelativeTime,
  formatResolutionLabel,
  formatSize,
  isWebSupported,
} from '../../src/utils';

test('format helpers produce user-facing strings for common values', () => {
  expect(formatSize(0)).toBe('0 B');
  expect(formatSize(1536)).toBe('2 KB');
  expect(formatDuration(null)).toBe('--:--');
  expect(formatDuration(65)).toBe('1:05');
  expect(formatDuration(3661)).toBe('1:01:01');
  expect(formatRecentPath('C:\\Videos\\Trips\\clip.mp4')).toBe('Trips / clip.mp4');
  expect(formatRecentPath('single')).toBe('single');
});

test('formatRelativeTime buckets minutes, hours, and days', () => {
  vi.spyOn(Date, 'now').mockReturnValue(10 * 24 * 60 * 60 * 1000);

  expect(formatRelativeTime(undefined)).toBe('unknown');
  expect(formatRelativeTime(Date.now() - 30 * 60 * 1000)).toBe('30m ago');
  expect(formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago');
  expect(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago');
});

test('thumbnail grid layout matches common thumbnail counts', () => {
  expect(calcThumbGrid(1)).toEqual({ cols: 1, rows: 1 });
  expect(calcThumbGrid(6)).toEqual({ cols: 3, rows: 2 });
  expect(calcThumbGrid(5)).toEqual({ cols: 3, rows: 2 });
});

test('web support and compatibility detection match supported and unsupported formats', () => {
  expect(isWebSupported('video.MP4')).toBe(true);
  expect(isWebSupported('video.avi')).toBe(false);
  expect(isWebSupported('video.ogg')).toBe(true);
  expect(isWebSupported('video.ogv')).toBe(true);

  expect(detectVideoCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'clip.mp4')).toBe(true);
  expect(detectVideoCompatibility(null, 'vp9', 'clip.webm')).toBe(true);
  expect(detectVideoCompatibility('ogg', 'vp9', 'clip.ogg')).toBe(true);
  expect(detectVideoCompatibility('ogg', 'vp9', 'clip.ogv')).toBe(true);
  expect(detectVideoCompatibility('avi', 'h264', 'clip.avi')).toBe(false);
  expect(detectVideoCompatibility('matroska,webm', 'wmv3', 'clip.mkv')).toBe(false);
  expect(detectVideoCompatibility(null, null, 'clip.mov')).toBe(true);
  expect(detectVideoCompatibility('mpegts', null, 'clip.ts')).toBe(false);
  expect(detectVideoCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'clip.3gp')).toBe(false);
  expect(detectVideoCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'clip.3g2')).toBe(false);
  expect(detectVideoCompatibility('mxf', 'mpeg4', 'clip.mxf')).toBe(false);
  expect(detectVideoCompatibility('dv', 'dvvideo', 'clip.dv')).toBe(false);
});

test('codec, resolution, and fps labels are formatted for display', () => {
  expect(formatCodecLabel('h264')).toBe('H.264');
  expect(formatCodecLabel('xvid')).toBe('XVID');
  expect(formatCodecLabel(null)).toBe('');
  expect(formatResolutionLabel(3840, 2160)).toBe('4K');
  expect(formatResolutionLabel(2560, 1440)).toBe('1440p');
  expect(formatResolutionLabel(1920, 1080)).toBe('1080p');
  expect(formatResolutionLabel(1080, 1920)).toBe('1080p');
  expect(formatResolutionLabel(854, 480)).toBe('480p');
  expect(formatResolutionLabel(null, 480)).toBe('');
  expect(formatFps(30)).toBe('30fps');
  expect(formatFps(29.97)).toBe('29.97fps');
  expect(formatFps(null)).toBe('');
});

test('delete confirmation describes recycle bin, fallback, and empty-folder cleanup', () => {
  expect(formatDeleteConfirmation({
    count: 2,
    sizeBytes: 1536,
    removeEmptyFoldersAfterDelete: true,
  })).toBe('Move 2 marked videos (2 KB) to the Recycle Bin? If the Recycle Bin is unavailable, Video Cull will ask before permanently deleting. Empty source folders will be cleaned up when they are truly empty.');
});
