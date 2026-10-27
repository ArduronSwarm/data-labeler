import { readFileSync } from 'node:fs';

export const ENGINE_VERSION = '1.0.0';
export const normalize = value => String(value || '').trim().toLowerCase();
export function validateProfile(profile) {
  if (profile?.schemaVersion !== 1 || profile.engineVersion !== ENGINE_VERSION) throw Error('Unsupported automation profile');
  if (!/^ArduronSwarm\/[A-Za-z0-9_.-]+$/.test(profile.repository || '')) throw Error('Invalid repository profile');
  const jiraUrl = new URL(profile.jira?.baseUrl || '');
  if (jiraUrl.protocol !== 'https:' || jiraUrl.hostname !== 'arduron.atlassian.net' || jiraUrl.username || jiraUrl.password || jiraUrl.port || jiraUrl.pathname !== '/' || jiraUrl.search || jiraUrl.hash) throw Error('Invalid Jira origin');
  if (!Array.isArray(profile.jira.projectKeys) || !profile.jira.projectKeys.length || profile.jira.projectKeys.some(key => !/^[A-Z][A-Z0-9]+$/.test(key))) throw Error('Invalid Jira projects');
  for (const name of ['startDateField', 'storyTypeField']) if (!/^customfield_\d+$/.test(profile.jira[name])) throw Error('Invalid Jira field');
  if (typeof profile.jira.productionFinalization !== 'boolean' || typeof profile.release?.enabled !== 'boolean' || typeof profile.projects?.enabled !== 'boolean') throw Error('Missing automation feature switches');
  if (profile.branches?.development !== 'development' || profile.branches.production !== 'main') throw Error('Unexpected environment branches');
  if (profile.release.prefix !== profile.repository.split('/')[1]) throw Error('Release prefix must match repository');
  if (!Number.isSafeInteger(profile.pullRequests?.largeChangeThreshold) || profile.pullRequests.largeChangeThreshold < 1 || profile.pullRequests.largeChangeThreshold > 1000 || typeof profile.pullRequests.allowHotfixToMain !== 'boolean' || typeof profile.pullRequests.requireLabel !== 'boolean') throw Error('Invalid PR policy');
  if (typeof profile.release.planning !== 'boolean' || typeof profile.release.candidates !== 'boolean') throw Error('Missing release profile switches');
  if (profile.projects.url && !/^https:\/\/github\.com\/orgs\/ArduronSwarm\/projects\/[1-9]\d*$/.test(profile.projects.url)) throw Error('Invalid Projects URL');
  for (const [key, repositories] of Object.entries(profile.jira.completionCohorts || {})) {
    if (!issueKey(key, profile.jira.projectKeys) || !Array.isArray(repositories) || !repositories.length || repositories.some(repo => !/^ArduronSwarm\/[\w.-]+$/.test(repo)) || new Set(repositories).size !== repositories.length) throw Error('Invalid completion cohort');
  }
  return profile;
}
export function loadProfile(path = '.github/automation.config.json') { return validateProfile(JSON.parse(readFileSync(path, 'utf8'))); }

