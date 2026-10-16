import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Missing isolated credentials fail before Electron can launch or access a daily account.
const missing = resolve('.tmp/movie-report-missing-account');
await assert.rejects(stat(missing), error => error.code === 'ENOENT');
const env = { ...process.env, YINGJI_LIVE_TEST: '1', YINGJI_TEST_ACCOUNT_DIR: missing };
delete env.YINGJI_EXECUTABLE;
const result = spawnSync(process.execPath, ['scripts/movie-account-hidden.mjs'], {
  env, encoding: 'utf8', timeout: 10000, windowsHide: true,
});
assert.equal(result.status, 1);
assert.equal(result.signal, null);
const report = JSON.parse(await readFile('.tmp/movie-account-hidden/account-result.json', 'utf8'));
assert.equal(report.failed, true);
assert.equal(report.authenticated, false);
assert.equal(report.decoded, false);
assert.equal(report.encryptedCopiesRemoved, true);
assert.equal(report.previewOwnership, undefined);
const verification = { expectedFailure: true, freshReport: true, cleanupRecorded: true, electronNotLaunched: true };
await writeFile('.tmp/movie-report-failure.json', JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification));
