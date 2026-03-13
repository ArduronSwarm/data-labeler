module.exports = function buildPrBody({ branchName, currentBody, jiraSection, release }) {
  let body = currentBody;
  let needsUpdate = false;
  let prTitle = undefined;

  if (!body.includes('## What was done')) {
    const keyMatch = branchName.match(/^((?:SP|AR)-\d+)-(.*)/);
    prTitle = branchName.replace(/-/g, ' ');
    if (keyMatch) {
      const rest = keyMatch[2];
      const suffix = rest.match(/-(\d+)$/);
      const titleBody = (suffix ? rest.slice(0, -suffix[0].length) : rest).replace(/-/g, ' ');
      prTitle = suffix ? `${keyMatch[1]} ${titleBody}-${suffix[1]}` : `${keyMatch[1]} ${titleBody}`;
    }

    const parts = [jiraSection];
    if (release) parts.push(`🚀 Release: [${release.name}](${release.url})`);
    parts.push('', '## What was done', body, '', '## Tickets',
      '- [ ] DEV:', '- [ ] Frontend:', '- [ ] QA (if applicable):');
    body = parts.join('\n');
    needsUpdate = true;
  } else {
    const headerParts = [];
    if (jiraSection && !body.includes('atlassian.net')) headerParts.push(jiraSection);
    if (release && !body.includes('Release:')) headerParts.push(`🚀 Release: [${release.name}](${release.url})`);
    if (headerParts.length) {
      body = headerParts.join('\n') + '\n' + body;
      needsUpdate = true;
    }
  }

  return { body, prTitle, needsUpdate };
};
