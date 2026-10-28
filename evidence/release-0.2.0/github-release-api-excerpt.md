# GitHub Release API 权限原文摘录

来源：https://docs.github.com/en/rest/releases/releases#create-a-release
抓取日期：2026-10-28（smart-search fetch）

Users with push access to the repository can create a release.

Note

If the commit identified by `target_commitish` (or, when `target_commitish` is omitted, the latest commit on the default branch) adds or modifies any file under `.github/workflows/` relative to the repository's default branch, the authenticating token must be authorized to modify workflows. Otherwise, this endpoint returns `404 Not Found`; some authentication paths surface `403 Resource not accessible by integration` instead.

OAuth app tokens and personal access tokens (classic) need the `workflow` scope when the resolved target commit modifies workflow files. Fine-grained access tokens and GitHub App installation tokens also need the "Workflows" repository permission (write). The `GITHUB_TOKEN` available to GitHub Actions cannot be authorized for this; for more information, see "[Automatic token authentication](https://docs.github.com/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token)".
