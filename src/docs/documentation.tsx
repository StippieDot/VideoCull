export const DOCUMENTATION_GITHUB_URL = 'https://github.com/stippie-dot/VideoCull';

export type DocumentationActionId =
  | 'show-shortcuts'
  | 'open-settings-interface'
  | 'open-settings-duplicates'
  | 'open-settings-keybindings'
  | 'open-settings-cache'
  | 'open-settings-processing'
  | 'open-settings-about';

export type DocumentationTask = {
  id: string;
  title: string;
  detail: string;
  pageId: string;
};

export type DocumentationSection = {
  id: string;
  title: string;
  whatThisIs: string;
  defaultRecommendation: string;
  changeItWhen: string;
  bullets?: string[];
};

export type DocumentationPage = {
  id: string;
  title: string;
  summary: string;
  actions?: DocumentationActionId[];
  tasks?: DocumentationTask[];
  sections: DocumentationSection[];
};

export const DOCUMENTATION_ACTIONS: Record<DocumentationActionId, { label: string; description: string }> = {
  'show-shortcuts': {
    label: 'Show keyboard shortcuts',
    description: 'Open the shortcut overlay with the live bindings you use in review mode.',
  },
  'open-settings-interface': {
    label: 'Open interface settings',
    description: 'Adjust layout, sort defaults, and the folder-grouping behavior.',
  },
  'open-settings-duplicates': {
    label: 'Open duplicate settings',
    description: 'Tune similarity, sample count, keeper rules, and ignored matches.',
  },
  'open-settings-keybindings': {
    label: 'Open keybinding settings',
    description: 'Change the review, preview, and global shortcuts used in the app.',
  },
  'open-settings-cache': {
    label: 'Open cache settings',
    description: 'Choose where cache data lives and whether old cache paths are cleaned up.',
  },
  'open-settings-processing': {
    label: 'Open processing settings',
    description: 'Adjust thumbnail count, concurrency, and processing cost.',
  },
  'open-settings-about': {
    label: 'Open About settings',
    description: 'Jump to version, release, and project links from inside the app.',
  },
};

