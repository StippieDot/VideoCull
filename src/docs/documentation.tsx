import type { ReactNode } from 'react';

export type DocumentationPage = {
  id: string;
  title: string;
  content: ReactNode;
};

export const DOCUMENTATION_GITHUB_URL = 'https://github.com/stippie-dot/VideoCull';

export const DOCUMENTATION_PAGES: DocumentationPage[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    content: (
      <>
        <section>
          <h4>What is Video Cull?</h4>
          <p>Video Cull is a folder-first video triage tool for sorting large libraries into keep, delete, skipped, and pending decisions.</p>
          <p>It is designed around real culling work: scan a folder, narrow the list in the grid, review quickly, and only delete when you are ready.</p>
        </section>

        <section>
          <h4>Opening folders and building a session</h4>
          <p>Use the sidebar, the empty state, drag and drop, or recent folders to open a directory. If you already have a session open, you can add another folder instead of replacing it.</p>
          <p>Session state is built from the folders you load plus the current filters, sort order, duplicate settings, and review scope.</p>
        </section>

        <section>
          <h4>The main workflow: scan → review → delete</h4>
          <p>Most sessions follow the same order. First scan and generate metadata, then review or filter until your decisions are stable, and only then run the delete step for videos marked as Delete.</p>
          <p>Duplicate review is a side workflow inside the same session. It helps you decide which files should be kept, but it still uses the same status system instead of deleting immediately.</p>
        </section>
      </>
    ),
  },
  {
    id: 'grid-view',
    title: 'Grid View',
    content: (
      <>
        <section>
          <h4>Filtering, sorting, and grouping</h4>
          <p>Grid view is the main place to narrow a session before review. Use search, status filters, size and duration filters, duplicate filters, ratings, favorites, and incompatible filtering to focus the list.</p>
          <p>Sort by the current field that best matches the job, and toggle folder grouping when you want to review one folder at a time instead of the mixed library view.</p>
        </section>

        <section>
          <h4>Card actions and context menus</h4>
          <p>Each card shows the current status and can open playback or review actions without leaving the grid. Context menus are for file-level actions, while normal card controls handle preview and status changes.</p>
          <p>When grouped by folder, the folder header also exposes folder-scoped actions such as starting review from that folder.</p>
        </section>

        <section>
          <h4>Batch selection</h4>
          <p>Selection mode is checkbox-first. Click to select, Shift+click to extend a range from the current anchor, and then use the bottom action bar to mark the whole batch as Keep, Delete, Skip, or Reset.</p>
          <p>Batch actions update video status in one pass and then clear the selection so you can continue browsing without stale checked rows.</p>
        </section>
      </>
    ),
  },
  {
    id: 'review-mode',
    title: 'Review Mode',
    content: (
      <>
        <section>
          <h4>Keyboard shortcuts</h4>
          <p>Review mode is built for keyboard-first culling. Use your configured Keep, Delete, Skip, Reset, Undo, and Play shortcuts to work through the current queue without going back to the grid after every item.</p>
          <p>Navigation, seeking, speed changes, bookmarks, external-player opening, next-undecided, search, and global mute also follow the app's current shortcut settings.</p>
          <p>If you changed shortcuts in Settings, this page describes the same actions you already use in the app; there is no separate documentation-only shortcut scheme to learn.</p>
        </section>

        <section>
          <h4>Playback, bookmarks, and external player fallback</h4>
          <p>Built-in playback handles the normal review path, including play or pause, seeking, playback speed, and bookmarks. Bookmarks are useful when you want to revisit a specific moment before making the final keep or delete call.</p>
          <p>If a codec or container does not play reliably in the embedded player, open the file in the external player from review mode and continue the decision there.</p>
        </section>

        <section>
          <h4>Scope, progress, and decision flow</h4>
          <p>The scope label tells you what you are actually reviewing: the whole session, the current filter, one folder, or one duplicate group. That matters because progress and completion are calculated against the active scope, not the whole library.</p>
          <p>Keep and Delete are final status choices, Skip leaves the video intentionally undecided, Reset returns it to Pending, and Undo reverses the last decision so you can correct fast mistakes without losing your place.</p>
        </section>
      </>
    ),
  },
  {
    id: 'duplicate-review',
    title: 'Duplicate Review',
    content: (
      <>
        <section>
          <h4>Visual vs. pHash</h4>
          <p>Visual mode is the practical default for most libraries because it compares sampled frames and catches near-duplicates that are still obviously the same clip to a human reviewer.</p>
          <p>pHash is useful when you want a stricter image-based comparison and Visual is either too broad or not consistent enough for the material you are reviewing.</p>
        </section>

        <section>
          <h4>Similarity, sample count, and recommended starting points</h4>
          <p>Start with Visual similarity, a threshold around 90-95%, and the default sample count unless you already know your library needs stricter or broader matching.</p>
          <p>Lower thresholds surface more candidates but increase false positives. Higher thresholds reduce noise but can miss real duplicates, especially across different encodes.</p>
        </section>

        <section>
          <h4>Suggested keeper, right-click actions, and batch actions</h4>
          <p>Use checkboxes for batch actions and right-click for per-video actions.</p>
          <p>The suggested keeper is the app's best default inside the group, but it is still a suggestion. You can keep it, change it, or mark statuses manually before leaving the group.</p>
          <p>Batch actions are for applying the same status to several rows quickly. Right-click actions are for targeted fixes such as changing the keeper or marking one item differently from the rest.</p>
        </section>

        <section>
          <h4>Ignored matches and reruns</h4>
          <p>Use ignore actions when a pair or group is not a real match. Ignored matches stay out of later duplicate runs until you clear that history from the duplicate settings.</p>
          <p>When the results are too broad or too narrow, rerun detection after adjusting similarity, sample count, or comparison mode instead of forcing decisions through a weak group.</p>
        </section>
      </>
    ),
  },
  {
    id: 'cache-processing',
    title: 'Cache and Processing',
    content: (
      <>
        <section>
          <h4>Cache storage modes</h4>
          <p>Video Cull can store cache data in centralised, per-drive, or distributed mode. Centralised keeps everything in one place, per-drive lets cache travel with the drive, and distributed places a `.videocull` folder next to the media for maximum portability.</p>
          <p>Changing cache mode is a real migration choice, not just a cosmetic setting. Use migration when you want to preserve work, or start fresh when you intentionally want the next scan to rebuild cache data.</p>
        </section>

        <section>
          <h4>Thumbnail generation settings</h4>
          <p>Processing settings control how many thumbnails are generated, how much parallel work runs at once, and how aggressively the app spends CPU time during scans and metadata work.</p>
          <p>Higher thumbnail counts and broader duplicate processing improve browsing and comparison detail, but they also increase scan time, cache size, and background work.</p>
        </section>

        <section>
          <h4>Which settings apply now vs. next run</h4>
          <p>Some preferences take effect immediately in the renderer, but cache layout, duplicate-processing changes, thumbnail regeneration settings, and similar heavy options apply on the next relevant scan, duplicate run, or rebuild.</p>
          <p>When in doubt, assume settings that touch stored files or generated media are forward-looking and will affect the next processing pass instead of rewriting everything instantly.</p>
        </section>
      </>
    ),
  },
  {
    id: 'delete-safety',
    title: 'Delete and Safety',
    content: (
      <>
        <section>
          <h4>Marking vs. deleting</h4>
          <p>Marking a video as Delete is just a library decision. Nothing is removed from disk until you explicitly run the delete action for the files currently marked that way.</p>
          <p>This separation is intentional. It gives you time to review the session, change mistakes, and confirm the final delete batch only when you are comfortable with the result.</p>
        </section>

        <section>
          <h4>Recycle Bin behavior</h4>
          <p>Video Cull prefers sending files to the OS Recycle Bin instead of permanently deleting them. If the Recycle Bin path is not available for a specific file operation, the app warns before moving to a permanent fallback.</p>
          <p>Deletion is also restricted to paths inside the folders currently loaded in the session, which prevents out-of-scope files from being removed by mistake.</p>
        </section>

        <section>
          <h4>Empty-folder cleanup</h4>
          <p>If you enable empty-folder cleanup, folders left completely empty after deletion can be removed as part of the cleanup pass.</p>
          <p>Leave this off if you use placeholder folders or need to preserve folder structure even when the current contents have all been deleted.</p>
        </section>
      </>
    ),
  },
  {
    id: 'faq',
    title: 'FAQ',
    content: (
      <>
        <section>
          <h4>Which video formats are supported?</h4>
          <p>Video Cull is built around common local video files and whatever the installed ffprobe and embedded playback stack can scan or decode on your machine. In practice, metadata scanning is broader than built-in playback support.</p>
        </section>

        <section>
          <h4>Why are some videos opened in the external player?</h4>
          <p>Some files can be scanned and thumbnailed correctly but still fail built-in playback because of codec or container limitations. When that happens, the external player path lets you keep reviewing the same file without losing your place in the session.</p>
        </section>

        <section>
          <h4>How do I move cache to a new drive?</h4>
          <p>If you are using centralised or per-drive cache, change the cache location in Settings and choose whether to migrate existing cache or start fresh. If you are moving away from distributed mode, keep the drive connected so the app can find the recorded cache paths during migration.</p>
        </section>
      </>
    ),
  },
];
