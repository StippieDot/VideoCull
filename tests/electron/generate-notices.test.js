const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildFfmpegSection, buildNotices, declaredLicense } = require('../../scripts/generate-notices');
const test = globalThis.test || nodeTest;

function pkg(name, license, { version = '1.0.0', licenseTexts = [`${license} text for ${name}`], noticeTexts = [] } = {}) {
  return { name, version, license, licenseTexts, noticeTexts };
}

const noRepoFiles = (relativePath) => {
  throw new Error(`unexpected read of ${relativePath}`);
};

test('lists every shipped package once, sorted, with its license and full text', () => {
  const text = buildNotices([
    pkg('zustand', 'MIT'),
    pkg('@videojs/core', 'Apache-2.0', { noticeTexts: ['Video.js NOTICE'] }),
    pkg('zustand', 'MIT'),
    pkg('sax', 'BlueOak-1.0.0'),
  ], {}, noRepoFiles);

  assert.equal(text.match(/^zustand 1\.0\.0$/gm).length, 1);
  assert.ok(text.indexOf('@videojs/core 1.0.0') < text.indexOf('sax 1.0.0'));
  assert.ok(text.indexOf('sax 1.0.0') < text.indexOf('zustand 1.0.0'));
  assert.match(text, /@videojs\/core 1\.0\.0\nLicense: Apache-2\.0\n\nVideo\.js NOTICE\n\nApache-2\.0 text for @videojs\/core/);
  assert.match(text, /GNU Affero General Public License v3\.0 \(see LICENSE\.txt\)/);
});

test('accepts an OR expression when one alternative is allowed', () => {
  assert.doesNotThrow(() => buildNotices([pkg('dual', '(MIT OR GPL-3.0-only)')], {}, noRepoFiles));
});

test('fails on a license outside the allow-list, a missing license or a missing license text', () => {
  assert.throws(
    () => buildNotices([
      pkg('copyleft', 'GPL-3.0-only'),
      pkg('undeclared', null),
      pkg('textless', 'MIT', { licenseTexts: [] }),
      pkg('blank', 'ISC', { licenseTexts: ['  \n'] }),
    ], {}, noRepoFiles),
    (error) => {
      assert.match(error.message, /copyleft@1\.0\.0: license "GPL-3\.0-only" is not on the allow-list/);
      assert.match(error.message, /undeclared@1\.0\.0: no license declared/);
      assert.match(error.message, /textless@1\.0\.0: no license text found/);
      assert.match(error.message, /blank@1\.0\.0: no license text found/);
      return true;
    },
  );
});

test('a reviewed override can set the license and supply the text from the repository', () => {
  const reads = [];
  const text = buildNotices([
    pkg('ffmpeg-binary', 'GPLv3', { licenseTexts: [] }),
  ], {
    'ffmpeg-binary': { license: 'GPL-3.0-or-later', licenseFile: 'build/licenses/GPL-3.0.txt', reason: 'test' },
  }, (relativePath) => {
    reads.push(relativePath);
    return '                    GNU GENERAL PUBLIC LICENSE\n';
  });

  assert.deepEqual(reads, ['build/licenses/GPL-3.0.txt']);
  assert.match(text, /ffmpeg-binary 1\.0\.0\nLicense: GPL-3\.0-or-later\n\n {20}GNU GENERAL PUBLIC LICENSE/);
});

test('an override for a package that no longer ships fails the build', () => {
  assert.throws(
    () => buildNotices([pkg('react', 'MIT')], { 'fluent-ffmpeg': { licenseFile: 'x.txt', reason: 'old' } }, noRepoFiles),
    /fluent-ffmpeg: license override no longer matches a shipped package/,
  );
});

test('reads both modern and legacy license fields from package.json', () => {
  assert.equal(declaredLicense({ license: 'MIT' }), 'MIT');
  assert.equal(declaredLicense({ license: { type: 'ISC' } }), 'ISC');
  assert.equal(declaredLicense({ licenses: [{ type: 'MIT', url: 'https://example.invalid' }] }), 'MIT');
  assert.equal(declaredLicense({}), null);
});

test('the FFmpeg section carries the runtime README and every bundled component license', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-notices-ffmpeg-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.txt'), 'FFmpeg 9.0.2 built for VideoCull; source at https://example.invalid/source\n');
    fs.writeFileSync(path.join(dir, 'LICENSE.txt'), 'GPL text');
    assert.throws(() => buildFfmpegSection(dir), /no component licenses/);

    fs.mkdirSync(path.join(dir, 'licenses'));
    fs.writeFileSync(path.join(dir, 'licenses', 'dav1d.txt'), 'BSD 2-Clause text');
    fs.writeFileSync(path.join(dir, 'licenses', 'x264.txt'), 'GPL 2 text');
    const section = buildFfmpegSection(dir);

    assert.match(section, /License: GPL-3\.0-or-later \(full text in ffmpeg\/LICENSE\.txt\)/);
    assert.match(section, /source at https:\/\/example\.invalid\/source/);
    assert.match(section, /== dav1d ==\n\nBSD 2-Clause text/);
    assert.match(section, /== x264 ==\n\nGPL 2 text/);

    fs.rmSync(path.join(dir, 'README.txt'));
    assert.throws(() => buildFfmpegSection(dir), /lacks README\.txt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
