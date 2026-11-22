'use strict';
// Artifact inspection only: does not launch Electron or a GUI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {extractFile, statFile} = require('@electron/asar');
const resources = path.resolve(process.argv[2] || 'dist/win-unpacked/resources');
const archive = path.join(resources, 'app.asar');
const expectedVersion = require('../package.json').version;
assert.equal(JSON.parse(extractFile(archive, 'package.json')).version, expectedVersion);
// @electron/asar walks directories by path.sep; nested POSIX strings fail on Windows.
for (const file of ['src/main.cjs', 'src/preload.cjs', 'src/shell.html', 'src/shell.js', 'src/boot.js', 'src/media.cjs', 'src/video-config.cjs', 'src/background.cjs', 'src/background.css', 'assets/video/NOTICE.md', 'assets/video/LICENSE.dsh-video-skin']) {
  assert.ok(extractFile(archive, path.normalize(file)).length > 0, `missing packaged file: ${file}`);
}
for (const [file, hash] of [['boot.mp4', 'e95b45d08d6bdbb0b42f97dc3bcb3891debd27347a1ab9589d257a305abae2db'], ['background.mp4', '9187a3947dca8ce83e2832ac3d884a05fc36349e253a29b5b11bb4f829ece937']]) {
  const relative = `assets/video/${file}`;
  assert.equal(statFile(archive, path.normalize(relative)).unpacked, true, `${file} must be unpacked for streaming`);
  const data = fs.readFileSync(path.join(resources, 'app.asar.unpacked', relative));
  assert.equal(createHash('sha256').update(data).digest('hex'), hash, `${file} checksum mismatch`);
}
console.log(`v${expectedVersion}: packaged scripts, styles, licenses and both video checksums verified (non-GUI)`);
