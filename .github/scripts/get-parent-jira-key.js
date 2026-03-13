const JIRA_BASE = 'https://arduron.atlassian.net';

module.exports = async function getParentJiraKey({ jiraKey, jiraAuth }) {
  if (!jiraAuth || !jiraKey) return null;

  try {
    const res = await fetch(
      `${JIRA_BASE}/rest/api/3/issue/${jiraKey}?fields=parent`,
      { headers: { Authorization: `Basic ${jiraAuth}`, Accept: 'application/json' } }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const parent = data.fields?.parent;
    if (!parent?.key) return null;

    const parentType = parent.fields?.issuetype?.name || '';
    if (parentType.toLowerCase() === 'epic') {
      console.log(`Subtask ${jiraKey} parent ${parent.key} is an Epic, skipping`);
      return null;
    }

    console.log(`Subtask ${jiraKey} has parent ${parent.key} (${parentType})`);
    return parent.key;
  } catch (e) {
    console.log(`Parent lookup error: ${e.message}`);
    return null;
  }
};
