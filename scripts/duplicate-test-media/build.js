// Builds a small labelled collection of test videos for duplicate detection: four openly licensed
// seed clips (downloaded once, pinned by hash) plus re-encoded, padded, shifted, trimmed, damaged and
// generated variants, with a manifest of the expected relations.
// Usage: node scripts/duplicate-test-media/build.js <folder>   (or set VIDEOCULL_TEST_MEDIA)
// Writes <folder>/downloads and <folder>/out. No media belongs in the repository.
// The same seeds and FFmpeg build give the same pictures and sound; bytes can differ between builds.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ffmpegPath: FFMPEG, ffprobePath: FFPROBE } = require('../../electron/media-tools');

const ROOT = process.argv[2] || process.env.VIDEOCULL_TEST_MEDIA;
if (!ROOT) {
  console.error('Usage: node scripts/duplicate-test-media/build.js <folder>');
  process.exit(1);
}
const DL = path.join(ROOT, 'downloads');
const OUT = path.join(ROOT, 'out');

// Source and licence of every downloaded seed. The hash pins the exact file.
const SEEDS = {
  sintel: {
    file: 'sintel_trailer-480p.mp4',
    url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
    licence: 'CC BY 3.0, (c) Blender Foundation | durian.blender.org',
    sha256: 'b670602fa00934ca27c4351bb0efe7ea7a07fae57284e44226025eeed7c51254',
  },
  bbb: {
    file: 'trailer_480p.mov',
    url: 'https://download.blender.org/peach/trailer/trailer_480p.mov',
    licence: 'CC BY 3.0, (c) Blender Foundation | peach.blender.org',
    sha256: '36801b74638c12be9aa587e93cd18edfc9bc51a1c089ab2a19ee42beed9f497d',
  },
  schloss: {
    file: 'Schlossbergbahn.webm',
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/87/Schlossbergbahn.webm',
    licence: 'CC0 1.0 (Wikimedia Commons, File:Schlossbergbahn.webm)',
    sha256: 'a105e0cf59fb2b10d87778b273cd83bdd8afe3a45ad455c869d2fbd9e0db8927',
  },
  dream: {
    file: 'ed_1024_512kb.mp4',
    url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
    licence: 'CC BY 2.5, (c) Blender Foundation / Netherlands Media Art Institute, www.elephantsdream.org (archive.org item ElephantsDream lists CC BY 3.0 US)',
    sha256: 'fd6dc0e9da3a2f63487957325983f197f23c6ff1cd2b29bb71e64db567e0994c',
  },
};

const seed = (name) => path.join(DL, SEEDS[name].file);
const out = (name) => path.join(OUT, name);
const BITEXACT = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact'];
const X264 = (crf) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-threads', '1'];
const AAC = ['-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '2'];
const MP4 = ['-movflags', '+faststart'];

const manifest = [];
let failed = 0;

function ffmpeg(args, name) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args, ...BITEXACT, out(name)], { windowsHide: true });
  if (result.status !== 0) {
    failed++;
    console.log(`ERR ${name}\n${String(result.stderr).slice(-600)}`);
    return false;
  }
  return true;
}

// expect: relation of this file to its seed. 'exact' | 'sameSpan' | 'partial'.
function add(name, seedName, transform, expect, extra = {}) {
  manifest.push({ file: name, seed: seedName, transform, expect, ...extra });
}

function make(name, seedName, transform, expect, args, extra) {
  if (ffmpeg(args, name)) add(name, seedName, transform, expect, extra);
}

