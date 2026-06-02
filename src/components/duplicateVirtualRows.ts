export const DUPLICATE_GROUP_GAP = 12;
export const DUPLICATE_GROUP_HEADER_HEIGHT = 64;
export const DUPLICATE_VIDEO_ROW_HEIGHT = 79;
export const DUPLICATE_GALLERY_ROW_PADDING = 12;
export const DUPLICATE_GALLERY_CARD_MIN_WIDTH = 220;
export const DUPLICATE_GALLERY_CARD_HEIGHT = 320;
export const DUPLICATE_GALLERY_CARD_GAP = 12;
export const DUPLICATE_GALLERY_ROW_HEIGHT =
  DUPLICATE_GALLERY_CARD_HEIGHT + DUPLICATE_GALLERY_ROW_PADDING * 2 + 1;

export type DuplicateVirtualizableGroup = {
  group: {
    id: string;
    videoIds: string[];
  };
  videos: Array<{
    id: string;
  }>;
};

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
  const columnCount = Math.max(
    1,
    Math.floor(
      (usableWidth + DUPLICATE_GALLERY_CARD_GAP) /
        (DUPLICATE_GALLERY_CARD_MIN_WIDTH + DUPLICATE_GALLERY_CARD_GAP)
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

export function buildDuplicateGalleryRows(
  groupViews: DuplicateVirtualizableGroup[],
  layout: DuplicateGalleryLayout
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
      const rowVideos = groupView.videos
        .slice(startIndex, startIndex + columnCount)
        .map((video) => video.id);
      rows.push({
        key: `${groupView.group.id}:gallery:${startIndex}`,
        type: 'gallery-card-row',
        groupId: groupView.group.id,
        videoIds: rowVideos,
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
  return DUPLICATE_GALLERY_ROW_HEIGHT;
}
