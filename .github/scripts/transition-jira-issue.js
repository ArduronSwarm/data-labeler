const JIRA_BASE = 'https://arduron.atlassian.net';

module.exports = async function transitionJiraIssue({ jiraKey, jiraAuth, targetStatus }) {
  if (!jiraAuth || !jiraKey) return;

  try {
    const res = await fetch(
      `${JIRA_BASE}/rest/api/3/issue/${jiraKey}/transitions`,
      { headers: { Authorization: `Basic ${jiraAuth}`, Accept: 'application/json' } }
    );
    if (!res.ok) return;

    const { transitions } = await res.json();
    const search = targetStatus.toLowerCase();
    // Prefer exact match on destination status name, fallback to includes
    const target =
      transitions.find(t => t.to && t.to.name && t.to.name.toLowerCase() === search) ||
      transitions.find(t => t.name.toLowerCase().includes(search)) ||
      transitions.find(t => t.to && t.to.name && t.to.name.toLowerCase().includes(search));
    if (target) {
      await fetch(
        `${JIRA_BASE}/rest/api/3/issue/${jiraKey}/transitions`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${jiraAuth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ transition: { id: target.id } })
        }
      );
      console.log(`Transitioned ${jiraKey} to ${target.name}`);
    } else {
      console.log(`No transition found matching "${targetStatus}" (may already be in that status)`);
    }

    // Set start date when targeting In Progress (even if already there)
    if (search === 'in progress') {
      const today = new Date().toISOString().split('T')[0];
      await fetch(`${JIRA_BASE}/rest/api/3/issue/${jiraKey}`, {
        method: 'PUT',
        headers: { Authorization: `Basic ${jiraAuth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { customfield_10015: today } })
      });
      console.log(`Set start date for ${jiraKey} to ${today}`);
    }
  } catch (e) {
    console.log(`Jira transition error: ${e.message}`);
  }
};
