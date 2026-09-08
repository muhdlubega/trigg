import type { ReactNode } from 'react';
import { SiteChrome } from '../components/SiteChrome';

const UPDATED='8 September 2026';

function LegalPage({eyebrow,title,description,children}:{eyebrow:string;title:string;description:string;children:ReactNode}){
  return <SiteChrome legal>
    <article className="legal-page">
      <header>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <small className="legal-updated">Last updated {UPDATED}</small>
      </header>
      {children}
    </article>
  </SiteChrome>;
}

export function Docs(){
  return <LegalPage eyebrow="DOCUMENTATION" title="How Trigg reviews pull requests" description="Trigg is a GitHub App that reviews pull request diffs with Mistral, falls back to Gemini when needed, and posts the result on the pull request itself.">
    <nav className="legal-toc" aria-label="On this page">
      <a href="#get-started">Get started</a>
      <a href="#reviewer">Reviewer settings</a>
      <a href="#runs">Runs and delivery</a>
      <a href="#github-app">GitHub App</a>
      <a href="#architecture">Architecture</a>
      <a href="#limits">Limits</a>
    </nav>

    <h2 id="get-started">Get started</h2>
    <ol>
      <li>Sign in with GitHub or Google. Firebase verifies the identity; Trigg stores the resulting user record.</li>
      <li>Open Integrations and install the Trigg GitHub App on the repositories you want reviewed.</li>
      <li>On Workflows, select a repository, choose branches and review settings, and turn the reviewer on.</li>
      <li>Open a pull request against a selected branch, or use Run now on the dashboard to review the most recently updated open pull request.</li>
    </ol>
    <p>Firebase login identifies you. The GitHub App installation authorizes repositories. They are separate on purpose, so signing in with GitHub does not grant Trigg access to your code until you install the app.</p>

    <h2 id="reviewer">Reviewer settings</h2>
    <ul>
      <li><strong>Automatic code review</strong> starts a run when a pull request is opened against a listed base branch.</li>
      <li><strong>Target branches</strong> are comma-separated base branches such as main or develop.</li>
      <li><strong>Response format</strong> is concise or detailed. Detailed includes finding descriptions in the posted comment.</li>
      <li><strong>Focus</strong> is balanced, correctness, or security. That instruction is sent with the diff to the model.</li>
      <li><strong>Comment mode</strong> is always, or issues only. Issues only skips the GitHub comment when the review has no findings.</li>
    </ul>
    <p>Each save writes an immutable workflow version. Executions always run the version that was current when the run started.</p>

    <h2 id="runs">Runs and delivery</h2>
    <p>A run is created as queued as soon as you trigger it, then moves to running while the worker fetches the pull request diff, generates a structured review, and posts to GitHub. The executions list and the run detail page poll every ten seconds while a run is queued or running.</p>
    <p>A successful review is posted as a pull request review, not an issue comment, and a Trigg AI review check run is opened on the head commit and completed with the summary. If GitHub refuses the write, the execution is marked failed, but the review body is still stored and shown on the run page.</p>
    <p>Granting a permission on the GitHub App only files a request. Each existing installation has to accept it. Until it does, writes fail with 403 Resource not accessible by integration. The Integrations page lists the permissions the installation token actually carries.</p>

    <h2 id="github-app">GitHub App</h2>
    <p>The app needs Metadata read, Contents read, Pull requests write, and Checks write. Issues write is optional; reviews go through the pull request review API. Subscribe at least to pull_request, installation, and installation_repositories.</p>
    <ul>
      <li>Homepage: <code>https://trigg.pages.dev</code></li>
      <li>Setup URL: <code>https://trigg.pages.dev/integrations/github/callback</code></li>
      <li>Webhook URL: your Worker <code>/webhooks/github</code></li>
    </ul>
    <p>Keep the webhook secret identical to the Worker <code>GITHUB_WEBHOOK_SECRET</code>. The private key never belongs in source control.</p>

    <h2 id="architecture">Architecture</h2>
    <p>The React app on Cloudflare Pages talks to a Hono API on a Cloudflare Worker. Signed GitHub webhooks and Run now requests enqueue work on Cloudflare Queues. The queue consumer mints a short-lived installation token, calls Mistral first and Gemini if Mistral fails, validates the structured review, then writes node outputs, AI usage, and status to D1.</p>
    <p>Source is MIT licensed. Self-hosting needs a Firebase project, a GitHub App, Mistral and Gemini keys, and a Cloudflare account. Setup details live in the repository README.</p>

    <h2 id="limits">Limits</h2>
    <p>The default deployment allows 100 workflow runs and 50 AI reviews per user per UTC day. Hitting either limit fails the run instead of silently dropping it. Limits are configuration on the Worker, not a billing product.</p>
  </LegalPage>;
}

