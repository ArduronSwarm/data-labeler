import { inflateRawSync } from 'node:zlib';

export const EVIDENCE_NAME = 'production-deployment-evidence';
export const EVIDENCE_FILE = 'production-deployment-evidence.json';
const MAX_ARCHIVE = 65536, MAX_JSON = 16384;
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function parseEvidenceArchive(input) {
  const zip = Buffer.from(input);
  if (zip.length < 22 || zip.length > MAX_ARCHIVE) throw Error('Evidence archive size rejected');
  let end = -1;
  for (let i = zip.length - 22; i >= 0; i--) if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break; }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || zip.readUInt16LE(end + 8) !== 1 || zip.readUInt16LE(end + 10) !== 1) throw Error('Evidence ZIP must contain one local file');
  const centralSize = zip.readUInt32LE(end + 12), central = zip.readUInt32LE(end + 16);
  if (central + centralSize !== end || central + 46 > end || zip.readUInt32LE(central) !== 0x02014b50) throw Error('Evidence central directory rejected');
  const flags = zip.readUInt16LE(central + 8), method = zip.readUInt16LE(central + 10);
  const compressedSize = zip.readUInt32LE(central + 20), plainSize = zip.readUInt32LE(central + 24);
  const nameSize = zip.readUInt16LE(central + 28), extraSize = zip.readUInt16LE(central + 30), commentSize = zip.readUInt16LE(central + 32);
  const local = zip.readUInt32LE(central + 42);
  if ((flags & 1) || ![0, 8].includes(method) || compressedSize > MAX_ARCHIVE || plainSize > MAX_JSON || [compressedSize, plainSize, local].includes(0xffffffff)) throw Error('Evidence compression/encryption rejected');
  if (central + 46 + nameSize + extraSize + commentSize !== end || zip.readUInt16LE(central + 34)) throw Error('Evidence directory bounds rejected');
  const name = zip.subarray(central + 46, central + 46 + nameSize).toString('utf8');
  if (name !== EVIDENCE_FILE || local + 30 > central || zip.readUInt32LE(local) !== 0x04034b50) throw Error('Unexpected evidence file');
  const localNameSize = zip.readUInt16LE(local + 26), localExtraSize = zip.readUInt16LE(local + 28);
  if (zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method || zip.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== EVIDENCE_FILE) throw Error('Evidence header mismatch');
  const start = local + 30 + localNameSize + localExtraSize;
  if (start + compressedSize > central) throw Error('Evidence payload bounds rejected');
  const compressed = zip.subarray(start, start + compressedSize);
  const bytes = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_JSON });
  if (bytes.length !== plainSize || bytes.length > MAX_JSON || crc32(bytes) !== zip.readUInt32LE(central + 16)) throw Error('Evidence integrity check failed');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw Error('Evidence JSON is malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Evidence must be a JSON object');
  return value;
}
export async function boundedBytes(response, limit = MAX_ARCHIVE) {
  if (!response.ok) throw Error(`Evidence download failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw Error('Evidence download too large');
  const reader = response.body?.getReader();
  if (!reader) throw Error('Evidence download has no body');
  const parts = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) throw Error('Evidence download limit exceeded'); parts.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(parts, length);
}
export async function downloadEvidence(github, repository, runId, token, fetchImpl = fetch) {
  if (!/^ArduronSwarm\/[\w.-]+$/.test(repository) || !/^\d+$/.test(String(runId))) throw Error('Invalid artifact identity');
  const data = await github.request(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`);
  if (!Array.isArray(data?.artifacts) || data.total_count > data.artifacts.length) throw Error('Artifact inventory incomplete');
  const matches = data.artifacts.filter(artifact => artifact.name === EVIDENCE_NAME && !artifact.expired);
  if (!matches.length) return null;
  if (matches.length !== 1 || matches[0].size_in_bytes > MAX_ARCHIVE || !Number.isSafeInteger(matches[0].id)) throw Error('Ambiguous or oversized evidence artifact');
  const archiveUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${matches[0].id}/zip`;
  let response = await fetchImpl(archiveUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = new URL(response.headers.get('location') || '');
    if (location.protocol !== 'https:' || location.username || location.password || location.port || !/(?:^|\.)(?:blob\.core\.windows\.net|githubusercontent\.com|actions\.githubusercontent\.com)$/.test(location.hostname)) throw Error('Untrusted evidence download redirect');
    // A signed artifact URL is never logged and never receives the GitHub token.
    response = await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  }
  return parseEvidenceArchive(await boundedBytes(response));
}
