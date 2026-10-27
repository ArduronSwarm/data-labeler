import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, githubPages, issueKey, keyForPr, trustedPr, stageForPr, transitionIssue, applyStage, managedPrBody, associatedPrGuard, validateDeploymentEvidence, publishRelease, validateProfile, addFixVersion, ensureAutomationLabel, ENGINE_VERSION } from './engine.mjs';
import { run, jiraAuthorization, verifiedProduction } from './runner.mjs';

export const profile = { schemaVersion: 1, engineVersion: ENGINE_VERSION, repository: 'ArduronSwarm/example', branches: { development: 'development', production: 'main' }, jira: { baseUrl: 'https://arduron.atlassian.net', projectKeys: ['AR', 'SP'], startDateField: 'customfield_10015', storyTypeField: 'customfield_10327', productionFinalization: true }, release: { enabled: false, planning: false, candidates: false, prefix: 'example' }, projects: { enabled: false }, pullRequests: { largeChangeThreshold: 20, allowHotfixToMain: true, requireLabel: false } };
const issue = (status, date = null, type = 'Story') => ({ fields: { status: { name: status }, issuetype: { name: type }, customfield_10015: date, fixVersions: [] } });
const validPr = { number: 1, head: { ref: 'AR-2920-fix', repo: { full_name: profile.repository } }, title: 'AR-2920 Fix', base: { ref: 'development', repo: { full_name: profile.repository } }, author_association: 'MEMBER', html_url: 'https://github.com/ArduronSwarm/example/pull/1' };
function sequence(responses) { const calls = []; return { calls, async request(path, options = {}) { calls.push({ path, ...options }); const value = responses.shift(); if (value instanceof Error) throw value; if (value === undefined) throw Error(`Unexpected mock request ${path}`); return value; } }; }

