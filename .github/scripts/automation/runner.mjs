import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  loadProfile, createClient, githubPages, issueKey, keyForPr, trustedPr, stageForPr,
  applyStage, managedPrBody, healthReport, upsertComment, ensureRemoteLink, ensureAutomationLabel,
  validateDeploymentEvidence, discoverDeploymentKeys, associatedPrGuard,
  transitionIssue, getIssue, excludedIssue, jiraVersion, selectPlannedVersion, addFixVersion,
  nextTag, publishRelease,
} from './engine.mjs';
import { downloadEvidence } from './artifact.mjs';

export function jiraAuthorization(env) {
  if (env.JIRA_AUTH) return `Basic ${env.JIRA_AUTH}`;
  if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) return `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`;
  throw Error('Jira is not configured: provide JIRA_AUTH or JIRA_EMAIL and JIRA_API_TOKEN');
}
function output(env, name, value) {
  if (!/^[a-z][a-z_]*$/.test(name) || /[\r\n]/.test(String(value))) throw Error('Unsafe workflow output');
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function checkIdentity(event, env, profile) {
  if (env.GITHUB_REPOSITORY !== profile.repository || event.repository?.full_name !== profile.repository) throw Error('Event repository does not match automation profile');
  if (!/^[a-f0-9]{40}$/.test(env.AUTOMATION_CODE_SHA || '')) throw Error('Automation code must come from a trusted immutable commit');
}
async function pullRequest(event, env, profile, github, { health = false } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request_target' && !(health && env.GITHUB_EVENT_NAME === 'pull_request_review')) throw Error('PR administration requires a trusted base event');
  const number = event.pull_request?.number;
  if (!Number.isSafeInteger(number) || number < 1) throw Error('Invalid PR event number');
  const pr = await github.request(`/repos/${profile.repository}/pulls/${number}`);
  if (pr.number !== number || !trustedPr(pr, profile.repository)) return null;
  if (![profile.branches.development, profile.branches.production].includes(pr.base.ref)) return null;
  return pr;
}
export async function verifiedProduction(event, env, profile, github, fetchImpl = fetch) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_run' || !profile.jira.productionFinalization) throw Error('Production finalization is not enabled for this event');
  const id = event.workflow_run?.id;
  if (!Number.isSafeInteger(id) || id < 1) throw Error('Invalid producer run identity');
  const run = await github.request(`/repos/${profile.repository}/actions/runs/${id}`);
  const workflow = await github.request(`/repos/${profile.repository}/actions/workflows/deploy-production.yml`);
  if (run.id !== id || workflow.id !== run.workflow_id || workflow.path !== '.github/workflows/deploy-production.yml') throw Error('Producer workflow identity mismatch');
  // Validate producer before downloading any artifact. A completed workflow can still have skipped deploy jobs.
  validateDeploymentEvidence({ schemaVersion: 1, repository: profile.repository, sha: run.head_sha, environment: 'production', deployed: true, healthCheck: 'passed', runId: String(id) }, run, profile);
  const marker = await downloadEvidence(github, profile.repository, id, env.GH_TOKEN, fetchImpl);
  if (!marker) return { valid: false, reason: 'deployment-marker-absent' };
  return { valid: true, ...validateDeploymentEvidence(marker, run, profile) };
}
export async function run(mode, { profile, event, env = process.env, github, jira, fetchImpl = fetch } = {}) {
  // Tags never start Jira work, even if they contain a ticket key.
  if (mode === 'branch-created' && event.ref_type !== 'branch') return { outcome: 'skipped', reason: 'not-a-branch' };
  checkIdentity(event, env, profile);
  const root = `/repos/${profile.repository}`;
  if (mode === 'branch-created') {
    if (env.GITHUB_EVENT_NAME !== 'create') throw Error('Unexpected branch event');
    const key = issueKey(event.ref, profile.jira.projectKeys);
    if (!key || [profile.branches.production, profile.branches.development].includes(event.ref)) return { outcome: 'skipped', reason: 'no-unambiguous-ticket-key' };
    const actor = event.sender?.login;
    if (!/^[A-Za-z0-9-]+$/.test(actor || '')) throw Error('Invalid branch actor');
    const permission = await github.request(`${root}/collaborators/${encodeURIComponent(actor)}/permission`);
    if (!['admin', 'maintain', 'write'].includes(permission.permission)) return { outcome: 'skipped', reason: 'branch-actor-not-authorized' };
    return applyStage(jira(), key, 'started', profile);
  }
  if (['pr-health', 'pr-pipeline'].includes(mode)) {
    const pr = await pullRequest(event, env, profile, github, { health: mode === 'pr-health' });
    if (!pr) return { outcome: 'skipped', reason: 'external-or-unauthorized-pr' };
    const key = keyForPr(pr, profile);
    if (!key) return { outcome: 'skipped', reason: 'no-unambiguous-ticket-key' };
    if (mode === 'pr-pipeline') {
      const client = jira();
      const issue = await getIssue(client, key, profile);
      if (excludedIssue(issue)) return { outcome: 'skipped', reason: 'issue-type-managed-by-owner', key };
      await ensureRemoteLink(client, key, pr, profile);
      if (pr.state === 'open') {
        const body = managedPrBody(pr.body, key, profile);
        if (body !== pr.body) await github.request(`${root}/pulls/${pr.number}`, { method: 'PATCH', body: { body } });
        if (!pr.assignees?.length && /^[A-Za-z0-9-]+$/.test(pr.user?.login || '')) await github.request(`${root}/issues/${pr.number}/assignees`, { method: 'POST', body: { assignees: [pr.user.login] } });
      }
      const stage = stageForPr(pr, event.action, profile.branches.development);
      const result = stage ? await applyStage(client, key, stage, profile) : { outcome: 'no-transition', key };
      if (stage === 'merged' && profile.release.planning && key.startsWith('AR-')) {
        const version = await selectPlannedVersion(client, profile, env.JIRA_RELEASE_NAME || '');
        if (version) await addFixVersion(client, key, version, profile);
        else result.releaseTracking = 'deferred: select one planned repository release';
      }
      return result;
    }
    if (pr.state !== 'open') return { outcome: 'skipped', reason: 'closed-pr' };
    const [files, reviews, comparison] = await Promise.all([
      githubPages(github, `${root}/pulls/${pr.number}/files`), githubPages(github, `${root}/pulls/${pr.number}/reviews`),
      github.request(`${root}/compare/${pr.head.sha}...${pr.base.sha}`),
    ]);
    const report = healthReport(pr, files, profile);
    const behind = comparison.ahead_by;
    if (!Number.isSafeInteger(behind) || behind < 0) throw Error('Incomplete branch comparison');
    if (behind) report.warnings.push('out-of-sync');
    const lastReviews = new Map();
    for (const review of reviews) if (review.user?.login && review.state !== 'COMMENTED') lastReviews.set(review.user.login, review);
    const approvals = [...lastReviews.values()].filter(review => review.state === 'APPROVED' && review.commit_id === pr.head.sha).length;
    if (reviews.length) report.missing = report.missing.filter(item => !item.startsWith('reviewer'));
    const healthLabels = ['out-of-sync', 'targets-main', 'large-pr'];
    const current = pr.labels.map(label => label.name);
    const wanted = report.warnings.filter(label => !current.includes(label));
    for (const label of wanted) await ensureAutomationLabel(github, profile.repository, label);
    if (wanted.length) await github.request(`${root}/issues/${pr.number}/labels`, { method: 'POST', body: { labels: wanted } });
    for (const label of healthLabels) if (current.includes(label) && !report.warnings.includes(label)) await github.request(`${root}/issues/${pr.number}/labels/${label}`, { method: 'DELETE' });
    const meaningfulLabel = pr.labels.some(label => !healthLabels.includes(label.name));
    const marker = '<!-- othryn-automation:pr-health -->';
    const body = `${marker}\n## PR Health\n\n| Check | Status |\n|---|---|\n| Label | ${meaningfulLabel ? 'Present' : 'Missing'} |\n| Assignee | ${pr.assignees?.length ? 'Present' : 'Pending'} |\n| Review | ${reviews.length || pr.requested_reviewers?.length || pr.requested_teams?.length ? 'Present' : 'Pending'} |\n| Approval for current commit | ${approvals || 'Pending'} |\n| Branch | ${behind ? `${behind} commits behind base` : 'Up to date'} |\n| Changed files | ${report.fileCount} |\n\n${report.warnings.length ? `Warnings: ${report.warnings.join(', ')}.` : 'No health warnings.'}\n${pr.draft ? 'Draft: Jira stays In Progress; review starts when ready.' : ''}`;
    await upsertComment(github, profile.repository, pr.number, marker, body);
    if (profile.pullRequests.requireLabel && !meaningfulLabel) throw Error('A descriptive PR label is required');
    return { outcome: 'checked', key, warnings: report.warnings, approvals };
  }
  if (mode === 'projects') {
    if (!profile.projects.enabled) return { outcome: 'skipped', reason: 'projects-opt-in-disabled' };
    const pr = await pullRequest(event, env, profile, github);
    if (!pr || !keyForPr(pr, profile)) return { outcome: 'skipped', reason: 'external-or-unkeyed-pr' };
    if (!env.PROJECT_TOKEN) throw Error('Projects is enabled but PROJECT_TOKEN is missing');
    const url = profile.projects.url;
    const match = /^https:\/\/github\.com\/orgs\/ArduronSwarm\/projects\/([1-9]\d*)$/.exec(url || '');
    if (!match || !/^[A-Za-z0-9_=-]+$/.test(pr.node_id || '')) throw Error('Invalid Projects configuration');
    const client = createClient({ service: 'GitHub Projects', baseUrl: 'https://api.github.com', authorization: `Bearer ${env.PROJECT_TOKEN}`, fetchImpl });
    const result = await client.request('/graphql', { method: 'POST', body: { query: 'query($number:Int!){organization(login:"ArduronSwarm"){projectV2(number:$number){id}}}', variables: { number: Number(match[1]) } } });
    const projectId = result.data?.organization?.projectV2?.id;
    if (result.errors || !projectId) throw Error('Projects lookup failed');
    const added = await client.request('/graphql', { method: 'POST', body: { query: 'mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}', variables: { project: projectId, content: pr.node_id } } });
    if (added.errors || !added.data?.addProjectV2ItemById?.item?.id) throw Error('Projects update failed');
    return { outcome: 'project-item-added' };
  }
  if (mode === 'release-plan') {
    if (!profile.release.planning || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main') throw Error('Release planning requires manual execution on main');
    if (!/^v\d+\.\d+\.\d+$/.test(env.RELEASE_VERSION || '')) throw Error('Expected release version vMAJOR.MINOR.PATCH');
    if (env.RELEASE_DATE && (!/^\d{4}-\d{2}-\d{2}$/.test(env.RELEASE_DATE) || Number.isNaN(Date.parse(env.RELEASE_DATE)))) throw Error('Invalid release date');
    const version = await jiraVersion(jira(), profile, `${profile.release.prefix} ${env.RELEASE_VERSION}`, { create: true, releaseDate: env.RELEASE_DATE || undefined });
    return { outcome: 'planned', version: version.name, guidance: 'Set JIRA_RELEASE_NAME if multiple planned releases exist; a single active repository release is selected automatically.' };
  }
  if (mode === 'candidate') {
    if (!profile.release.candidates || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main') throw Error('Candidate preparation requires manual execution on main');
    const branch = await github.request(`${root}/branches/${profile.branches.development}`);
    const sha = branch.commit?.sha;
    const tag = `${await nextTag(github, profile)}-rc.${env.GITHUB_RUN_NUMBER}`;
    return { outcome: 'draft-release', release: (await publishRelease(github, profile, sha, { tag, draft: true })).html_url, sha };
  }
  if (mode.startsWith('release-')) {
    const proof = await verifiedProduction(event, env, profile, github, fetchImpl);
    output(env, 'valid', String(proof.valid));
    if (!proof.valid) return { outcome: 'deferred', reason: proof.reason };
    output(env, 'sha', proof.sha);
    if (mode === 'release-validate') return { outcome: 'validated', sha: proof.sha, runId: proof.runId };
    if (mode === 'release-publish') {
      if (!profile.release.enabled) return { outcome: 'skipped', reason: 'github-release-publication-disabled', sha: proof.sha };
      const release = await publishRelease(github, profile, proof.sha);
      return { outcome: 'published', sha: proof.sha, release: release.html_url };
    }
    if (mode !== 'release-finalize') throw Error('Unknown release operation');
    const discovered = await discoverDeploymentKeys(github, profile, proof.sha);
    if (!discovered.keys.length) return { outcome: 'deferred', reason: discovered.reason || 'no-ticket-key-in-validated-range', sha: proof.sha };
    const client = jira(), results = [];
    let version;
    if (profile.release.enabled) {
      const releases = await githubPages(github, `${root}/releases`);
      const published = releases.find(release => !release.draft && release.target_commitish === proof.sha);
      if (!published) throw Error('No published release for the validated production SHA');
      version = await jiraVersion(client, profile, `${profile.release.prefix} ${published.tag_name}`, { create: true, released: true, releaseDate: new Date().toISOString().slice(0, 10) });
    }
    for (const key of discovered.keys) {
      const issue = await getIssue(client, key, profile);
      if (excludedIssue(issue)) { results.push({ key, outcome: 'skipped', reason: 'issue-type-managed-by-owner' }); continue; }
      if (version && key.startsWith('AR-')) await addFixVersion(client, key, version, profile);
      const guard = await associatedPrGuard(client, github, key, profile);
      results.push(guard.allowed ? await transitionIssue(client, key, 'Done', { profile, production: true }) : { key, outcome: 'deferred', reason: guard.reason });
    }
    return { outcome: 'reconciled', sha: proof.sha, tickets: results };
  }
  if (mode === 'repo-status') {
    if (!['push', 'schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) throw Error('Unexpected status event');
    const [comparison, prs] = await Promise.all([github.request(`${root}/compare/main...development`), githubPages(github, `${root}/pulls?state=open`)]);
    return { outcome: 'reported', ahead: comparison.ahead_by, behind: comparison.behind_by, openPullRequests: prs.length, healthWarnings: prs.filter(pr => pr.labels.some(label => ['out-of-sync', 'targets-main', 'large-pr'].includes(label.name))).length };
  }
  if (mode === 'push-alert') {
    if (env.GITHUB_EVENT_NAME !== 'push' || !['refs/heads/main', 'refs/heads/development'].includes(env.GITHUB_REF) || event.deleted) return { outcome: 'skipped', reason: 'not-an-environment-push' };
    if (!/^[a-f0-9]{40}$/.test(event.after || '')) throw Error('Invalid push commit');
    const prs = await githubPages(github, `${root}/commits/${event.after}/pulls`, 100);
    if (prs.some(pr => pr.merged_at && pr.base?.ref === env.GITHUB_REF.slice(11) && pr.merge_commit_sha === event.after)) return { outcome: 'skipped', reason: 'associated-pr-merge' };
    const marker = `<!-- othryn-direct-push:${event.after} -->`;
    const issues = await githubPages(github, `${root}/issues?state=all&labels=direct-push`);
    if (issues.some(issue => issue.body?.includes(marker))) return { outcome: 'unchanged' };
    await ensureAutomationLabel(github, profile.repository, 'direct-push');
    await github.request(`${root}/issues`, { method: 'POST', body: { title: `Direct push to ${env.GITHUB_REF.slice(11)}`, body: `${marker}\nCommit: ${event.after}\n\nNo merged pull request was associated with this environment push. Review the commit and repository merge policy.`, labels: ['direct-push'] } });
    return { outcome: 'alert-created' };
  }
  throw Error('Unknown automation operation');
}
export async function main() {
  const env = process.env, profile = loadProfile();
  if (!env.GH_TOKEN) throw Error('GH_TOKEN is required');
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const github = createClient({ service: 'GitHub', baseUrl: 'https://api.github.com', authorization: `Bearer ${env.GH_TOKEN}` });
  const jira = () => createClient({ service: 'Jira', baseUrl: profile.jira.baseUrl, authorization: jiraAuthorization(env) });
  const result = await run(process.argv[2], { profile, event, env, github, jira });
  console.log(JSON.stringify(result));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Automation result\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
