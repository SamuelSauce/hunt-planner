# Project Working Agreement

## Testable handoff is required

- Every completed implementation task must end with a link to a testable deployed version of the changes.
- Prefer an isolated preview deployment or preview channel. Do not overwrite the production site unless the user explicitly asks for a production release.
- Verify that the preview loads before sharing the link.
- Include the preview URL prominently in the final response.
- If a preview cannot be published, do not present the task as fully complete; explain the blocker and the exact next action needed.

## A merge command includes a production deployment

- When the user explicitly instructs Codex to merge a pull request, the task is not complete when the pull request merges.
- After the merge succeeds, build and deploy the merged `main` branch to the production hosting target.
- A preview deployment does not satisfy this requirement.
- Verify that the production URL loads before reporting completion.
- Include both the merged pull request link and the live production URL in the final response.
- If the production deployment fails, report the merge as complete but the overall task as blocked, with the deployment failure and required next action.
