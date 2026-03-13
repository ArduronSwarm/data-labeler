#!/bin/bash
PENDING=0

LABELS=$(gh pr view "$PR_NUMBER" --json labels -q '.labels | length')
[ "$LABELS" -eq 0 ] && echo "label=⏳" >> "$GITHUB_OUTPUT" && PENDING=1 || echo "label=✅" >> "$GITHUB_OUTPUT"

ASSIGNEES=$(gh pr view "$PR_NUMBER" --json assignees -q '.assignees | length')
[ "$ASSIGNEES" -eq 0 ] && echo "assignee=⏳" >> "$GITHUB_OUTPUT" && PENDING=1 || echo "assignee=✅" >> "$GITHUB_OUTPUT"

REVIEWERS=$(gh pr view "$PR_NUMBER" --json reviewRequests -q '.reviewRequests | length')
REVIEWS=$(gh pr view "$PR_NUMBER" --json reviews -q '.reviews | length')
[ $((REVIEWERS + REVIEWS)) -eq 0 ] && echo "reviewer=⏳" >> "$GITHUB_OUTPUT" && PENDING=1 || echo "reviewer=✅" >> "$GITHUB_OUTPUT"

APPROVALS=$(gh pr view "$PR_NUMBER" --json reviews -q '[.reviews[] | select(.state == "APPROVED")] | length')
[ "$APPROVALS" -eq 0 ] && echo "approval=⏳" >> "$GITHUB_OUTPUT" && PENDING=1 || echo "approval=✅" >> "$GITHUB_OUTPUT"

git fetch origin "$BASE_REF" --quiet
BEHIND=$(git rev-list --count "HEAD..origin/$BASE_REF" 2>/dev/null || echo "0")
[ "$BEHIND" -gt 0 ] && echo "update=⏳ ($BEHIND behind)" >> "$GITHUB_OUTPUT" || echo "update=✅" >> "$GITHUB_OUTPUT"

echo "pending=$PENDING" >> "$GITHUB_OUTPUT"
