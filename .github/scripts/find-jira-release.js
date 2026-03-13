const JIRA_BASE = 'https://arduron.atlassian.net';
const PROJECT_KEY = 'AR';
const SUFFIX_PATTERN = /-(ui|api|server|backend|frontend)$/i;

module.exports = async function findJiraRelease({ repoName, jiraAuth, releaseNameOverride }) {
  if (!jiraAuth) return null;

  const searchName = releaseNameOverride || repoName.replace(SUFFIX_PATTERN, '');

  try {
    const res = await fetch(
      `${JIRA_BASE}/rest/api/3/project/${PROJECT_KEY}/versions`,
      { headers: { Authorization: `Basic ${jiraAuth}`, Accept: 'application/json' } }
    );
    if (!res.ok) return null;

    const versions = await res.json();
    const match = versions.find(
      v => !v.released && !v.archived && v.name.toLowerCase().includes(searchName.toLowerCase())
    );

    if (!match) return null;

    return {
      id: match.id,
      name: match.name,
      url: `${JIRA_BASE}/projects/${PROJECT_KEY}/versions/${match.id}`
    };
  } catch (e) {
    console.log(`Jira release API error: ${e.message}`);
    return null;
  }
};