export const DOCUMENTATION_PAGES: DocumentationPage[] = [
  {
    id: 'quick-start',
    title: 'Quick Start',
    summary: 'Get from an empty session to safe deletes without guessing what to do next.',
    actions: ['open-settings-interface'],
    tasks: [
      {
        id: 'task-open-folder',
        title: 'Load a folder and start culling',
        detail: 'Open a folder, review decisions, then run delete only when the delete list looks final.',
        pageId: 'quick-start',
      },
      {
        id: 'task-filter-grid',
        title: 'Narrow the list before review',
        detail: 'Use grid filters to get to one folder, status bucket, or search result before you enter review mode.',
        pageId: 'grid-view',
      },
      {
        id: 'task-duplicates',
        title: 'Understand duplicate matches before I rerun them',
        detail: 'Use duplicate review to confirm the suggestion, then tune similarity or samples only when the results are noisy.',
        pageId: 'duplicate-review',
      },
      {
        id: 'task-processing',
        title: 'Check cache and processing cost',
        detail: 'Review where cache lives and how many thumbnails you generate before changing large libraries.',
        pageId: 'cache-processing',
      },
      {
        id: 'task-delete-safety',
        title: 'Review delete safety before cleanup',
        detail: 'Confirm what Delete means, what goes to the Recycle Bin, and when empty folders are removed.',
        pageId: 'delete-safety',
      },
    ],
    sections: [
      {
        id: 'main-workflow',
        title: 'Main workflow',
        whatThisIs: 'Video Cull is built around one boring loop: load folders, review or batch-mark videos, then run delete only after the delete queue looks correct.',
        defaultRecommendation: 'Keep the first pass simple. Load a folder, use filters only when they reduce noise, review the remaining set, and treat duplicate review as a side path that still ends in normal Keep, Delete, Skip, or Pending statuses.',
        changeItWhen: 'Use duplicate review early when your problem is repeated clips. Stay in grid view longer when the job is folder cleanup, codec triage, or status-based batching instead of clip-by-clip review.',
      },
      {
        id: 'build-session',
        title: 'Build a session',
        whatThisIs: 'A session is the current set of loaded folders plus the active filters, duplicate results, review scope, sort order, and cached decisions already saved for those folders.',
        defaultRecommendation: 'Start with one folder when you are learning the flow. Add more folders only when they belong to the same review job and you want one combined queue.',
        changeItWhen: 'Split the work into separate sessions when folders have different goals, very different codecs, or you need a clean boundary before deleting anything.',
      },
      {
        id: 'use-help',
        title: 'Use help at the right moment',
        whatThisIs: 'The in-app documentation is best used as a task guide while you work, not as a full manual you need to read front to back.',
        defaultRecommendation: 'Jump straight to the page that matches the task in front of you: grid filters, review mode, duplicate review, cache, or delete safety.',
        changeItWhen: 'Use the project docs link only when you need release notes, installation details, or material that does not need to live inside the app flow.',
      },
    ],
  },
  {
    id: 'grid-view',
    title: 'Grid View',
    summary: 'Use the grid to shrink a noisy library into a reviewable queue.',
    actions: ['open-settings-interface'],
    sections: [
      {
        id: 'filters-first',
        title: 'Filter first',
        whatThisIs: 'Grid view is where you reduce a large folder into something specific enough to review or batch-edit with confidence.',
        defaultRecommendation: 'Use search, status, folder, size, duration, duplicate, rating, favorite, and incompatible filters to get the list down before you enter review mode.',
        changeItWhen: 'Skip heavy filtering when the folder is already small or when you need a broad first pass just to mark obvious Keep and Delete choices.',
      },
      {
        id: 'sort-and-group',
        title: 'Sort and group',
        whatThisIs: 'Sorting changes which clips rise to the top. Grouping changes whether you see one mixed queue or folder buckets with their own local order.',
        defaultRecommendation: 'Stay ungrouped when you want one global queue. Turn on folder grouping when keeping folder context matters more than absolute ranking.',
        changeItWhen: 'Change sort fields only when they answer the current question. Size is useful for cleanup, date is useful for chronology, and rating only matters when that feature is enabled and already populated.',
      },
      {
        id: 'batch-actions',
        title: 'Batch actions',
        whatThisIs: 'Batch selection is the fast path for marking many rows after filtering has already isolated the right set.',
        defaultRecommendation: 'Select after filtering, apply one batch action, then keep moving. The app clears selection after the action so you do not accidentally reuse a stale batch.',
        changeItWhen: 'Drop back to per-card actions when the remaining set has mixed outcomes or when you need to inspect playback before deciding.',
      },
    ],
  },
  {
    id: 'review-mode',
    title: 'Review Mode',
    summary: 'Use review mode when keyboard-first decisions are faster than browsing the grid.',
    actions: ['show-shortcuts', 'open-settings-keybindings'],
    sections: [
      {
        id: 'when-to-use-review',
        title: 'When review mode helps',
        whatThisIs: 'Review mode turns the current scope into a one-by-one decision queue with playback, navigation, and undo built into the same flow.',
        defaultRecommendation: 'Enter review mode after the grid has already narrowed the library to the queue you actually want to judge clip by clip.',
        changeItWhen: 'Stay in the grid when you still need to search, group, compare many thumbnails at once, or batch-mark a set without opening each video.',
      },
      {
        id: 'decision-controls',
        title: 'Decision controls',
        whatThisIs: 'Keep and Delete are final review outcomes, Skip means intentionally undecided, Reset returns to Pending, and Undo reverses the most recent change without losing your place.',
        defaultRecommendation: 'Use Keep or Delete for clear decisions, Skip when you need a second pass, and Undo instead of hunting backward after a fast mistake.',
        changeItWhen: 'Reset is useful when an earlier choice should stop counting toward review progress but you do not want Skip to imply an intentional defer.',
      },
      {
        id: 'scope-and-playback',
        title: 'Scope and playback',
        whatThisIs: 'Review progress is calculated from the active scope, which can be the full session, the current filter, one folder, or one duplicate group.',
        defaultRecommendation: 'Check the scope label before you start. Use built-in playback for the normal path and open the external player only when the embedded player is not reliable enough for that clip.',
        changeItWhen: 'Change scope when progress feels wrong, when you want a folder-specific pass, or when duplicate review should stay isolated from the broader library.',
      },
    ],
  },
  {
    id: 'duplicate-review',
    title: 'Duplicate Review',
    summary: 'Treat duplicate detection as a suggestion engine, not an automatic delete tool.',
    actions: ['open-settings-duplicates'],
    sections: [
      {
        id: 'comparison-modes',
        title: 'Comparison modes',
        whatThisIs: 'Visual comparison uses sampled frames to catch near-duplicates humans would still judge as the same clip. pHash is stricter and more image-signature driven.',
        defaultRecommendation: 'Start with Visual mode for most libraries because it is the practical default for real culling work.',
        changeItWhen: 'Switch to pHash when Visual results are too broad, too inconsistent for your footage, or you need a narrower image-based match rule.',
      },
      {
        id: 'thresholds-and-samples',
        title: 'Thresholds and sample count',
        whatThisIs: 'Similarity and sample count control how wide the net is and how much evidence the matcher uses before grouping files.',
        defaultRecommendation: 'Start around 90-95% similarity with the default sample count. Lower thresholds find more candidates; higher thresholds cut noise.',
        changeItWhen: 'Raise the threshold when false positives dominate. Lower it when different encodes of the same clip are being missed. Increase samples only when the extra work is justified by better grouping.',
        bullets: [
          'More candidates usually means more manual review.',
          'Stricter matching usually means fewer noisy groups.',
        ],
      },
      {
        id: 'keepers-and-actions',
        title: 'Keeper suggestions and actions',
        whatThisIs: 'The suggested keeper is a starting point inside the group. Batch actions are for several rows at once, while right-click actions are for targeted overrides.',
        defaultRecommendation: 'Accept the suggested keeper when it already matches your judgment, then batch-mark the rest.',
        changeItWhen: 'Override the keeper or use per-row actions when filenames, folders, or encodes make a different file the better long-term source.',
      },
      {
        id: 'reruns-and-ignores',
        title: 'Reruns and ignored matches',
        whatThisIs: 'Ignored matches stay out of later duplicate runs until you clear that history in duplicate settings.',
        defaultRecommendation: 'Ignore obviously wrong matches instead of forcing a decision through them, then rerun duplicate detection after adjusting settings when the results are broadly weak.',
        changeItWhen: 'Clear ignored history only when your matching rules changed enough that old ignores are no longer trustworthy.',
      },
    ],
  },
  {
    id: 'cache-processing',
    title: 'Cache and Processing',
    summary: 'Use these settings when you need to balance portability, speed, and background work.',
    actions: ['open-settings-cache', 'open-settings-processing'],
    sections: [
      {
        id: 'cache-modes',
        title: 'Cache storage modes',
        whatThisIs: 'Centralized mode keeps cache in one place, per-drive keeps it with the drive identity, and distributed writes a `.videocull` folder beside the media.',
        defaultRecommendation: 'Use centralized cache unless you have a portability reason to move it. It is the least surprising setup for one machine and a stable library.',
        changeItWhen: 'Use per-drive when drives move between systems but still need their own cache roots. Use distributed only when portability beside the media matters more than keeping folders clean.',
      },
      {
        id: 'processing-cost',
        title: 'Processing cost',
        whatThisIs: 'Thumbnail count, concurrency, and other processing settings decide how much work each scan or rebuild does.',
        defaultRecommendation: 'Stay near the defaults unless you already know the library needs denser thumbnails or more aggressive throughput.',
        changeItWhen: 'Raise thumbnail count when you need more visual context per clip. Lower processing pressure when the machine is busy, thermally constrained, or the library is large enough that cache growth matters.',
        bullets: [
          'More thumbnails improve browsing but take longer to build.',
          'Higher concurrency can speed up work but costs CPU and I/O headroom.',
        ],
      },
      {
        id: 'when-settings-apply',
        title: 'When settings apply',
        whatThisIs: 'Some settings change the renderer immediately, while settings that affect stored files or generated outputs usually apply on the next scan, duplicate run, or rebuild.',
        defaultRecommendation: 'Assume cache layout, duplicate tuning, and thumbnail-generation changes are forward-looking unless the UI explicitly tells you they take effect now.',
        changeItWhen: 'Treat a settings change as immediate only when it is purely visual or the app says the current session has already updated.',
      },
    ],
  },
  {
    id: 'delete-safety',
    title: 'Delete and Safety',
    summary: 'Delete is a deliberate final step, not a side effect of reviewing.',
    sections: [
      {
        id: 'mark-vs-delete',
        title: 'Marking vs. deleting',
        whatThisIs: 'Marking a video as Delete changes session state only. No file leaves disk until you explicitly run the delete action for the current Delete set.',
        defaultRecommendation: 'Use Delete as a review label first, then run the delete batch only after the queue is stable and you have reviewed the scope you care about.',
        changeItWhen: 'Do smaller delete batches when you are learning the app or when the session spans multiple folders with different risk levels.',
      },
      {
        id: 'recycle-bin',
        title: 'Recycle Bin behavior',
        whatThisIs: 'The app prefers the OS Recycle Bin. If that path is unavailable, it warns before a permanent fallback is used.',
        defaultRecommendation: 'Read delete confirmations instead of clicking through them. Recycle Bin is the normal path, and a permanent fallback deserves extra attention.',
        changeItWhen: 'Stop and verify the selection if the app warns about permanent deletion or if the delete size looks larger than expected.',
      },
      {
        id: 'empty-folder-cleanup',
        title: 'Empty-folder cleanup',
        whatThisIs: 'Optional cleanup removes folders that become completely empty after deletion.',
        defaultRecommendation: 'Leave empty-folder cleanup off unless you want folder pruning as part of the same operation.',
        changeItWhen: 'Turn it on when the point of the job is reclaiming storage and cleaning structure at the same time. Leave it off when empty placeholders or folder history still matter.',
      },
    ],
  },
  {
    id: 'faq',
    title: 'FAQ',
    summary: 'Answers to the short questions that come up during normal sessions.',
    actions: ['open-settings-about'],
    sections: [
      {
        id: 'supported-formats',
        title: 'Which video formats are supported?',
        whatThisIs: 'Metadata scanning is usually broader than embedded playback because ffprobe support and the in-app player stack are not identical.',
        defaultRecommendation: 'Assume a file can often be scanned and thumbnailed even when it does not play perfectly inside the renderer.',
        changeItWhen: 'Use the external player path when playback compatibility matters more than staying inside the built-in player.',
      },
      {
        id: 'external-player',
        title: 'Why are some videos opened in the external player?',
        whatThisIs: 'Some files have codecs or containers that the app can inspect but not play reliably enough in the embedded player.',
        defaultRecommendation: 'Treat the external player as a fallback, not as a failed review state. It lets you keep the same session and decision flow.',
        changeItWhen: 'If too many files need the external player, review codec patterns in the library before assuming the app is misbehaving.',
      },
      {
        id: 'move-cache',
        title: 'How do I move cache to a new drive?',
        whatThisIs: 'Cache movement is done from cache settings, where the app can migrate existing cache roots or let the next scan start fresh.',
        defaultRecommendation: 'Choose migration when the existing cache is still valuable and the source drive is available during the move.',
        changeItWhen: 'Start fresh when the old cache is disposable, outdated, or the original drive is not available for a clean migration.',
      },
    ],
  },
];
