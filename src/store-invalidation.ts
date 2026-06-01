import type { Video, VideoStore } from './types';

export type InvalidationField =
  | 'thumbnails'
  | 'duration'
  | 'size'
  | 'metadataDate'
  | 'rating'
  | 'favorite'
  | 'compatible'
  | 'status'
  | 'duplicate'
  | 'resolution'
  | 'fps';

export type ViewInvalidationState = Pick<
  VideoStore,
  | 'statusFilter'
  | 'minSizeFilter'
  | 'maxSizeFilter'
  | 'minDurationFilter'
  | 'maxDurationFilter'
  | 'minRatingFilter'
  | 'favoritesFilter'
  | 'incompatibleFilter'
  | 'duplicateFilter'
  | 'duplicateGroupsMode'
  | 'sortBy'
  | 'groupByFolder'
  | 'folderSortBy'
>;

function hasActiveSizeFilter(state: ViewInvalidationState) {
  return state.minSizeFilter > 0 || state.maxSizeFilter !== null;
}

function hasActiveDurationFilter(state: ViewInvalidationState) {
  return state.minDurationFilter > 0 || state.maxDurationFilter !== null;
}

export function changeAffectsCurrentView(
  changedFields: Iterable<InvalidationField>,
  state: ViewInvalidationState
): boolean {
  for (const field of changedFields) {
    switch (field) {
      case 'thumbnails':
        break;
      case 'duration':
        if (hasActiveDurationFilter(state) || state.sortBy === 'duration') return true;
        break;
      case 'size':
        if (hasActiveSizeFilter(state) || state.sortBy === 'size' || (state.groupByFolder && state.folderSortBy === 'size')) {
          return true;
        }
        break;
      case 'metadataDate':
        if (state.sortBy === 'date') return true;
        break;
      case 'rating':
        if (state.minRatingFilter > 0 || state.sortBy === 'rating') return true;
        break;
      case 'favorite':
        if (state.favoritesFilter) return true;
        break;
      case 'compatible':
        if (state.incompatibleFilter) return true;
        break;
      case 'status':
        if (state.statusFilter !== 'all') return true;
        break;
      case 'duplicate':
        if (state.duplicateFilter || state.duplicateGroupsMode) return true;
        break;
      case 'resolution':
        if (state.sortBy === 'resolution') return true;
        break;
      case 'fps':
        if (state.sortBy === 'fps') return true;
        break;
      default:
        return true;
    }
  }

  return false;
}

export function patchFilteredVideosPreservingOrder(
  filteredVideos: Video[],
  nextVideos: Video[]
): Video[] {
  const nextVideosById = new Map(nextVideos.map((video) => [video.id, video]));
  return filteredVideos
    .map((video) => nextVideosById.get(video.id))
    .filter((video): video is Video => Boolean(video));
}
