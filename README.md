# Video Cull

> Tear through a massive video library in minutes. No cloud. No account. Just you, your files, and a keyboard.

You've got a folder full of videos: dashcam clips, drone footage, years of random stuff you never sorted. Opening each one in VLC is not a workflow. Video Cull is.

Point it at a folder. It scans everything, generates thumbnail strips, and gives you a keyboard-driven interface to decide what stays and what goes. When thumbnails aren't enough, hit play and scrub through it right there. Mark, rate, favorite, move on, repeat.

When you're done, one command sends everything marked for deletion to the Recycle Bin when possible. Nothing is permanently gone unless you confirm it.

---

## Screenshots

| Landing | Grid |
|---|---|
| ![Landing page](docs/screenshots/V1.4.0%20-%20Landing%20Page.png) | ![Grid view](docs/screenshots/V1.4.0%20-%20GridView.png) |

| Review Mode |
|---|
| ![Review mode](docs/screenshots/v1.4.0%20-%20ReviewMode.png) |

---

## Download

Grab the latest installer from the [Releases](https://github.com/stippie-dot/VideoCull/releases) page.

Installs for the current user, no admin rights needed. On first launch Windows may show a SmartScreen prompt since the app isn't code-signed yet; click "Run anyway" to proceed.

---

## Features

### Grid View

Every video gets a strip of thumbnails pulled from different points in the file. You know what you're looking at without opening anything.

- Adjustable card size (`Ctrl++` / `Ctrl+-`)
- Group by subfolder with per-folder counts and sizes
- Filter by status, rating, favorites, compatibility, file size, and duration
- Sort by name, size, duration, date, rating, resolution, or FPS
- Codec, resolution, FPS, favorite, rating, and compatibility badges
- Batch selection with Keep, Delete, Skip, Reset, Clear, and Regenerate Thumbnails actions
- Per-folder Review button to scope review mode to one folder
- Drag and drop folder opening, multi-directory sessions
- Recent directories with timestamps, stale-entry auto-cleanup
- Privacy screen toggle (`Shift+Esc`)

### Review Mode

Fullscreen, one at a time, keyboard first.

- Thumbnail strip with dynamic aspect ratio
- In-app player with scrubbing, playback speed, bookmarks, and global mute
- Ratings and favorites directly on the current video
- Review summary with pending counts and delete totals
- Next-undecided navigation for skipping videos you've already handled
- External player handoff for files the built-in player should not play
- Undo any decision before you commit the final delete

### Thumbnail Generation

- **Configurable frame count**: 1, 2, 4, 6, or 9 thumbnails per video (default: 6)
- **Intro skip**: first frame offset by a configurable delay to avoid black fades (default: 3s)
- **Parallel processing**: RAM and CPU-aware auto-detect, or set manually up to 32 processes
- **Cached**: already-processed videos are skipped on rescan when their thumbnail set is complete
- **Hardware acceleration**: optional GPU decoding (beta)

### Cache

Progress lives in SQLite databases under the configured cache location.

- Three location modes: Centralised (default), Per-drive, Distributed (`.videocull` next to your files)
- Old flat-root DBs and legacy `.video-cull-cache.json` files are migrated automatically on first scan
- Status, ratings, favorites, bookmarks, metadata, and thumbnails survive rescans
- Cache and thumbnail files for deleted videos are cleaned up with the delete action

### Export

Generate an HTML report from Settings or the app menu, scoped to all videos or filtered results, grouped by folder with separate Keep/Delete/Pending/Skipped sections.

---

## Keyboard Shortcuts

### Grid and General

| Shortcut | Action |
|----------|--------|
| `Ctrl + O` | Open directory |
| `F5` | Rescan |
| `Ctrl + Z` | Undo |
| `Ctrl + Backspace` | Send marked videos to Recycle Bin |
| `Ctrl + Shift + R` | Clear thumbnail cache |
| `Ctrl + E` | Reveal in Explorer |
| `Ctrl + +` / `Ctrl + -` | Zoom cards |
| `F11` | Toggle fullscreen |
| `?` | Keyboard shortcuts reference |
| `Shift + Esc` | Toggle privacy screen |

### Review Mode

| Shortcut | Action |
|----------|--------|
| `K` | Keep |
| `D` | Mark for deletion |
| `S` | Skip |
| `Z` | Undo |
| `Space` | Play / pause |
| `Left` / `Right` | Previous / next video, or scrub 5s while playing |
| `Tab` | Next undecided video |
| `Enter` | Play in-app |
| `Ctrl + Enter` | Open in external player |
| `B` | Drop bookmark |
| `[` / `]` | Playback speed down / up |
| `Esc` | Stop / exit review |

Review shortcuts are customizable in Settings.

---

## Settings

| Setting | Options | Default |
|---------|---------|---------|
| Cache location | Centralised / Per-drive / Distributed | Centralised |
| Thumbnails per video | 1, 2, 4, 6, 9 | 6 |
| Default card scale | 0.5x - 2.0x | 1.0x |
| Default sort | Name / Size / Date / Duration / Rating / Resolution / FPS | Name |
| Group by folder | On / Off | On |
| Parallel FFmpeg processes | Auto (RAM + CPU aware) / 1 / 2 / 3 / 4 / 6 / 8 / 12 / 16 / 24 / 32 | Auto |
| Limit each FFmpeg process to 1 CPU thread | On / Off | On |
| Intro skip delay | 0 - 60 seconds | 3s |
| Hardware acceleration | On / Off | On |
| Auto updates | On / Off | On |
| Feature toggles | Ratings, favorites, codec badges, compatibility checks, global mute, next-undecided | On |
| Keybindings | Any key or combination | K / D / S / Z / Space |

---

## Supported Formats

Video Cull generates thumbnails and metadata with FFmpeg, so it can inspect many common video formats.

The built-in player is intended for compatible web-playable media such as `.mp4`, `.webm`, `.mov`, `.mkv`, `.m4v`, and `.ogv` when the underlying codecs are supported. Legacy or unsupported formats such as `.avi`, `.wmv`, `.asf`, `.flv`, `.ts`, `.mts`, and `.mpeg` open in your default system player instead.

---

## Building from Source

Requires Node.js 20+. FFmpeg and FFprobe are bundled.

```bash
git clone https://github.com/stippie-dot/VideoCull.git
cd VideoCull
npm install
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + Electron with hot reload |
| `npm run build` | Renderer-only production build |
| `npm run check:ipc` | Validate preload/type IPC contract coverage |
| `npm run cleanup:cache` | Clean old cache/thumb clutter from earlier builds |
| `npm run package` | Full build + Windows installer (NSIS) |
| `npm run rebuild` | Rebuild native modules against Electron |

---

## Stack

[Electron](https://www.electronjs.org/) - [React](https://react.dev/) - [Video.js](https://videojs.com/) - [FFmpeg](https://ffmpeg.org/) - [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - [Zustand](https://github.com/pmndrs/zustand) - [TypeScript](https://www.typescriptlang.org/) - [Vite](https://vitejs.dev/)

---

## Star History

<a href="https://www.star-history.com/?repos=stippie-dot%2FVideoCull&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=stippie-dot/VideoCull&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=stippie-dot/VideoCull&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=stippie-dot/VideoCull&type=date&legend=top-left" />
 </picture>
</a>

---

## License

[GNU Affero General Public License v3.0](LICENSE)