test('profile version, origin and branch contract are strict', () => {
  assert.equal(validateProfile(structuredClone(profile)).schemaVersion, 1);
  for (const changed of [{ engineVersion: '2' }, { jira: { ...profile.jira, baseUrl: 'http://arduron.atlassian.net' } }, { branches: { production: 'other', development: 'development' } }]) assert.throws(() => validateProfile({ ...profile, ...changed }));
});
test('HTTP errors and HTML cannot be reported as successful mutations', async () => {
  for (const method of ['POST', 'PUT', 'PATCH']) {
    const client = createClient({ service: 'Jira', baseUrl: profile.jira.baseUrl, authorization: 'secret', fetchImpl: async () => new Response('<private error>', { status: 403 }) });
    await assert.rejects(client.request('/rest/api/3/issue/AR-1', { method, body: {} }), error => error.status === 403 && !error.message.includes('private'));
  }
  const client = createClient({ service: 'Jira', baseUrl: profile.jira.baseUrl, authorization: 'secret', fetchImpl: async () => new Response('<html>proxy</html>') });
  await assert.rejects(client.request('/rest/api/3/version'), /non-JSON/);
  await assert.rejects(client.request('//foreign.example/path'), /relative/);
});
test('Jira start date is idempotent and never overwritten', async () => {
  const first = sequence([issue('To Do'), { transitions: [{ id: '2', to: { name: 'In Progress' } }] }, null, null]);
  await transitionIssue(first, 'AR-1', 'In Progress', { profile, today: '2026-10-27' });
  assert.equal(first.calls.filter(call => call.method === 'PUT')[0].body.fields.customfield_10015, '2026-10-27');
  const retry = sequence([issue('In Progress', '2026-10-26')]);
  await transitionIssue(retry, 'AR-1', 'In Progress', { profile });
  assert.equal(retry.calls.length, 1);
  const later = sequence([issue('PR Merged')]);
  assert.equal((await transitionIssue(later, 'AR-1', 'In Progress', { profile })).reason, 'later-or-terminal-state');
  assert.equal(later.calls.length, 1);
});
test('only exact unambiguous transitions apply and HTTP failure propagates', async () => {
  for (const transitions of [[{ id: '1', to: { name: 'Dev-Done' } }], [{ id: '1', to: { name: 'PR Merged' } }, { id: '2', to: { name: 'PR Merged' } }]]) {
    const client = sequence([issue('PR in Review'), { transitions }]);
    await assert.rejects(transitionIssue(client, 'AR-1', 'PR Merged', { profile }), /expected one exact/);
    assert.equal(client.calls.some(call => call.method === 'POST'), false);
  }
  const client = sequence([issue('PR in Review'), { transitions: [{ id: '1', to: { name: 'PR Merged' } }] }, Error('POST rejected')]);
  await assert.rejects(transitionIssue(client, 'AR-1', 'PR Merged', { profile }), /POST rejected/);
});
test('Epic and QA types are not moved; production requires QA or owner acceptance', async () => {
  for (const type of ['Epic', 'QA Sub-task', 'QA-Tech']) {
    const client = sequence([issue('To Do', null, type)]);
    assert.equal((await applyStage(client, 'AR-1', 'started', profile)).outcome, 'skipped');
    assert.equal(client.calls.length, 1);
  }
  const client = sequence([issue('PR Merged')]);
  assert.equal((await transitionIssue(client, 'AR-1', 'Done', { profile, production: true })).reason, 'owner-qa-acceptance-required');
  assert.equal(client.calls.length, 1);
});
test('drafts, review, closed-unmerged and development merge stages differ', () => {
  assert.equal(stageForPr({ ...validPr, draft: true }, 'opened'), 'started');
  assert.equal(stageForPr(validPr, 'ready_for_review'), 'review');
  assert.equal(stageForPr({ ...validPr, merged: true }, 'closed'), 'merged');
  assert.equal(stageForPr({ ...validPr, merged: false }, 'closed'), null);
  assert.equal(stageForPr({ ...validPr, merged: true, base: { ref: 'main' } }, 'closed'), null);
});
test('keys and PR repository boundaries are unambiguous', () => {
  for (const value of ['AR-2920', 'hotfix/AR-2920-test', '[AR-2920] Fix', 'SP-1_test']) assert.ok(issueKey(value));
  for (const value of ['prefixAR-1suffix', 'AR-0', 'AR-1 AR-2', 'OTHER-1']) assert.equal(issueKey(value), null);
  assert.equal(keyForPr({ ...validPr, title: 'AR-99 other' }, profile), null);
  assert.equal(trustedPr(validPr, profile.repository), true);
  assert.equal(trustedPr({ ...validPr, head: { repo: { full_name: 'foreign/fork' } } }, profile.repository), false);
});
test('pagination reads later pages and managed body preserves user content', async () => {
  const client = sequence([Array.from({ length: 100 }, (_, id) => ({ id })), [{ id: 100 }]]);
  assert.equal((await githubPages(client, '/items')).length, 101);
  assert.match(client.calls[1].path, /page=2/);
  const body = managedPrBody('My detailed description\n\n- [x] Tested', 'AR-2920', profile);
  assert.match(body, /My detailed description/);
  assert.equal(managedPrBody(body, 'AR-2920', profile), body);
});
const runRecord = { id: 12, workflow_id: 3, path: '.github/workflows/deploy-production.yml', status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_repository: { full_name: profile.repository }, head_sha: 'a'.repeat(40) };
const marker = { schemaVersion: 1, repository: profile.repository, sha: runRecord.head_sha, environment: 'production', deployed: true, healthCheck: 'passed', runId: '12' };
test('production evidence binds run, repository, SHA and health; manual main is valid', () => {
  assert.equal(validateDeploymentEvidence(marker, runRecord, profile).sha, marker.sha);
  assert.equal(validateDeploymentEvidence(marker, { ...runRecord, event: 'workflow_dispatch' }, profile).runId, '12');
  for (const changed of [{ event: 'pull_request' }, { head_branch: 'development' }, { conclusion: 'skipped' }, { head_repository: { full_name: 'foreign/fork' } }, { path: '.github/workflows/ci.yml' }]) assert.throws(() => validateDeploymentEvidence(marker, { ...runRecord, ...changed }, profile));
  for (const changed of [{ sha: 'b'.repeat(40) }, { deployed: false }, { healthCheck: 'skipped' }, { runId: '13' }, { repository: 'foreign/fork' }, { schemaVersion: 2 }]) assert.throws(() => validateDeploymentEvidence({ ...marker, ...changed }, runRecord, profile));
});
test('successful producer with skipped deploy and no marker is deferred', async () => {
  const github = sequence([runRecord, { id: 3, path: '.github/workflows/deploy-production.yml' }, { artifacts: [], total_count: 0 }]);
  const proof = await verifiedProduction({ workflow_run: { id: 12 } }, { GITHUB_EVENT_NAME: 'workflow_run', GH_TOKEN: 'mock' }, profile, github, () => { throw Error('Must not download'); });
  assert.equal(proof.valid, false); assert.equal(proof.reason, 'deployment-marker-absent');
});
test('open PRs and missing visibility prevent Done', async () => {
  const registry = [{ object: { url: validPr.html_url } }];
  const client = sequence([{ ...validPr, merged: false, state: 'open' }]);
  assert.equal((await associatedPrGuard(sequence([registry]), client, 'AR-2920', profile)).reason, 'associated-pr-open-or-unmerged');
  const error = Error('Forbidden'); error.status = 404;
  assert.equal((await associatedPrGuard(sequence([registry]), sequence([error]), 'AR-2920', profile)).reason, 'associated-pr-visibility-incomplete');
});
test('all development PRs merged in a multi-repo cohort is still not production acceptance', async () => {
  const registry = [{ object: { url: validPr.html_url } }, { object: { url: 'https://github.com/ArduronSwarm/other/pull/2' } }];
  const cohortProfile = { ...profile, jira: { ...profile.jira, completionCohorts: { 'AR-2920': [profile.repository, 'ArduronSwarm/other'] } } };
  const noRequests = sequence([]);
  assert.equal((await associatedPrGuard(sequence([registry]), noRequests, 'AR-2920', cohortProfile)).reason, 'multi-repository-production-acceptance-required');
  assert.equal(noRequests.calls.length, 0);
});
test('same-SHA releases are idempotent and tag collisions never delete releases', async () => {
  const existing = { target_commitish: marker.sha, draft: false, tag_name: 'v1.0.0' };
  const client = sequence([[existing]]);
  assert.equal(await publishRelease(client, profile, marker.sha), existing);
  assert.equal(client.calls.length, 1);
  const collision = sequence([[existing]]);
  await assert.rejects(publishRelease(collision, profile, 'b'.repeat(40), { tag: 'v1.0.0' }), /already belongs/);
  assert.equal(collision.calls.some(call => call.method === 'DELETE'), false);
  await assert.rejects(publishRelease(sequence([]), profile, 'main'), /immutable/);
});
test('tag-create, fork and foreign PR events perform no Jira mutation', async () => {
  const never = () => { throw Error('Unexpected Jira call'); };
  assert.equal((await run('branch-created', { profile, event: { ref_type: 'tag' }, jira: never })).reason, 'not-a-branch');
  const env = { GITHUB_REPOSITORY: profile.repository, GITHUB_EVENT_NAME: 'pull_request_target', AUTOMATION_CODE_SHA: marker.sha };
  const event = { repository: { full_name: profile.repository }, pull_request: { number: 1 }, action: 'opened' };
  const github = sequence([{ ...validPr, author_association: 'NONE' }]);
  assert.equal((await run('pr-pipeline', { profile, event, env, github, jira: never })).reason, 'external-or-unauthorized-pr');
  await assert.rejects(run('pr-pipeline', { profile, event: { ...event, repository: { full_name: 'foreign/fork' } }, env, github, jira: never }), /repository/);
});
test('missing credentials is explicit and not a false successful transition', () => {
  assert.throws(() => jiraAuthorization({}), /not configured/);
  assert.equal(jiraAuthorization({ JIRA_AUTH: 'encoded' }), 'Basic encoded');
});
test('fixVersion retries read the field and do not duplicate existing associations', async () => {
  const present = issue('PR Merged'); present.fields.fixVersions = [{ id: '5' }];
  const retry = sequence([present]);
  assert.equal((await addFixVersion(retry, 'AR-1', { id: '5' }, profile)).outcome, 'unchanged');
  assert.equal(retry.calls.length, 1);
  assert.match(retry.calls[0].path, /fixVersions/);
  const missing = sequence([issue('PR Merged'), null]);
  assert.equal((await addFixVersion(missing, 'AR-1', { id: '5' }, profile)).outcome, 'added');
  assert.equal(missing.calls[1].method, 'PUT');
});
test('new repositories create only missing managed labels and reject hidden permission errors', async () => {
  const missing = Error('missing'); missing.status = 404;
  const exists = sequence([{ name: 'large-pr' }]);
  await ensureAutomationLabel(exists, profile.repository, 'large-pr'); assert.equal(exists.calls.length, 1);
  const create = sequence([missing, { name: 'large-pr' }]);
  await ensureAutomationLabel(create, profile.repository, 'large-pr'); assert.equal(create.calls[1].method, 'POST');
  const forbidden = Error('forbidden'); forbidden.status = 403;
  await assert.rejects(ensureAutomationLabel(sequence([forbidden]), profile.repository, 'large-pr'), /forbidden/);
  await assert.rejects(ensureAutomationLabel(sequence([]), profile.repository, 'user-label'), /Unknown/);
});
test('review submitted/dismissed refreshes health from base automation without Jira access', async () => {
  const pr = { ...validPr, state: 'open', head: { ...validPr.head, sha: 'a'.repeat(40) }, base: { ...validPr.base, sha: 'b'.repeat(40) }, labels: [{ name: 'bug' }], assignees: [{ login: 'writer' }], requested_reviewers: [], requested_teams: [] };
  for (const state of ['APPROVED', 'DISMISSED']) {
    const github = sequence([pr, [{ filename: 'one.js' }], [{ user: { login: 'reviewer' }, state, commit_id: pr.head.sha }], { ahead_by: 0 }, [], null]);
    const env = { GITHUB_REPOSITORY: profile.repository, GITHUB_EVENT_NAME: 'pull_request_review', AUTOMATION_CODE_SHA: pr.base.sha };
    const event = { repository: { full_name: profile.repository }, pull_request: { number: 1 }, action: state === 'APPROVED' ? 'submitted' : 'dismissed' };
    const jira = () => { throw Error('Review events must never access Jira'); };
    const result = await run('pr-health', { profile, env, event, github, jira });
    assert.equal(result.approvals, state === 'APPROVED' ? 1 : 0);
    await assert.rejects(run('pr-pipeline', { profile, env, event, github, jira }), /trusted base event/);
  }
});
