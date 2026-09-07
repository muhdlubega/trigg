# Trigg

Trigg reviews GitHub pull requests with Mistral and automatically falls back to Gemini when Mistral is unavailable. Users authenticate with Firebase, install the Trigg GitHub App, choose repositories, and create repository-bound review workflows. New PR webhooks and manual **Run now** actions fetch the real PR diff and post the review back to GitHub.

## Architecture

- React/Vite frontend on Cloudflare Pages
- Hono API on Cloudflare Workers
- Firebase Authentication (Google and GitHub providers)
- GitHub App installation tokens and signed webhooks
- Cloudflare D1 for users, repositories, workflows, executions, and audit data
- Cloudflare Queues for webhook and workflow execution
- Mistral primary AI provider; Gemini fallback

There is no runtime mock mode or seeded application data.

## Local setup

Requirements: Node.js 20+, pnpm 10+, a Firebase project, a GitHub App, Mistral and Gemini API keys, and a Cloudflare account.

```powershell
pnpm install
Copy-Item apps/web/.env.example apps/web/.env.local
```

Fill `apps/web/.env.local` with the Firebase Web App config and the local Worker URL. Enable Google and GitHub sign-in providers in Firebase Authentication. Add `localhost` and the deployed Pages host to Firebase Authentication's authorized domains.

Create `apps/worker/.dev.vars`:

```dotenv
FIREBASE_PROJECT_ID=your-firebase-project-id
GITHUB_APP_ID=your-github-app-id
GITHUB_APP_SLUG=your-github-app-slug
GITHUB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-random-webhook-secret
MISTRAL_API_KEY=your-mistral-key
GEMINI_API_KEY=your-gemini-key
```

Set the same non-secret identifiers in `wrangler.jsonc` (`FIREBASE_PROJECT_ID`, `GITHUB_APP_ID`, and `GITHUB_APP_SLUG`). Store private values with `wrangler secret put`; never place them in source control.

```powershell
pnpm db:migrate:local
pnpm dev
```

## GitHub App configuration

- Setup URL: `https://trigg.pages.dev/integrations/github/callback`
- Webhook URL: `https://trigg-worker.muhdlubegasiraje.workers.dev/webhooks/github`
- Repository permissions: Metadata read, Contents read, Pull requests read, Issues write
- Subscribe to: Pull request
- Request user authorization during installation: disabled

Use the same secret for the GitHub App webhook secret and the Worker's `GITHUB_WEBHOOK_SECRET`.

## Production deployment

Update `apps/web/.env.production` with the Firebase Web App config. Update the public Worker identifiers in `wrangler.jsonc`, then add secrets:

```powershell
pnpm --filter @trigg/worker exec wrangler secret put GITHUB_PRIVATE_KEY --config ../../wrangler.jsonc
pnpm --filter @trigg/worker exec wrangler secret put GITHUB_WEBHOOK_SECRET --config ../../wrangler.jsonc
pnpm --filter @trigg/worker exec wrangler secret put MISTRAL_API_KEY --config ../../wrangler.jsonc
pnpm --filter @trigg/worker exec wrangler secret put GEMINI_API_KEY --config ../../wrangler.jsonc
pnpm db:migrate:remote
pnpm build
pnpm deploy:worker
pnpm deploy:web
```

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

After deployment: sign in, connect a repository, create the AI Pull Request Reviewer, then open a PR or use **Run now**. The resulting execution records the provider/model usage and the GitHub PR receives a Trigg review comment.

## License

MIT