export class HttpFailure extends Error {
  constructor(service, operation, status, kind = 'http') { super(`${service} ${operation}: ${kind} (${status})`); this.status = status; this.kind = kind; }
}
export function createClient({ service, baseUrl, authorization, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw Error('Unsafe service origin');
  return {
    async request(path, { method = 'GET', body } = {}) {
      if (!path.startsWith('/') || path.startsWith('//')) throw Error('Expected service-relative path');
      const url = new URL(path, base);
      if (url.origin !== base.origin) throw Error('Service origin changed');
      const response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new HttpFailure(service, `${method} ${url.pathname}`, response.status);
      if (response.status === 204) return null;
      const text = await response.text();
      if (!text.trim()) return null;
      try { return JSON.parse(text); }
      catch { throw new HttpFailure(service, `${method} ${url.pathname}`, response.status, 'non-JSON response'); }
    },
  };
}
export async function githubPages(client, path, limit = 1000) {
  const results = [];
  for (let page = 1; ; page++) {
    const data = await client.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw Error('Expected paginated GitHub list');
    results.push(...data);
    if (results.length > limit) throw Error('GitHub pagination exceeds safety limit; reconcile manually');
    if (data.length < 100) return results;
  }
}
export function issueKey(value, projectKeys = ['AR', 'SP']) {
  const matches = [...String(value || '').matchAll(/(?:^|[\s/[(_-])([A-Z][A-Z0-9]+-[1-9]\d*)(?=$|[\s/\])_-])/g)].map(match => match[1]).filter(key => projectKeys.includes(key.split('-')[0]));
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}
export function keyForPr(pr, profile) {
  const branch = issueKey(pr.head?.ref, profile.jira.projectKeys), title = issueKey(pr.title, profile.jira.projectKeys);
  return branch && title && branch !== title ? null : branch || title;
}
export function trustedPr(pr, repository) {
  return !!pr && pr.base?.repo?.full_name === repository && pr.head?.repo?.full_name === repository && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(pr.author_association);
}
const ranks = new Map([['to do', 0], ['pending', 0], ['requested changes', 1], ['in progress', 1], ['pr in review', 2], ['pr merged', 3], ['dev-done', 4], ['dev-done tech', 4], ['qa dev - to do', 5], ['qa dev - in progress', 5], ['ready for deployment', 6], ['resolved', 6], ['done', 7]]);
export function excludedIssue(issue) { return /^(?:epic|qa(?:\b|[-:]))/i.test(issue.fields?.issuetype?.name || ''); }
export function stageForPr(pr, action, development = 'development') {
  if (action === 'closed') return pr.merged && pr.base?.ref === development ? 'merged' : null;
  if (['opened', 'reopened', 'synchronize', 'ready_for_review', 'converted_to_draft'].includes(action)) return pr.draft ? 'started' : 'review';
  return null;
}
export async function getIssue(jira, key, profile) {
  const fields = ['summary', 'status', 'issuetype', 'fixVersions', profile.jira.startDateField, profile.jira.storyTypeField].join(',');
  const issue = await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`);
  if (!issue?.fields?.status?.name || !issue.fields.issuetype?.name) throw Error('Incomplete Jira issue response');
  return issue;
}
export async function transitionIssue(jira, key, targetName, { profile, production = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const issue = await getIssue(jira, key, profile);
  if (excludedIssue(issue)) return { outcome: 'skipped', reason: 'issue-type-managed-by-owner', key };
  const current = normalize(issue.fields.status.name), target = normalize(targetName);
  const currentRank = ranks.get(current), targetRank = ranks.get(target);
  if (!production && (issue.fields.status.statusCategory?.key === 'done' || (currentRank !== undefined && targetRank !== undefined && currentRank > targetRank))) return { outcome: 'skipped', reason: 'later-or-terminal-state', key, current: issue.fields.status.name };
  if (production && !['ready for deployment', 'resolved', 'done'].includes(current)) return { outcome: 'deferred', reason: 'owner-qa-acceptance-required', key, current: issue.fields.status.name };
  let outcome = 'already-at-target';
  if (current !== target) {
    const result = await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    if (!Array.isArray(result?.transitions)) throw Error('Incomplete Jira transition response');
    const exact = result.transitions.filter(transition => normalize(transition.to?.name) === target);
    if (exact.length !== 1) throw Error(`Jira ${key}: expected one exact transition to ${targetName}; found ${exact.length}`);
    await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: { transition: { id: exact[0].id } } });
    outcome = 'changed';
  }
  // Only a first start may fill an empty date; retries and later stages never overwrite it.
  if (target === 'in progress' && !issue.fields[profile.jira.startDateField]) {
    await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: { fields: { [profile.jira.startDateField]: today } } });
  }
  return { outcome, key, target: targetName };
}
export async function applyStage(jira, key, stage, profile) {
  if (stage === 'review') {
    const issue = await getIssue(jira, key, profile);
    if (excludedIssue(issue)) return { outcome: 'skipped', reason: 'issue-type-managed-by-owner', key };
    if ((ranks.get(normalize(issue.fields.status.name)) ?? Infinity) < 1) await transitionIssue(jira, key, 'In Progress', { profile });
    return transitionIssue(jira, key, 'PR in Review', { profile });
  }
  return transitionIssue(jira, key, stage === 'started' ? 'In Progress' : 'PR Merged', { profile });
}
export function managedPrBody(body, key, profile) {
  const start = '<!-- othryn-automation:ticket:start -->', end = '<!-- othryn-automation:ticket:end -->';
  const section = `${start}\nTicket: [${key}](${profile.jira.baseUrl}/browse/${key})\n${end}`;
  const text = String(body || '');
  const pattern = /<!-- othryn-automation:ticket:start -->[\s\S]*?<!-- othryn-automation:ticket:end -->/;
  if (pattern.test(text)) return text.replace(pattern, section);
  if (text.includes(`${profile.jira.baseUrl}/browse/${key}`)) return text;
  return `${section}\n\n${text || '## What was done\n\nDescribe the change and validation.'}`;
}
export function healthReport(pr, files, profile) {
  const warnings = [];
  const hotfix = /(?:^|\/)hotfix(?:\/|-)|^[A-Z]+-\d+-hotfix(?:-|$)/i.test(pr.head?.ref || '');
  if (pr.base?.ref === profile.branches.production && pr.head?.ref !== profile.branches.development && !(profile.pullRequests.allowHotfixToMain && hotfix)) warnings.push('targets-main');
  if (files.length > profile.pullRequests.largeChangeThreshold) warnings.push('large-pr');
  const missing = [];
  if (!pr.labels?.length) missing.push('label');
  if (!pr.assignees?.length) missing.push('assignee');
  if (!pr.requested_reviewers?.length && !pr.requested_teams?.length) missing.push('reviewer request (or submitted review)');
  return { warnings, missing, fileCount: files.length, draft: !!pr.draft };
}
export async function upsertComment(github, repository, number, marker, body) {
  const comments = await githubPages(github, `/repos/${repository}/issues/${number}/comments`);
  const existing = comments.find(comment => comment.user?.type === 'Bot' && comment.body?.includes(marker));
  if (existing?.body === body) return { outcome: 'unchanged' };
  if (existing) await github.request(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
  else await github.request(`/repos/${repository}/issues/${number}/comments`, { method: 'POST', body: { body } });
  return { outcome: existing ? 'updated' : 'created' };
}
export async function ensureAutomationLabel(github, repository, name) {
  const colors = { 'out-of-sync': 'e4a21b', 'targets-main': 'd73a4a', 'large-pr': 'd4c5f9', 'direct-push': 'd73a4a' };
  if (!Object.hasOwn(colors, name)) throw Error('Unknown managed label');
  const path = `/repos/${repository}/labels/${name}`;
  try { await github.request(path); return; }
  catch (error) { if (error.status !== 404) throw error; }
  try { await github.request(`/repos/${repository}/labels`, { method: 'POST', body: { name, color: colors[name], description: 'Managed by Othryn repository automation' } }); }
  catch (error) {
    // Two PR jobs can discover the same missing label. Only accept a conflict if it now exists.
    if (error.status !== 422) throw error;
    await github.request(path);
  }
}
export function validateDeploymentEvidence(marker, run, profile) {
  if (run.status !== 'completed' || run.conclusion !== 'success' || !['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== profile.branches.production || run.head_repository?.full_name !== profile.repository) throw Error('Untrusted production workflow result');
  if (!/^\.github\/workflows\/deploy-production\.ya?ml(?:@.*)?$/.test(run.path || '')) throw Error('Unexpected producer workflow path');
  if (!/^[a-f0-9]{40}$/.test(run.head_sha || '')) throw Error('Invalid producer commit');
  if (marker?.schemaVersion !== 1 || marker.repository !== profile.repository || marker.sha !== run.head_sha || marker.environment !== 'production' || marker.deployed !== true || marker.healthCheck !== 'passed' || String(marker.runId) !== String(run.id)) throw Error('Production evidence identity or health mismatch');
  return { sha: run.head_sha, runId: String(run.id), repository: profile.repository };
}
export function parsePrUrl(value) {
  const match = /^https:\/\/github\.com\/(ArduronSwarm\/[A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/.exec(String(value || ''));
  return match ? { repository: match[1], number: Number(match[2]) } : null;
}
export async function associatedPrGuard(jira, github, key, profile) {
  const links = await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`);
  if (!Array.isArray(links)) throw Error('Incomplete Jira remote-link registry');
  const prs = links.map(link => parsePrUrl(link.object?.url)).filter(Boolean);
  if (!prs.length) return { allowed: false, reason: 'no-associated-pr-registry' };
  const expected = profile.jira.completionCohorts?.[key] || [];
  // Closed development PRs are not proof that every repository was deployed.
  if (new Set([...expected, ...prs.map(pr => pr.repository)]).size > 1) return { allowed: false, reason: 'multi-repository-production-acceptance-required' };
  if (expected.some(repository => !prs.some(pr => pr.repository === repository))) return { allowed: false, reason: 'completion-cohort-registry-incomplete' };
  if (prs.length > 100) return { allowed: false, reason: 'associated-pr-limit-requires-owner' };
  for (const reference of prs) {
    let pr;
    try { pr = await github.request(`/repos/${reference.repository}/pulls/${reference.number}`); }
    catch (error) { if ([403, 404].includes(error.status)) return { allowed: false, reason: 'associated-pr-visibility-incomplete' }; throw error; }
    if (keyForPr(pr, profile) !== key) return { allowed: false, reason: 'associated-pr-key-mismatch' };
    if (!pr.merged || pr.state !== 'closed') return { allowed: false, reason: 'associated-pr-open-or-unmerged' };
  }
  return { allowed: true, checked: prs.length };
}
export async function ensureRemoteLink(jira, key, pr, profile) {
  const parsed = parsePrUrl(pr.html_url);
  if (!parsed || parsed.repository !== profile.repository) throw Error('Unexpected PR link destination');
  await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`, { method: 'POST', body: { globalId: `othryn:${profile.repository}:pr:${pr.number}`, object: { url: pr.html_url, title: `${profile.repository} #${pr.number}` } } });
}
export async function discoverDeploymentKeys(github, profile, sha) {
  const repoPath = `/repos/${profile.repository}`;
  const direct = await githubPages(github, `${repoPath}/commits/${sha}/pulls`, 100);
  const merged = direct.filter(pr => pr.merged_at && pr.base?.ref === profile.branches.production && pr.merge_commit_sha === sha);
  if (merged.length !== 1) return { keys: [], reason: 'production-commit-not-an-associated-merged-pr' };
  const commit = await github.request(`${repoPath}/commits/${sha}`);
  const baseSha = commit.parents?.[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(baseSha || '')) return { keys: [], reason: 'commit-range-not-established' };
  const comparison = await github.request(`${repoPath}/compare/${baseSha}...${sha}?per_page=100`);
  if (!Array.isArray(comparison.commits) || comparison.total_commits > 100 || comparison.commits.length < comparison.total_commits) return { keys: [], reason: 'commit-range-requires-manual-reconciliation' };
  const keys = new Set();
  for (const candidate of comparison.commits) {
    if (!/^[a-f0-9]{40}$/.test(candidate.sha)) throw Error('Invalid compared commit identity');
    const prs = await githubPages(github, `${repoPath}/commits/${candidate.sha}/pulls`, 100);
    for (const pr of prs.filter(pr => pr.merged_at)) { const key = keyForPr(pr, profile); if (key) keys.add(key); }
  }
  return { keys: [...keys].sort(), sha, baseSha };
}
export async function jiraVersion(jira, profile, name, { create = false, released = false, releaseDate } = {}) {
  if (!name.startsWith(`${profile.release.prefix} `) || name.length > 120) throw Error('Release name must have the repository prefix');
  const versions = await jira.request('/rest/api/3/project/AR/versions');
  if (!Array.isArray(versions)) throw Error('Incomplete Jira versions response');
  const matches = versions.filter(version => version.name === name);
  if (matches.length > 1) throw Error('Ambiguous Jira release identity');
  let version = matches[0];
  if (!version && create) version = await jira.request('/rest/api/3/version', { method: 'POST', body: { name, project: 'AR', released, ...(releaseDate ? { releaseDate } : {}) } });
  if (!version?.id) throw Error('Selected Jira release not found');
  if (released && !version.released) version = await jira.request(`/rest/api/3/version/${encodeURIComponent(version.id)}`, { method: 'PUT', body: { released: true, ...(releaseDate ? { releaseDate } : {}) } });
  return version;
}
export async function selectPlannedVersion(jira, profile, selectedName = '') {
  if (selectedName) return jiraVersion(jira, profile, selectedName);
  const versions = await jira.request('/rest/api/3/project/AR/versions');
  if (!Array.isArray(versions)) throw Error('Incomplete Jira versions response');
  const candidates = versions.filter(version => !version.released && !version.archived && version.name?.startsWith(`${profile.release.prefix} `));
  if (candidates.length !== 1) return null;
  return candidates[0];
}
export async function addFixVersion(jira, key, version, profile) {
  if (!/^\d+$/.test(String(version?.id || ''))) throw Error('Invalid Jira version identity');
  const issue = await getIssue(jira, key, profile);
  if (!Array.isArray(issue.fields.fixVersions)) throw Error('Incomplete Jira fixVersions response');
  if (issue.fields.fixVersions.some(existing => String(existing.id) === String(version.id))) return { outcome: 'unchanged', key, versionId: String(version.id) };
  await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: { update: { fixVersions: [{ add: { id: String(version.id) } }] } } });
  return { outcome: 'added', key, versionId: String(version.id) };
}
export async function nextTag(github, profile) {
  const tags = await githubPages(github, `/repos/${profile.repository}/tags`, 1000);
  const versions = tags.map(tag => /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.name)).filter(Boolean).map(match => match.slice(1).map(Number)).filter(version => version.every(Number.isSafeInteger));
  versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  if (versions.length && !Number.isSafeInteger(versions[0][2] + 1)) throw Error('Release patch number exceeds safety limit');
  return versions.length ? `v${versions[0][0]}.${versions[0][1]}.${versions[0][2] + 1}` : 'v1.0.0';
}
export async function publishRelease(github, profile, sha, { tag, draft = false } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Release requires an immutable SHA');
  const releases = await githubPages(github, `/repos/${profile.repository}/releases`, 1000);
  const existing = releases.find(release => release.target_commitish === sha && release.draft === draft);
  if (existing) return existing;
  const selected = tag || await nextTag(github, profile);
  if (!/^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(selected)) throw Error('Invalid release tag');
  const collision = releases.find(release => release.tag_name === selected);
  if (collision) throw Error('Release tag already belongs to another release; reconcile explicitly');
  return github.request(`/repos/${profile.repository}/releases`, { method: 'POST', body: { tag_name: selected, target_commitish: sha, name: `${profile.release.prefix} ${selected}`, draft, prerelease: draft, generate_release_notes: true, body: `Validated commit: ${sha}` } });
}
