# Project Working Agreement

## Firebase Hosting is the canonical deployment target

- Every completed implementation task must build and deploy the validated changes to the Firebase Hosting site configured by `.firebaserc` and `firebase.json`.
- This is a standing project requirement and does not require a separate production-release request.
- Sites or other preview deployments may be used during development, but they do not replace the required Firebase deployment.
- Verify that the Firebase production URL loads before sharing it.
- Include the live Firebase URL prominently in the final response.
- If Firebase cannot be deployed, do not present the implementation task as fully complete; explain the blocker and the exact next action needed.

## Keep automated and internal checks out of Analytics

- Start every automated or Codex-driven check of a public Hunt Planner page with `?analytics=off` (for example, `https://huntplanner-66d5e.web.app/?analytics=off`). The preference persists in that browser, and the app removes the parameter from the visible URL.
- The site also suppresses Analytics when it detects WebDriver, headless browsers, or Codex-related browser user agents, but the explicit query parameter is the reliable default.
- To restore Analytics collection in a browser that was opted out, visit any site page once with `?analytics=on`.

## A merge command includes a production deployment

- When the user explicitly instructs Codex to merge a pull request, the task is not complete when the pull request merges.
- After the merge succeeds, build and deploy the merged `main` branch to the configured Firebase Hosting site.
- A preview deployment does not satisfy this requirement.
- Verify that the Firebase production URL loads before reporting completion.
- Include both the merged pull request link and the live production URL in the final response.
- If the production deployment fails, report the merge as complete but the overall task as blocked, with the deployment failure and required next action.
