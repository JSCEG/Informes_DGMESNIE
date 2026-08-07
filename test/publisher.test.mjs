import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

test('genera portal, latest, versión inmutable y manifiesto sanitizado', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'informes-test-'));
  const output = path.join(temp, 'dist');
  const result = await run(process.execPath, ['scripts/build-site.mjs', '--input', 'fixtures/radar-regulatorio.publicable.json', '--output', output, '--base-url', 'https://informes.example.invalid']);
  assert.equal(result.code, 0, result.stderr);
  const version = path.join(output, 'informes', 'radar-regulatorio-energetico', 'versiones', '2026-08-01-v0.1.0', 'index.html');
  await stat(path.join(output, 'index.html'));
  await stat(path.join(output, 'informes', 'radar-regulatorio-energetico', 'index.html'));
  await stat(version);
  const manifest = JSON.parse(await readFile(path.join(output, 'informes', 'radar-regulatorio-energetico', 'manifest.json'), 'utf8'));
  assert.equal(manifest.qa.contract_validated, true);
  assert.match(manifest.version_url, /\/versiones\/2026-08-01-v0\.1\.0\/$/);
  const publicTree = `${await readFile(path.join(output, 'index.html'), 'utf8')}\n${JSON.stringify(manifest)}`;
  assert.doesNotMatch(publicTree, /[A-Za-z]:\\|sharepoint|@example\./i);

  const second = await run(process.execPath, ['scripts/build-site.mjs', '--input', 'fixtures/radar-regulatorio.publicable.json', '--output', output, '--base-url', 'https://informes.example.invalid']);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /"status": "no-op"/);

  const changedContract = JSON.parse(await readFile('fixtures/radar-regulatorio.publicable.json', 'utf8'));
  changedContract.summary = 'Cambio con la misma identidad de versión.';
  const collisionInput = path.join(temp, 'collision.json');
  await writeFile(collisionInput, JSON.stringify(changedContract));
  const collision = await run(process.execPath, ['scripts/build-site.mjs', '--input', collisionInput, '--output', output, '--base-url', 'https://informes.example.invalid']);
  assert.equal(collision.code, 1);
  assert.match(collision.stderr, /Colisión inmutable/);
});

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