export function Privacy(){
  return <LegalPage eyebrow="PRIVACY" title="Privacy policy" description="This policy describes how the public Trigg deployment at trigg.pages.dev handles account, GitHub, and review data. A self-hosted copy is operated by whoever deploys it.">
    <p>Trigg is open source. This page covers the deployment served from <code>trigg.pages.dev</code> and its Worker. If you run your own instance, that operator is the controller and should publish their own notice.</p>

    <h2>Who we are</h2>
    <p>The public deployment is operated by the maintainers of the Trigg repository. Contact them through the project repository. There is no separate privacy inbox.</p>

    <h2>Data we store</h2>
    <ul>
      <li><strong>Account.</strong> Firebase UID, email if the identity provider supplies one, display name, and photo URL. Sessions are Firebase ID tokens verified on every API request.</li>
      <li><strong>GitHub installation.</strong> Installation id, account login, and the repositories the installation can see (full name, visibility, default branch, GitHub repository id).</li>
      <li><strong>Reviewer configuration.</strong> Enabled flag, target branches, response format, focus, and comment mode, stored as versioned workflow definitions.</li>
      <li><strong>Executions.</strong> Status, trigger payload (repository, pull request number, title, author, branches, head SHA), node inputs and outputs including the generated review, errors, duration, and AI usage (provider, model, token counts, latency). Secrets and API keys are not written to these rows.</li>
      <li><strong>Webhooks.</strong> Signed GitHub deliveries are stored as JSON so a run can be retried and audited. Payloads can include pull request titles, bodies, and user logins.</li>
    </ul>

    <h2>Data we process but do not keep as credentials</h2>
    <p>The Worker mints short-lived GitHub installation tokens in memory to read diffs and post reviews. Those tokens are not saved in D1. Pull request diffs are sent to Mistral, and to Gemini if Mistral fails, so the model can produce the review. Provider logs outside Trigg are governed by those providers.</p>

    <h2>Why we process it</h2>
    <p>Account data authenticates you. Installation data scopes GitHub access. Reviewer settings and execution records operate the product you asked for: reviewing pull requests and showing you what happened. We do not sell this data, and we do not use it to train models.</p>

    <h2>Sharing</h2>
    <p>Diffs and the review prompt go to Mistral and, on fallback, Gemini. Review comments and check runs go to GitHub using the installation you approved. Firebase holds the identity used to sign in. Cloudflare hosts the Worker, Queue, D1 database, and Pages site. We do not share account data with advertisers.</p>

    <h2>Retention and deletion</h2>
    <p>Records remain while your account and GitHub installation remain connected. Uninstalling the GitHub App stops new access to repositories; existing execution history stays until it is deleted from the database. There is no self-serve account-deletion button yet. Open an issue on the repository if you need an account and its stored executions removed from the public deployment.</p>

    <h2>Security</h2>
    <p>API routes require a verified Firebase token. GitHub webhooks are rejected unless the HMAC signature matches. Installation tokens expire. Private keys and provider API keys are Worker secrets, not frontend environment variables.</p>

    <h2>Children</h2>
    <p>Trigg is a developer tool. It is not directed at children under 16, and we do not knowingly store their data.</p>

    <p>Related: <a href="/terms">Terms</a> and <a href="/docs">Docs</a>.</p>
  </LegalPage>;
}

export function Terms(){
  return <LegalPage eyebrow="TERMS" title="Terms of use" description="These terms apply to the public Trigg deployment. The software itself is MIT licensed; using this hosted copy is a separate agreement.">
    <h2>The service</h2>
    <p>Trigg reviews GitHub pull requests you authorize, posts a review and a check run, and stores an execution trace. The public site at <code>trigg.pages.dev</code> is provided without charge and without a service-level agreement. Features, limits, and availability can change.</p>

    <h2>The software</h2>
    <p>The Trigg source code is available under the MIT License. Forking or self-hosting the repository is governed by that license, not by this page. These terms only cover the hosted deployment.</p>

    <h2>Your account</h2>
    <p>You must sign in with GitHub or Google and are responsible for that identity. You must only connect GitHub installations and repositories you are allowed to authorize. You must not probe, overload, or bypass the daily run or AI limits, and you must not use the service to process data you do not have the right to send to Mistral, Gemini, or GitHub.</p>

    <h2>Reviews are not a substitute for review</h2>
    <p>Model output can be incomplete or wrong. A Trigg review is an aid, not a security audit, legal opinion, or approval to merge. You remain responsible for the code that lands and for any comment the app posts on your behalf.</p>

    <h2>GitHub permissions</h2>
    <p>Installing the app grants the permissions listed in the GitHub App settings, currently metadata, contents, pull requests, and checks. Trigg uses them to read diffs, post reviews, and report check runs. Accepting a later permission request is your choice; refusing it will cause writes to fail.</p>

    <h2>Limits and acceptable use</h2>
    <p>The hosted deployment currently allows 100 workflow runs and 50 AI reviews per user per UTC day. We may suspend an account that abuses GitHub, the models, or the Worker. Do not submit secrets in pull request bodies or diffs you would not want stored in execution logs or sent to an AI provider.</p>

    <h2>Availability and disclaimer</h2>
    <p>The service is provided as is, without warranties of any kind, including merchantability, fitness for a particular purpose, and non-infringement. Rate limits, model outages, GitHub permission errors, and queue delays can prevent a review from posting even when the analysis succeeded.</p>

    <h2>Liability</h2>
    <p>To the extent permitted by law, the operators are not liable for indirect, incidental, or consequential damages, or for merge decisions, leaked secrets in diffs, or GitHub comments posted through your installation.</p>

    <h2>Changes</h2>
    <p>We may update these terms by changing this page. Continued use of the hosted deployment after the date above is acceptance of the updated terms. Stop using the hosted copy and uninstall the GitHub App if you do not agree.</p>

    <p>Related: <a href="/privacy">Privacy</a> and <a href="/docs">Docs</a>.</p>
  </LegalPage>;
}
