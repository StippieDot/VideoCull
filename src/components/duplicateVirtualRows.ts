import { calcThumbGrid } from '../utils';

export const DUPLICATE_GROUP_GAP = 12;
export const DUPLICATE_GROUP_HEADER_HEIGHT = 64;
export const DUPLICATE_VIDEO_ROW_HEIGHT = 79;
export const DUPLICATE_GALLERY_ROW_PADDING = 12;
/** The width cards aim for; columns then stretch or shrink a little to fill the row. */
export const DUPLICATE_GALLERY_CARD_WIDTH = 380;
/** Narrow windows may shrink cards down to this. */
export const DUPLICATE_GALLERY_CARD_MIN_WIDTH = 232;
export const DUPLICATE_GALLERY_CARD_GAP = 12;
/** The frame shape and thumbnail count every card has room for, so landscape videos show no black bars. */
const STANDARD_ASPECT = 16 / 9;
const STANDARD_THUMBNAIL_COUNT = 9;
/** A gallery card's name, details, buttons and border: everything but its thumbnails. */
const DUPLICATE_GALLERY_CARD_CHROME_HEIGHT = 122;
const CARD_BORDER_WIDTH = 3;
const THUMB_GAP = 2;

export type DuplicateVirtualizableGroup = {
  group: {
    id: string;
    videoIds: string[];
  };
  videos: Array<{
    id: string;
    thumbnails?: string[];
  }>;
};

/** Width over height of a video's frames, or null when unknown. */
export type DuplicateAspectLookup = (videoId: string) => number | null;

export type DuplicateVirtualRow =
  | {
      key: string;
      type: 'group-header';
      groupId: string;
      groupIndex: number;
      isFirstGroup: boolean;
      isLastInGroup: false;
    }
  | {
      key: string;
      type: 'video-row';
      groupId: string;
      videoId: string;
      groupIndex: number;
      isFirstGroup: boolean;
      isLastInGroup: boolean;
    }
  | {
      key: string;
      type: 'gallery-card-row';
      groupId: string;
      videoIds: string[];
      /** Fits the tallest card in the row, so portrait thumbnails do not run into the next row. */
      cardHeight: number;
      groupIndex: number;
      isFirstGroup: boolean;
      isLastInGroup: boolean;
    };

export type DuplicateGalleryLayout = {
  availableWidth: number;
  columnCount: number;
  cardWidth: number;
};

function toNonNegativeFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildDuplicateRowsRows(
  groupViews: DuplicateVirtualizableGroup[]
): DuplicateVirtualRow[] {
  const rows: DuplicateVirtualRow[] = [];

  for (let groupIndex = 0; groupIndex < groupViews.length; groupIndex += 1) {
    const groupView = groupViews[groupIndex];
    rows.push({
      key: `${groupView.group.id}:header`,
      type: 'group-header',
      groupId: groupView.group.id,
      groupIndex,
      isFirstGroup: groupIndex === 0,
      isLastInGroup: false,
    });

    for (let videoIndex = 0; videoIndex < groupView.videos.length; videoIndex += 1) {
      const video = groupView.videos[videoIndex];
      rows.push({
        key: `${groupView.group.id}:video:${video.id}`,
        type: 'video-row',
        groupId: groupView.group.id,
        videoId: video.id,
        groupIndex,
        isFirstGroup: groupIndex === 0,
        isLastInGroup: videoIndex === groupView.videos.length - 1,
      });
    }
  }

  return rows;
}

export function computeDuplicateGalleryLayout(
  availableWidth: number
): DuplicateGalleryLayout {
  const safeWidth = toNonNegativeFinite(availableWidth);
  const usableWidth = Math.max(
    DUPLICATE_GALLERY_CARD_MIN_WIDTH,
    safeWidth - DUPLICATE_GALLERY_ROW_PADDING * 2
  );
  // Rounded rather than floored, so stretched cards stay near the aimed-for width instead of up to twice it.
  const columnCount = Math.max(
    1,
    Math.round(
      (usableWidth + DUPLICATE_GALLERY_CARD_GAP) /
        (DUPLICATE_GALLERY_CARD_WIDTH + DUPLICATE_GALLERY_CARD_GAP)
    )
  );
  const cardWidth = Math.max(
    DUPLICATE_GALLERY_CARD_MIN_WIDTH,
    Math.floor(
      (usableWidth - DUPLICATE_GALLERY_CARD_GAP * (columnCount - 1)) / columnCount
    )
  );

  return { availableWidth: safeWidth, columnCount, cardWidth };
}

function thumbnailsHeight(aspect: number, thumbnailCount: number, cardWidth: number): number {
  const { cols, rows } = calcThumbGrid(thumbnailCount);
  const frameWidth = (cardWidth - CARD_BORDER_WIDTH - THUMB_GAP * (cols - 1)) / cols;
  return rows * (frameWidth / aspect) + THUMB_GAP * (rows - 1);
}

/**
 * The card height that shows every thumbnail at its frame shape. It never drops below what a 16:9
 * video needs at this width, so landscape cards share one height and portrait ones grow.
 */
export function duplicateGalleryCardHeight(aspect: number | null, thumbnailCount: number, cardWidth: number): number {
  const count = thumbnailCount > 0 ? thumbnailCount : STANDARD_THUMBNAIL_COUNT;
  const standard = thumbnailsHeight(STANDARD_ASPECT, count, cardWidth);
  const own = aspect && aspect > 0 ? thumbnailsHeight(aspect, count, cardWidth) : 0;
  return Math.ceil(DUPLICATE_GALLERY_CARD_CHROME_HEIGHT + Math.max(standard, own));
}

export function buildDuplicateGalleryRows(
  groupViews: DuplicateVirtualizableGroup[],
  layout: DuplicateGalleryLayout,
  aspectOf: DuplicateAspectLookup = () => null,
): DuplicateVirtualRow[] {
  const rows: DuplicateVirtualRow[] = [];
  const columnCount = Math.max(1, layout.columnCount);

  for (let groupIndex = 0; groupIndex < groupViews.length; groupIndex += 1) {
    const groupView = groupViews[groupIndex];
    rows.push({
      key: `${groupView.group.id}:header`,
      type: 'group-header',
      groupId: groupView.group.id,
      groupIndex,
      isFirstGroup: groupIndex === 0,
      isLastInGroup: false,
    });

    for (let startIndex = 0; startIndex < groupView.videos.length; startIndex += columnCount) {
      const slice = groupView.videos.slice(startIndex, startIndex + columnCount);
      const cardHeight = Math.max(...slice.map((video) => (
        duplicateGalleryCardHeight(aspectOf(video.id), video.thumbnails?.length ?? 0, layout.cardWidth)
      )));
      rows.push({
        key: `${groupView.group.id}:gallery:${startIndex}`,
        type: 'gallery-card-row',
        groupId: groupView.group.id,
        videoIds: slice.map((video) => video.id),
        cardHeight,
        groupIndex,
        isFirstGroup: groupIndex === 0,
        isLastInGroup: startIndex + columnCount >= groupView.videos.length,
      });
    }
  }

  return rows;
}

export function getDuplicateVirtualRowHeight(row: DuplicateVirtualRow): number {
  if (row.type === 'group-header') {
    return DUPLICATE_GROUP_HEADER_HEIGHT + (row.isFirstGroup ? 0 : DUPLICATE_GROUP_GAP);
  }
  if (row.type === 'video-row') {
    return DUPLICATE_VIDEO_ROW_HEIGHT;
  }
  return row.cardHeight + DUPLICATE_GALLERY_ROW_PADDING * 2 + 1;
}
