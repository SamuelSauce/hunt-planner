# Project Working Agreement

## Firebase Hosting is the canonical deployment target

- Every completed implementation task must build and deploy the validated changes to the Firebase Hosting site configured by `.firebaserc` and `firebase.json`.
- This is a standing project requirement and does not require a separate production-release request.
- Sites or other preview deployments may be used during development, but they do not replace the required Firebase deployment.
- Verify that the Firebase production URL loads before sharing it.
- Include the live Firebase URL prominently in the final response.
- If Firebase cannot be deployed, do not present the implementation task as fully complete; explain the blocker and the exact next action needed.

## A merge command includes a production deployment

- When the user explicitly instructs Codex to merge a pull request, the task is not complete when the pull request merges.
- After the merge succeeds, build and deploy the merged `main` branch to the configured Firebase Hosting site.
- A preview deployment does not satisfy this requirement.
- Verify that the Firebase production URL loads before reporting completion.
- Include both the merged pull request link and the live production URL in the final response.
- If the production deployment fails, report the merge as complete but the overall task as blocked, with the deployment failure and required next action.
