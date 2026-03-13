#!/bin/bash
MARKER="<!-- branch-rules-check -->"
[ "$PENDING" -eq 1 ] && STATUS="## ⏳ Branch Rules Checklist" || STATUS="## ✅ All Branch Rules Passed"

BODY="${MARKER}
${STATUS}

| Check | Status |
|-------|--------|
| Label | ${LABEL} |
| Assignee | ${ASSIGNEE} |
| Reviewer requested | ${REVIEWER} |
| Approval received | ${APPROVAL} |
| Branch up to date | ${UPDATE} |

*This comment updates automatically as requirements are met.*"

# Delete old-style comments
gh pr view "$PR_NUMBER" --json comments -q '.comments[] | select(.body | contains("❌ Branch Rules Check Failed")) | select(.body | contains("<!-- branch-rules-check -->") | not) | .id' | while read -r ID; do
  [ -n "$ID" ] && gh api graphql -f query='mutation($id: ID!) { deleteIssueComment(input: {id: $id}) { clientMutationId } }' -f id="$ID" || true
done

COMMENT_ID=$(gh pr view "$PR_NUMBER" --json comments -q ".comments[] | select(.body | contains(\"$MARKER\")) | .id" | head -1)
if [ -n "$COMMENT_ID" ]; then
  gh api graphql -f query='mutation($id: ID!, $body: String!) { updateIssueComment(input: {id: $id, body: $body}) { issueComment { id } } }' -f id="$COMMENT_ID" -f body="$BODY"
else
  gh pr comment "$PR_NUMBER" --body "$BODY"
fi
