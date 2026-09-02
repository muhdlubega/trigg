# Security model

Trigg treats webhook payloads, repository files, diffs, issue bodies, and model output as untrusted data.

- GitHub payloads are accepted only after HMAC-SHA256 verification and are deduplicated by `X-GitHub-Delivery`.
- Authenticated resource queries include the current Trigg user ID. Knowing a workflow or execution ID is not authorization.
- GitHub App installation tokens are short-lived and kept in Worker memory only. They are never returned to the browser or persisted.
- AI prompts explicitly separate repository data from system instructions. Model output cannot grant tool permissions.
- HTTP actions require HTTPS and block obvious loopback, link-local, and RFC1918 destinations. Production operators should add Cloudflare egress controls for stronger DNS-rebinding protection.
- Secrets belong in Worker secrets or `.dev.vars`, never in Vite variables, D1 rows, workflow definitions, or logs.
- Full diffs are passed through an execution only. Trigg persists event metadata and results; operators should add a retention policy appropriate to their deployment.

Report vulnerabilities privately to the deployment owner. Do not include credentials or private source code in a report.
