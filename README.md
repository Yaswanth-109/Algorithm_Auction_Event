# Algorithm Auction

**Bid Smart. Play Your Cards. Crack the Code.**

An event platform for team auctions and competitive programming. The app provides administrator and team workflows for event setup, auctions, coding sessions, scoring, and the live leaderboard.

## Event rules implemented

- Teams have exactly two members and start with 1,000 virtual credits.
- The Power Card Auction must finish before the Algorithm Auction opens. Only one auction can accept bids at a time.
- Teams can acquire exactly two algorithm problems. Unclaimed auction problems are distributed to teams that need them, prioritizing teams with fewer algorithms and then team code; available problems are ordered by starting bid and problem code.
- Each problem defaults to a 20-minute server-timed session. The editor supports Python, Java, C, and C++.
- The unused-credit bonus defaults to one point per ten credits.
- The event guidelines specify a 90-minute event duration. This duration is shown on the sign-in page; administrators control event and coding-round lifecycle from the admin console.

## Architecture

- **Web:** Next.js + React + TypeScript. CodeMirror 6 provides Python, Java, C, and C++ language support. User and admin surfaces share a typed API client; authorization is enforced by the API.
- **API:** Node.js + Express + TypeScript. REST endpoints own validation and business rules. Socket.IO publishes authorized, versioned event updates; it is not a source of truth.
- **Data:** PostgreSQL + Prisma. Credits, bids, allocations, submissions, and score changes are persisted. Contended actions use serializable transactions, idempotency keys, and database constraints.
- **Authentication:** Argon2id password hashes; opaque, server-side sessions in secure, HTTP-only cookies; role and team membership checks on every protected operation. Two team members have separate credentials but share a team resource scope.
- **Execution:** An adapter calls a separately deployed Judge0-compatible sandbox. The API never executes submitted source locally. Official test data is fetched only by the worker/service boundary and never returned to clients.
- **Operations:** Environment-based secrets, health/readiness endpoints, structured logs, database migrations, rate limits, and deployment documentation.

### Data model

`User` accounts belong either to an admin or one `Team`; the team has exactly two member slots enforced by application transactions and a unique team-slot constraint. `Event` owns lifecycle/settings; catalog `PowerCard` and `Problem` records are versioned/published. `TestCase` stores sample/hidden visibility and weights. `Auction` and `AuctionItem` describe windows; `Bid` is append-only, idempotent history. `TeamCard`, `TeamProblem`, and `CodingSession` record allocations and server timestamps. `Submission` and `TestCaseResult` record evaluation outcomes without exposing hidden inputs. `Score` is derived from submissions, credit balance, and append-only `ScoreAdjustment` records. `AuditLog` and `Notification` support traceability and delivery.

## API and realtime contract

REST groups: `/api/auth` (login, logout, session), `/api/health`, `/api/admin/*` (teams, catalogs, test cases, allocations, event controls, score adjustments), `/api/auctions/*` (catalog view, bid, history), `/api/team/*` (dashboard, allocations, coding sessions), `/api/submissions` (run, submit, status), and `/api/leaderboard` (visibility-aware standings). Each mutation validates input, authorizes the actor, checks current server state, and records an audit entry in the same transaction where applicable. Mutations accept idempotency keys where retries could duplicate effects.

Socket.IO authenticates the session cookie during handshake. Team members can join only their own `team:<id>` room; admins can join the event monitor room. The server emits small invalidation/state events (`team.updated`, `auction.updated`, `event.updated`, `submission.updated`, `leaderboard.updated`) after committed transactions. Clients refetch authorized snapshots after reconnect; event payloads never contain hidden test data or credentials.

## Code evaluation

The API accepts bounded source and language identifiers, verifies the team assignment and server-side deadline, and submits work to the isolated execution adapter. `RUN` is limited to visible samples/custom input and never changes score. `SUBMIT` runs official cases and stores per-case outcomes and weights; score and timing calculations use persisted server timestamps. The Judge0-compatible service must be configured with network isolation, CPU/memory/process limits, and supported compiler images before enabling execution in production.

## Folder structure

```text
apps/
  api/       Express API, Socket.IO, Prisma schema and migrations
  web/       Next.js user and admin application
packages/
  shared/    Shared TypeScript contracts and validation
docs/        Architecture, local setup, deployment, milestones
```

## Milestones

1. **Foundation:** monorepo structure, schema, environment contract, API health/auth boundaries, and architecture docs.
2. **Admin/event setup:** teams and member credentials, card/problem/test-case authoring and publication, allocations, event controls, and audit history.
3. **Auctions and team dashboard:** atomic bids and credit accounting, ordered auction gates, fair allocation of unclaimed algorithms, team collaboration, and real-time refresh.
4. **Coding and evaluation:** server-timed sessions, live team co-editing, samples/custom input, Docker/Judge0 execution adapters, and hidden-case submissions.
5. **Scoring and operations:** timing/credit formulas, leaderboard, admin adjustments, deployment hardening and end-to-end verification.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup and current phase boundaries.

## Current phase boundary

Local compilation and unit tests cover the application logic, but a live deployment still requires PostgreSQL, a configured Judge0 service, production secrets, and database-backed/browser end-to-end verification. Complete those checks before using the app for a real event.
