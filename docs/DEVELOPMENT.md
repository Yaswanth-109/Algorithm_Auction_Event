# Development and delivery

## Local setup (planned)

Prerequisites: Node.js 22+, npm, and Docker Compose. Copy `.env.example` to `.env`, replace example secrets, and do not commit `.env`.

For local code execution, set `EXECUTION_BACKEND=docker` in `.env`, then build the isolated runner image with `docker build -t algorithm-auction-runner:local -f infra/runner/Dockerfile infra/runner`. This runner works with Docker Desktop's cgroup v2 engine and supports Python, Java, C, and C++. Each run uses an ephemeral container with no network, a read-only base filesystem, and CPU, memory, process-count, and output limits. Keep Docker available to the API user.

Team coding sessions use Yjs-backed live co-editing over the authenticated Socket.IO connection. Concurrent edits merge in the shared document, and the API persists the merged text and Yjs state to PostgreSQL. Apply the `CodingSession.collabState` migration with `npm run db:deploy -w @algorithm-auction/api` before starting the updated API.

Install dependencies from the repository root with `npm install`. Start PostgreSQL with `docker compose up -d postgres`, then apply the schema with `npm run db:migrate`. To provision the 22 generated accounts (two admins and ten two-member teams), keep the ignored `credentials.seed.json` at the repository root and run `npm run accounts:provision`. This command creates all accounts atomically and refuses to overwrite any matching account or team code. The matching workbook is `Algorithm_Auction_Credentials.xlsx`; treat it as sensitive because it contains passwords. Start the API and web services with `npm run dev`.

### Access from other devices on the LAN

The development API and web server bind to all network interfaces. `npm run dev` detects the host's current LAN IPv4 address, prints the browser and API readiness URLs, and sets `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` for that run. In development, the browser derives the API hostname from the address used to open the page, and the API allows the detected LAN origins plus localhost. It checks for address changes every five seconds and restarts the web and API services when the host changes networks. On WSL it tries to read the Windows host's active physical network address. Clients must be on a reachable network, and Windows Defender Firewall must allow inbound TCP ports 3000 and 4000. WSL2 NAT may also require forwarding those ports from Windows to WSL. PostgreSQL remains bound to localhost and should not be exposed to the LAN.

On Windows and WSL, do not share `node_modules` between the two environments: native packages such as esbuild and Next.js SWC are platform-specific. Keep a separate project working copy and dependency installation in the WSL Linux filesystem (for example, under `~/projects`), and run both `npm install` and `npm run dev` there. Alternatively, run both commands from Windows, but do not switch environments while reusing the same `node_modules`.

## Configuration contract

The API requires `DATABASE_URL`, `SESSION_SECRET` (at least 32 random bytes), `WEB_ORIGIN`, and `PORT`. Set `EXECUTION_BACKEND=docker` for the local isolated runner, or `EXECUTION_BACKEND=judge0` with `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN` for a separate Judge0 service. Production requires HTTPS, secure cookies, a managed PostgreSQL instance, protected secrets, and a sandbox configured with network isolation and resource limits. Never put secrets in `NEXT_PUBLIC_*` variables.

## Phase status

- Architecture and normalized initial schema: in progress.
- Authentication, team/catalog/event APIs, auctions, allocations, coding sessions, Judge0 queue, scoring and leaderboard APIs: implemented.
- Database migration is checked in; apply it locally against PostgreSQL before launching the API.
- API and web production builds and domain unit tests are part of the verification pass.
- Deployment and full PostgreSQL/Judge0 end-to-end verification: pending until those services are configured.
- No code runner or real-time feature should be considered operational until the corresponding service and integration checks are completed.

## Release checklist

Before an event: apply and review migrations; provision an admin securely; configure event rules and sandbox limits; exercise two-member synchronization, simultaneous bids, timer expiry, hidden-case handling, score idempotency, admin access controls, backups, and reconnect recovery; review audit records; deploy behind HTTPS; verify monitoring and restore procedures.