async function fetchSeeds() {
  fs.mkdirSync(DL, { recursive: true });
  for (const info of Object.values(SEEDS)) {
    const file = path.join(DL, info.file);
    if (!fs.existsSync(file)) {
      console.log(`Downloading ${info.file}`);
      const response = await fetch(info.url);
      if (!response.ok) throw new Error(`${info.url} returned ${response.status}`);
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (hash !== info.sha256) throw new Error(`${info.file} does not match the recorded hash; delete it and run again`);
  }
}

function sintelVariants() {
  const src = ['-i', seed('sintel')];
  const both = [...AAC, ...MP4];
  fs.copyFileSync(seed('sintel'), out('sintel.mp4'));
  add('sintel.mp4', 'sintel', 'seed (854x480, 24 fps, 52.2 s, speech and music)', 'exact');
  fs.copyFileSync(seed('sintel'), out('sintel__copy.mp4'));
  add('sintel__copy.mp4', 'sintel', 'byte copy', 'exact');

  make('sintel__remux.mkv', 'sintel', 'container change, streams copied', 'sameSpan', [...src, '-c', 'copy']);
  make('sintel__faststart.mp4', 'sintel', 'streams copied, index moved to the front', 'sameSpan', [...src, '-c', 'copy', ...MP4]);
  make('sintel__crf32.mp4', 'sintel', 're-encode, lower quality', 'sameSpan', [...src, ...X264(32), ...both]);
  make('sintel__240p.mp4', 'sintel', 'downscale to 426x240', 'sameSpan', [...src, '-vf', 'scale=426:240', ...X264(26), ...both]);
  make('sintel__mpeg4.avi', 'sintel', 'other codecs (MPEG-4 part 2, MP2 audio)', 'sameSpan',
    [...src, '-c:v', 'mpeg4', '-q:v', '5', '-threads', '1', '-c:a', 'mp2', '-b:a', '128k']);
  make('sintel__fps30.mp4', 'sintel', '24 to 30 fps', 'sameSpan', [...src, '-vf', 'fps=30', ...X264(24), ...both]);
  make('sintel__flip.mp4', 'sintel', 'mirrored', 'sameSpan', [...src, '-vf', 'hflip', ...X264(24), ...both],
    { needs: 'compareFlipped' });

  // Borders and aspect ratio
  make('sintel__letterbox.mp4', 'sintel', 'black bars top and bottom (854x640)', 'sameSpan',
    [...src, '-vf', 'pad=854:640:0:80:black', ...X264(24), ...both], { tests: 'border' });
  make('sintel__pillarbox.mp4', 'sintel', 'black bars left and right (1138x480)', 'sameSpan',
    [...src, '-vf', 'pad=1138:480:142:0:black', ...X264(24), ...both], { tests: 'border' });
  make('sintel__stretched43.mp4', 'sintel', 'stretched to 640x480 (wrong aspect ratio)', 'sameSpan',
    [...src, '-vf', 'scale=640:480,setsar=1', ...X264(24), ...both], { tests: 'aspect' });

  // Timing, same span
  make('sintel__shift05.mp4', 'sintel', '0.5 s removed at the start', 'sameSpan',
    ['-ss', '0.5', ...src, ...X264(24), ...both], { tests: 'timing' });
  make('sintel__shift08_tail.mp4', 'sintel', '0.8 s removed at the start, 0.5 s black added at the end', 'sameSpan',
    ['-ss', '0.8', ...src, '-vf', 'tpad=stop_duration=0.5:color=black', '-af', 'apad=pad_dur=0.5', ...X264(24), ...both],
    { tests: 'timing' });

  // Picture quality cases for the keeper and the picture-detail experiment
  const noBetter = 'must not beat sintel.mp4 on picture detail';
  make('sintel__upscaled.mp4', 'sintel', 'upscaled to 1708x960, high bitrate', 'sameSpan',
    [...src, '-vf', 'scale=1708:960:flags=lanczos', ...X264(18), ...both], { tests: 'detail', keeper: noBetter });
  make('sintel__upscaled_sharp.mp4', 'sintel', 'upscaled to 1708x960 and sharpened', 'sameSpan',
    [...src, '-vf', 'scale=1708:960:flags=lanczos,unsharp=5:5:1.5', ...X264(18), ...both], { tests: 'detail', keeper: noBetter });
  make('sintel__upscaled_noisy.mp4', 'sintel', 'upscaled to 1708x960 with added noise', 'sameSpan',
    [...src, '-vf', 'scale=1708:960:flags=lanczos,noise=alls=12:allf=t:all_seed=1', ...X264(18), '-maxrate', '6M', '-bufsize', '12M', ...both], { tests: 'detail', keeper: noBetter });
  make('sintel__heavy.mp4', 'sintel', 'heavily compressed at the original size', 'sameSpan',
    [...src, ...X264(42), ...both], { tests: 'detail' });
  make('sintel__dim.mp4', 'sintel', 'darkened, low contrast', 'sameSpan',
    [...src, '-vf', 'eq=brightness=-0.3:contrast=0.5', ...X264(24), ...both],
    { tests: 'flat-guard', note: 'must still match sintel__dim_crf32.mp4; a match with sintel.mp4 is measured, not required' });
  make('sintel__dim_crf32.mp4', 'sintel', 'darkened, low contrast, re-encoded', 'sameSpan',
    ['-i', out('sintel__dim.mp4'), ...X264(32), ...both], { tests: 'flat-guard' });

  // Audio
  make('sintel__audio_mp2.mkv', 'sintel', 'video copied, audio re-encoded to MP2 64 kbit/s', 'sameSpan',
    [...src, '-c:v', 'copy', '-c:a', 'mp2', '-b:a', '64k'], { tests: 'audio' });
  make('sintel__audio_low.mp4', 'sintel', 'video copied, audio AAC 32 kbit/s mono 22 kHz', 'sameSpan',
    [...src, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '32k', '-ar', '22050', '-ac', '1', ...MP4], { tests: 'audio' });
  make('sintel__noaudio.mp4', 'sintel', 'audio stream removed', 'sameSpan',
    [...src, '-c:v', 'copy', '-an', ...MP4], { tests: 'keeper-audio', keeper: 'never suggested over a copy with sound' });
  make('sintel__silent.mp4', 'sintel', 'audio replaced by silence', 'sameSpan',
    [...src, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...AAC, '-shortest', ...MP4],
    { tests: 'audio-silent' });

  // Different length: partial clips
  make('sintel__clip_10_30.mp4', 'sintel', 'excerpt 10-30 s, re-encoded', 'partial',
    ['-ss', '10', '-t', '20', ...src, '-vf', 'scale=640:360', ...X264(26), ...both],
    { segments: [{ clipStart: 0, sourceStart: 10, length: 20 }] });
  make('sintel__head_cut.mp4', 'sintel', 'first 6 s removed', 'partial',
    ['-ss', '6', ...src, ...X264(24), ...both],
    { segments: [{ clipStart: 0, sourceStart: 6, length: 46.2 }], note: 'inside the 20 % duration tolerance; must not be reported as the same span' });
  make('sintel__tail_cut.mp4', 'sintel', 'only the first 36 s', 'partial',
    ['-t', '36', ...src, ...X264(24), ...both], { segments: [{ clipStart: 0, sourceStart: 0, length: 36 }] });
  make('sintel__clip_letterbox.mp4', 'sintel', 'excerpt 20-40 s, downscaled and letterboxed', 'partial',
    ['-ss', '20', '-t', '20', ...src, '-vf', 'scale=426:240,pad=426:320:0:40:black', ...X264(26), ...both],
    { segments: [{ clipStart: 0, sourceStart: 20, length: 20 }], tests: 'border' });
  make('sintel__clip_newaudio.mp4', 'sintel', 'excerpt 15-35 s with the sound of another film', 'partial',
    ['-ss', '15', '-t', '20', ...src, '-t', '20', '-i', seed('bbb'), '-map', '0:v', '-map', '1:a', ...X264(24), ...both],
    { segments: [{ clipStart: 0, sourceStart: 15, length: 20 }], note: 'visual evidence only; its sound matches bbb.mov at 0 s, which must not become a confirmed relation with bbb.mov' });
}

// Truncation and a zeroed range simulate interrupted copies and damaged storage.
function damagedVariants() {
  const damaged = { tests: 'damage', keeper: 'never suggested over an undamaged copy' };
  const cut = (from, name, fraction, transform) => {
    const data = fs.readFileSync(out(from));
    fs.writeFileSync(out(name), data.subarray(0, Math.floor(data.length * fraction)));
    add(name, 'sintel', transform, 'sameSpan', { ...damaged, note: 'expected only when enough samples decode' });
  };
  if (fs.existsSync(out('sintel__faststart.mp4'))) {
    cut('sintel__faststart.mp4', 'sintel__trunc90.mp4', 0.9, 'MP4 cut off at 90 % of its bytes');
    cut('sintel__faststart.mp4', 'sintel__trunc60.mp4', 0.6, 'MP4 cut off at 60 % of its bytes');
    const data = Buffer.from(fs.readFileSync(out('sintel__faststart.mp4')));
    data.fill(0, Math.floor(data.length * 0.45), Math.floor(data.length * 0.55));
    fs.writeFileSync(out('sintel__hole.mp4'), data);
    add('sintel__hole.mp4', 'sintel', 'MP4 with 45-55 % of its bytes zeroed', 'sameSpan', { ...damaged, note: 'middle sample expected unreadable or wrong' });
  }
  if (fs.existsSync(out('sintel__remux.mkv'))) {
    cut('sintel__remux.mkv', 'sintel__trunc60.mkv', 0.6, 'Matroska cut off at 60 % of its bytes');
  }
}

function otherSeeds() {
  fs.copyFileSync(seed('bbb'), out('bbb.mov'));
  add('bbb.mov', 'bbb', 'seed (853x480, 25 fps, 33 s, music)', 'exact');
  make('bbb__crf30.mp4', 'bbb', 're-encode', 'sameSpan', ['-i', seed('bbb'), '-vf', 'scale=852:480', ...X264(30), ...AAC, ...MP4]);

  fs.copyFileSync(seed('schloss'), out('schloss.webm'));
  add('schloss.webm', 'schloss', 'seed (1440x1080 VP8, 12 s, camera footage)', 'exact');
  make('schloss__720.mp4', 'schloss', 'H.264 at 960x720', 'sameSpan',
    ['-i', seed('schloss'), '-vf', 'scale=960:720', ...X264(24), ...AAC, ...MP4]);

  fs.copyFileSync(seed('dream'), out('dream.mp4'));
  add('dream.mp4', 'dream', 'seed (426x240, 654 s, speech, effects and music)', 'exact');
  make('dream__crf30.mp4', 'dream', 're-encode', 'sameSpan', ['-i', seed('dream'), ...X264(30), ...AAC, ...MP4]);
  make('dream__clip_120_180.mp4', 'dream', 'excerpt 120-180 s', 'partial',
    ['-ss', '120', '-t', '60', '-i', seed('dream'), ...X264(28), ...AAC, ...MP4],
    { segments: [{ clipStart: 0, sourceStart: 120, length: 60 }] });
  make('dream__two_segments.mp4', 'dream', 'two excerpts joined: 30-50 s and 250-270 s', 'partial',
    ['-i', seed('dream'), '-filter_complex',
      '[0:v]trim=30:50,setpts=PTS-STARTPTS[v0];[0:a]atrim=30:50,asetpts=PTS-STARTPTS[a0];'
      + '[0:v]trim=250:270,setpts=PTS-STARTPTS[v1];[0:a]atrim=250:270,asetpts=PTS-STARTPTS[a1];'
      + '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
      '-map', '[v]', '-map', '[a]', ...X264(28), ...AAC, ...MP4],
    { segments: [{ clipStart: 0, sourceStart: 30, length: 20 }, { clipStart: 20, sourceStart: 250, length: 20 }] });
}

function generated() {
  const lavfi = (graph) => ['-f', 'lavfi', '-i', graph];
  const tone = lavfi('sine=frequency=440:sample_rate=44100');
  const silence = lavfi('anullsrc=r=44100:cl=stereo');
  const av = ['-map', '0:v', '-map', '1:a', ...X264(24), ...AAC, ...MP4];

  // Unrelated pictures that share one soundtrack: the audio matches, the videos are not related.
  make('music_a.mp4', 'music_a', 'generated picture with the soundtrack of bbb.mov', 'exact',
    [...lavfi('mandelbrot=s=640x360:r=25'), '-i', seed('bbb'), '-t', '33', ...av]);
  make('music_b.mp4', 'music_b', 'another generated picture with the soundtrack of bbb.mov', 'exact',
    [...lavfi('testsrc2=s=640x360:r=25,hue=h=90'), '-i', seed('bbb'), '-t', '33', ...av]);
  make('dream_audio_other_picture.mp4', 'dream_audio_other_picture', 'generated picture with the sound of dream 120-180 s', 'exact',
    [...lavfi('mandelbrot=s=426x240:r=25:start_scale=2'), '-ss', '120', '-t', '60', '-i', seed('dream'), '-t', '60', ...av]);

  // Static content
  make('static_a.mp4', 'static_a', 'still picture, 60 s', 'exact', [...lavfi('smptebars=s=640x360:r=25'), ...tone, '-t', '60', ...av]);
  make('static_a__crf36.mp4', 'static_a', 're-encode of a still picture', 'sameSpan',
    ['-i', out('static_a.mp4'), ...X264(36), ...AAC, ...MP4], { tests: 'static' });
  make('static_b.mp4', 'static_b', 'a different still picture, 60 s', 'exact', [...lavfi('pal75bars=s=640x360:r=25'), ...tone, '-t', '60', ...av]);
  make('static_c.mp4', 'static_c', 'still picture of static_a with one changed area (two slides of one lecture)', 'exact',
    [...lavfi('smptebars=s=640x360:r=25,drawbox=x=200:y=120:w=240:h=80:color=white:t=fill'), ...tone, '-t', '60', ...av]);

  // Uniform frames exactly at the default sample positions (25, 50, 75 % of 40 s)
  const flat = "drawbox=x=0:y=0:w=iw:h=ih:color=0x808080:t=fill:enable='between(t,8,12)+between(t,18,22)+between(t,28,32)'";
  make('flat_a.mp4', 'flat_a', 'moving picture with grey passages at 10, 20 and 30 s', 'exact',
    [...lavfi(`testsrc2=s=640x360:r=25,${flat}`), ...tone, '-t', '40', ...av]);
  make('flat_b.mp4', 'flat_b', 'different moving picture with the same grey passages', 'exact',
    [...lavfi(`mandelbrot=s=640x360:r=25,${flat}`), ...tone, '-t', '40', ...av]);

  // Unrelated videos whose audio tracks are both silent
  make('silent_a.mp4', 'silent_a', 'generated picture, silent audio track', 'exact',
    [...lavfi('gradients=s=640x360:r=25:seed=3'), ...silence, '-t', '30', ...av]);
  make('silent_b.mp4', 'silent_b', 'different generated picture, silent audio track', 'exact',
    [...lavfi('life=s=640x360:r=25:mold=10:ratio=0.1:seed=7'), ...silence, '-t', '30', ...av]);
}

// Pairs of different seeds that must never be reported as related, and why each is hard.
const NEGATIVES = [
  ['music_a.mp4', 'music_b.mp4', 'same soundtrack and length, unrelated pictures'],
  ['music_a.mp4', 'bbb.mov', 'same soundtrack and length, unrelated pictures'],
  ['music_b.mp4', 'bbb.mov', 'same soundtrack and length, unrelated pictures'],
  ['dream_audio_other_picture.mp4', 'dream.mp4', 'sound is an excerpt of the longer video, pictures unrelated'],
  ['sintel__clip_newaudio.mp4', 'bbb.mov', 'sound matches at 0 s, pictures unrelated'],
  ['static_a.mp4', 'static_b.mp4', 'two different still pictures of the same length'],
  ['flat_a.mp4', 'flat_b.mp4', 'different content, uniform frames at every default sample position'],
  ['silent_a.mp4', 'silent_b.mp4', 'both audio tracks silent'],
  ['silent_a.mp4', 'sintel__silent.mp4', 'both audio tracks silent'],
];
// Measured only: no required outcome.
const MEASURED_ONLY = [
  ['static_a.mp4', 'static_c.mp4', 'still pictures that differ in one area; a match here is a known limit of sampled comparison'],
  ['sintel__dim.mp4', 'sintel.mp4', 'strong brightness and contrast change'],
];

function probeDuration(file) {
  const result = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out(file)], { windowsHide: true });
  const value = Number(String(result.stdout).trim());
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

async function main() {
  await fetchSeeds();
  fs.mkdirSync(OUT, { recursive: true });
  sintelVariants();
  damagedVariants();
  otherSeeds();
  generated();
  for (const entry of manifest) {
    entry.durationSecs = probeDuration(entry.file);
    entry.bytes = fs.statSync(out(entry.file)).size;
  }
  fs.writeFileSync(out('manifest.json'), `${JSON.stringify({
    rules: [
      'Files of one seed whose expect is exact or sameSpan are sameSpan with each other (exact only for byte copies).',
      'A file whose expect is partial is a partial clip of every exact or sameSpan file of its seed, at the listed segments (seconds).',
      'Files of different seeds are unrelated.',
      'expect is the intended outcome, not what the current build does.',
    ],
    seeds: SEEDS,
    files: manifest,
    negatives: NEGATIVES.map(([a, b, why]) => ({ a, b, why })),
    measuredOnly: MEASURED_ONLY.map(([a, b, why]) => ({ a, b, why })),
  }, null, 2)}\n`);
  const total = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`${manifest.length} files, ${(total / 1e6).toFixed(1)} MB, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
