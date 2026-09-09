const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'store-listing.json'), 'utf8'));
assert.equal(manifest.screenshots?.length, 6, 'Store listing must define exactly six screenshots');

function dimensions(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', `${filePath} must be PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), bytes: data.length };
}

for (const screenshot of manifest.screenshots) {
  const filePath = path.join(root, screenshot.path);
  assert.ok(fs.existsSync(filePath), `Missing Store screenshot: ${screenshot.path}`);
  const image = dimensions(filePath);
  assert.ok(image.width >= 1366 && image.height >= 768, `${screenshot.path} is below 1366x768`);
  assert.ok(image.bytes < 50 * 1024 * 1024, `${screenshot.path} exceeds 50 MB`);
  assert.ok(screenshot.caption.length <= 200, `${screenshot.path} caption exceeds 200 characters`);
  assert.equal(screenshot.kind, 'clean-ui', `${screenshot.path} must not be a marketing composite`);
}

const pending = manifest.screenshots.filter((item) => item.reviewStatus !== 'approved');
console.log(`Store screenshots meet automated image requirements: ${manifest.screenshots.length}.`);
if (pending.length) {
  console.log(`Manual pre-submission review remains required: ${pending.map((item) => item.path).join(', ')}.`);
}
