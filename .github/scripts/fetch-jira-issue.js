const JIRA_BASE = 'https://arduron.atlassian.net';

module.exports = async function fetchJiraIssue({ jiraKey, jiraAuth, github, author }) {
  const jiraUrl = `${JIRA_BASE}/browse/${jiraKey}`;

  if (!jiraAuth) {
    return { section: `[${jiraKey}](${jiraUrl})` };
  }

  let ticketTitle = '';
  try {
    const res = await fetch(
      `${JIRA_BASE}/rest/api/3/issue/${jiraKey}?fields=summary`,
      { headers: { Authorization: `Basic ${jiraAuth}`, Accept: 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      ticketTitle = data.fields.summary;
    }

    const ghUser = await github.rest.users.getByUsername({ username: author });
    const email = ghUser.data.email;
    if (email) {
      const users = await fetch(
        `${JIRA_BASE}/rest/api/3/user/search?query=${email}`,
        { headers: { Authorization: `Basic ${jiraAuth}`, Accept: 'application/json' } }
      );
      if (users.ok) {
        const found = await users.json();
        if (found.length > 0) {
          await fetch(
            `${JIRA_BASE}/rest/api/3/issue/${jiraKey}/assignee`,
            {
              method: 'PUT',
              headers: { Authorization: `Basic ${jiraAuth}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId: found[0].accountId })
            }
          );
          console.log(`Assigned Jira ${jiraKey} to ${email}`);
        }
      }
    }

  } catch (e) {
    console.log(`Jira API error: ${e.message}`);
  }

  const section = ticketTitle
    ? `[${jiraKey} - ${ticketTitle}](${jiraUrl})`
    : `[${jiraKey}](${jiraUrl})`;

  return { section };
};
