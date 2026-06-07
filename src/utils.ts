/**
 * Format bytes to a human-readable string.
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format seconds to HH:MM:SS or MM:SS.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format a timestamp (ms) to a readable date string.
 */
export function formatDate(timestampMs: number | null | undefined): string {
  if (!timestampMs) return '--';
  return new Date(timestampMs).toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calculate the optimal grid columns/rows for a given number of thumbnails.
 * Returns { cols, rows } for use in CSS grid layout and aspect ratio calculations.
 */
export function calcThumbGrid(count: number): { cols: number; rows: number } {
  if (count === 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  if (count === 6) return { cols: 3, rows: 2 };
  if (count === 9) return { cols: 3, rows: 3 };
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

/**
 * Format a timestamp (ms) to a relative time string (e.g., "2h ago").
 */
export function formatRelativeTime(ts: number | undefined): string {
  if (!ts) return 'unknown';
  const diffMs = Date.now() - ts;
  const diffMin = Math.max(1, Math.round(diffMs / 60000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

/**
 * Format an absolute path to show only the last two segments (e.g., "Videos / Footage").
 */
export function formatRecentPath(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[parts.length - 2]} / ${parts[parts.length - 1]}`;
  return p;
}

export const WEB_SUPPORTED_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.mkv', '.m4v'];
const BUILT_IN_UNSUPPORTED_EXTS = new Set([
  '.wmv', '.asf', '.avi', '.flv', '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.vob', '.divx',
  '.3gp', '.3g2', '.mxf', '.dv',
]);
const BUILT_IN_UNSUPPORTED_CODECS = new Set([
  'wmv1', 'wmv2', 'wmv3', 'vc1', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'mpeg2video',
  'prores', 'h263', 'dvvideo', 'theora',
]);
const BUILT_IN_SUPPORTED_CODECS = new Set([
  'h264', 'avc', 'avc1', 'hevc', 'h265', 'hvc1', 'av1', 'av01', 'vp8', 'vp9', 'mpeg4', 'mp4v',
]);
const BUILT_IN_SUPPORTED_FORMATS = ['mp4', 'mov', 'matroska', 'webm', 'ogg', '3gp', '3g2', 'm4a', 'mj2'];

export function isWebSupported(path: string): boolean {
  return WEB_SUPPORTED_EXTS.some((ext) => path.toLowerCase().endsWith(ext));
}

function extensionFromPath(path: string | null | undefined): string {
  const match = (path ?? '').toLowerCase().match(/\.[^.\\/]+$/);
  return match?.[0] ?? '';
}

function hasAnyFormat(containerFormat: string | null | undefined, tokens: string[]): boolean {
  const parts = (containerFormat ?? '').toLowerCase().split(',').map((part) => part.trim());
  return tokens.some((token) => parts.includes(token));
}

export function detectVideoCompatibility(
  containerFormat: string | null | undefined,
  videoCodec: string | null | undefined,
  path?: string | null
): boolean {
  const ext = extensionFromPath(path);
  const codec = (videoCodec ?? '').toLowerCase();

  if (BUILT_IN_UNSUPPORTED_EXTS.has(ext) || BUILT_IN_UNSUPPORTED_CODECS.has(codec)) return false;
  if (codec) {
    if (!BUILT_IN_SUPPORTED_CODECS.has(codec)) return false;
    if (hasAnyFormat(containerFormat, BUILT_IN_SUPPORTED_FORMATS)) return true;
    if (hasAnyFormat(containerFormat, ['asf', 'avi', 'flv', 'mpegts', 'mpeg', 'vob'])) return false;
    return WEB_SUPPORTED_EXTS.includes(ext);
  }
  if (hasAnyFormat(containerFormat, BUILT_IN_SUPPORTED_FORMATS)) return true;
  if (WEB_SUPPORTED_EXTS.includes(ext) && !containerFormat) return true;
  if (hasAnyFormat(containerFormat, ['asf', 'avi', 'flv', 'mpegts', 'mpeg', 'vob'])) return false;
  return false;
}

const CODEC_DISPLAY: Record<string, string> = {
  h264: 'H.264',
  avc: 'H.264',
  avc1: 'H.264',
  hevc: 'H.265',
  h265: 'H.265',
  hvc1: 'H.265',
  av1: 'AV1',
  av01: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
  theora: 'Theora',
  prores: 'ProRes',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  wmv3: 'WMV3',
  vc1: 'VC-1',
  h263: 'H.263',
};

export function formatCodecLabel(codec: string | null | undefined): string {
  if (!codec) return '';
  return CODEC_DISPLAY[codec.toLowerCase()] ?? codec.toUpperCase();
}

export function formatResolutionLabel(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) return '';
  const longestEdge = Math.max(width, height);
  const shortestEdge = Math.min(width, height);

  if (longestEdge >= 7680) return '8K';
  if (longestEdge >= 5120) return '5K';
  if (longestEdge >= 3840) return '4K';
  if (longestEdge >= 2560) return '1440p';
  if (longestEdge >= 1920) return '1080p';
  if (longestEdge >= 1280) return '720p';
  return `${shortestEdge}p`;
}

export function formatFps(fps: number | null | undefined): string {
  if (!fps) return '';
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)}fps`;
}
