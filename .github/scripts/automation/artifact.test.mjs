import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, parseEvidenceArchive, boundedBytes, downloadEvidence, EVIDENCE_FILE } from './artifact.mjs';

function archive(value = { schemaVersion: 1 }, { name = EVIDENCE_FILE, method = 8, flags = 0, plainSize, entries = 1, corrupt = false } = {}) {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), data = method === 8 ? deflateRawSync(bytes) : bytes, filename = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(corrupt ? 1 : crc32(bytes), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(plainSize ?? bytes.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries, 8); end.writeUInt16LE(entries, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
test('only the exact bounded JSON evidence file is read without extracting code', () => {
  assert.deepEqual(parseEvidenceArchive(archive()), { schemaVersion: 1 });
  assert.deepEqual(parseEvidenceArchive(archive({ deployed: true }, { method: 0 })), { deployed: true });
  for (const opts of [{ name: '../production-deployment-evidence.json' }, { name: 'runner.mjs' }, { flags: 1 }, { entries: 2 }, { corrupt: true }, { method: 99 }, { plainSize: 1000000 }]) assert.throws(() => parseEvidenceArchive(archive({}, opts)));
  for (const payload of [Buffer.alloc(10), Buffer.alloc(70000), archive('<html>bad</html>'), archive([]), archive('a'.repeat(20000), { plainSize: 2 })]) assert.throws(() => parseEvidenceArchive(payload));
});
test('declared size and actual streaming size are both bounded', async () => {
  await assert.rejects(boundedBytes(new Response('small', { headers: { 'content-length': '999999' } })), /too large/);
  await assert.rejects(boundedBytes(new Response('x'.repeat(100)), 10), /limit/);
  await assert.rejects(boundedBytes(new Response('error', { status: 403 })), /403/);
});
test('artifact identity and redirects reject unrelated or ambiguous destinations', async () => {
  const client = { request: async () => ({ total_count: 1, artifacts: [{ id: 1, name: 'production-deployment-evidence', size_in_bytes: 100 }] }) };
  for (const destination of ['https://evil.example/evidence', 'http://example.blob.core.windows.net/a', 'https://githubusercontent.com.evil.example/a']) await assert.rejects(downloadEvidence(client, 'ArduronSwarm/example', 1, 'mock', async () => new Response(null, { status: 302, headers: { location: destination } })), /Untrusted/);
  const calls = [];
  const result = await downloadEvidence(client, 'ArduronSwarm/example', 1, 'mock', async (url, options) => { calls.push(options); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://example.blob.core.windows.net/evidence?signature=private' } }) : new Response(archive()); });
  assert.equal(result.schemaVersion, 1); assert.equal(calls[1].headers, undefined);
});
