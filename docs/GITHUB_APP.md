# GitHub App setup

Create a GitHub App named **Trigg** in the account or organization that will own the app.

- Homepage URL: `https://trigg.pages.dev`
- Setup URL: `https://trigg.pages.dev/integrations/github/callback`
- Redirect on update: enabled
- Webhook URL: `https://<your-worker>/webhooks/github`
- Webhook secret: generate a strong random value and set the same value with `wrangler secret put GITHUB_WEBHOOK_SECRET`

Repository permissions:

- Metadata: read
- Contents: read
- Pull requests: read and write
- Checks: write
- Issues: optional; reviews are posted through the pull request review API

Subscribe to `pull_request`, `issues`, `issue_comment`, `push`, `installation`, and `installation_repositories`.

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` as Worker secrets/variables. The private key is the PKCS#8 PEM downloaded from GitHub. Never commit it.

Firebase GitHub login identifies a person. The GitHub App installation authorizes repositories. They are intentionally separate.
