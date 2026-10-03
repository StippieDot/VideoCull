// @ts-check
// Single place that resolves the bundled FFmpeg/FFprobe binaries. Packaged builds keep the
// executables unpacked next to app.asar because child processes cannot run from inside it.
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path.replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('@ffprobe-installer/ffprobe').path.replace('app.asar', 'app.asar.unpacked');

module.exports = { ffmpegPath, ffprobePath };
