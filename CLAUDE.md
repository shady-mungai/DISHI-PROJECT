# Claude Code Style & Guidelines — Dishi

Enforce clean code principles according to the industry-standard rules codified in:
• JavaScript/TS/React: https://github.com/ryanmcdermott/clean-code-javascript
• General Rules: https://github.com/luongnv89/claude-howto/blob/main/clean-code-rules.md

**Stack:** Convex (database, functions, scheduler, auth) · TypeScript · Next.js (App Router) · Celcom Africa (SMS + USSD)
**Plan of record:** `PLAN.md`. **Requirements baseline:** the Event Catalogue markdown in the project root.

## Core Constraints
• **Function Parameters:** Must ideally be 2 or fewer. Convex functions take a single `args` object, which satisfies this by construction.
• **Single Responsibility:** Functions must only have a single level of abstraction and do one thing.
• **Conditionals:** Favor early returns and encapsulated conditionals over negative conditional logic chains.
• **Simplicity (KISS):** Favor simplicity over complexity. Write readable, straightforward code.
• **Naming & Variables:** Prioritize explicit, searchable variable names over ambiguous abbreviations. Forbid magic numbers and hardcoded strings.

## Comments Policy
• **STRICT NO-COMMENT POLICY** for explanations. Code must be self-documenting through naming conventions.
• **ONLY allowed comments:** `// TODO: [action]` or `// MODIFY: [reason]` as self-reminders.

## Architecture & Coupling
• **Enforce Loose Coupling:** Isolate business logic from frameworks and external tools.
• **Pluggable Components:** Design features to be attachable/detachable via feature toggles or configuration flags.
• **Adapter Pattern:** Wrap third-party libraries in custom adapters so they can be seamlessly swapped out. The seams on this build are: the SMS/USSD gateway, the wallet/payment adapter, and the enrolment PDF parser. None of these may leak vendor types into business logic.

## Type Safety & Error Handling
• Use TypeScript interfaces/types for all props and function signatures. Strictly forbid `any`.
• The Convex schema is the single source of truth for data types. Derive, never redeclare.
• Fail fast but recover gracefully. Centralize error handling for external APIs and file parsing.

## Component & State Management
• Keep React components pure where possible. Isolate business logic into custom hooks.
• Extract long Tailwind utility combinations into component variables/config to keep render methods clean.

## Convex Rules
• **Queries and mutations are transactional and deterministic.** No `Date.now()`, no `Math.random()`, no `fetch`. Pass time in as an argument.
• **External calls belong in actions only** (SMS gateway, payment adapter). Actions are at-least-once — anything they trigger carries an idempotency key.
• **Every access path gets a declared index.** Never `.filter()` a growing table; it scans.
• **Anything unbounded pages with `.paginate()` and chains via `ctx.scheduler`.** Written that way from the first line, never retrofitted. This is the Convex form of "no heavy analytical work on the main loop".
• `v.*` validators on every function's args.
• Public functions open with a role check. Anything not client-callable is `internal*`.
• Aggregates are computed on read until a view actually exceeds the transaction read budget. Do not pre-build counters speculatively.

## Data Protection & Privacy
• **Strict No-PII Logging:** never log MSISDNs, student names or tag UIDs in plaintext. Mask or hash before writing to application logs.
• **No message may disclose a student's subsidy or payment status to any party other than the linked guardian.** This is a content rule, not only a logging rule.
• Role scope is enforced at the function boundary, never in the UI.
• Synthetic data only until data residency and ODPC registration are resolved. No live guardian data before then.
• Data collection stays minimised: student identifier, class, tag binding, guardian MSISDN, language. Nothing else.

## Testing & Verification
• **`convex-test` + Vitest. Do not mock the database** — `convex-test` runs a real in-memory backend, which is both faster and truer than mocks.
• Rule engine and notification policy layer are pure functions over fixtures. Test them directly, not through the UI.
• **Every absence trigger needs a test proving it fires when nothing happens.** This is the core value of the system and the easiest thing to break silently.
• The seeded simulator run is the regression fixture; the same seed must produce identical events.
• Write isolated unit tests for business logic before moving to UI/API layers.
• Always delete dead code, unused variables, and stale imports immediately to save token context.

## Traceability & Cost Discipline
• Tests name the requirement ID they prove (`P-02`, `FR-208`, `SU-03`). The specification is written in IDs; the tests should be too.
• **Timings, thresholds and cutoffs are rows in the settings table, never constants.** This extends the magic-numbers rule to anything the county might want to change without a deployment.
• Every notification message is traceable to its originating event through a correlation identifier.
• No notification rule ships without a suppression path and a stated messages-per-guardian-per-term cost.

## Git Workflow & Issue Management
• **Branching is mandatory.** Always remind the user to create a dedicated branch (`feature/[name]` or `fix/[name]`) before generating or modifying code, even as a solo developer.
• **Use the `gh` CLI** for GitHub operations. The GitHub MCP is not connected in this environment — do not attempt to call it.
• **Issue Reporting:** when encountering bugs, blockers, or necessary architectural refactors, create an issue via `gh` using the structure in `ISSUE_TEMPLATES`; the same applies to `PULL_REQUEST_TEMPLATE` for PRs. Both templates are created on D1.

## AI Assistant Behavior Guidelines
• **Extreme Conciseness:** Responses must be straight to the point. No fluff, no filler, no conversational padding.
• **Autonomy vs. Clarification:** Make reasonable, industry-standard assumptions to keep momentum. ONLY ask questions if critical context is completely missing and work cannot proceed. Do not act helpless.
• **Research vs. Guessing:** Perform targeted, precise web research if unsure about library syntax. Do not guess. Do not over-research and waste tokens.
• **This applies with force to Convex.** Its API surface moves and model knowledge is stale. Look up current syntax for the scheduler, `convex-test`, Convex Auth and the rate-limiter component rather than recalling it.
• **Fluid Documentation:** Treat initial project documentation as a living guide. Adapt dynamically to feasibility changes. `PLAN.md` §8 records decisions as they are made.

## Claude Code Active Skills & Tooling
• **Development & Architecture:** `api-design`, `backend-patterns`, `coding-standards`, `frontend-patterns`, `react-patterns`, `design-system`
• **Testing & Verification:** `tdd-workflow`, `react-testing`, `e2e-testing`, `verification-loop`, `eval-harness`
• **Security & Research:** `security-review`, `search-first`, `documentation-lookup`, `market-research`
• **Content & Strategy:** `article-writing`, `content-engine`, `frontend-slides`, `strategic-compact`, `investor-materials`, `investor-outreach`

### Skill Usage Rules
• Rely on `search-first` and `documentation-lookup` before guessing any Convex or Celcom Africa's API syntax.
• Use `tdd-workflow` and `verification-loop` to validate code against the latency and idempotency targets in the requirements baseline.
• Apply `security-review` to enforce the No-PII logging rule, per-function role checks, and device authentication.

## Claude Autonomous Agents
Routine, from `~/.claude/agents`:
• `typescript-reviewer.md`: primary reviewer — everything in this build is TypeScript.
• `react-reviewer.md`: the four role-scoped dashboards.
• `security-reviewer.md`: device HMAC authentication, per-function RBAC, children's PII.
• `silent-failure-hunter.md`: **highest value on this project.** The system exists to notice absence; a swallowed error in the sweeper means guardians silently never learn their child did not eat. Run on D3, D6 and D10.
• `tdd-guide.md`: test-driven cycles.
• `react-build-resolver.md`: trigger immediately on Next.js build or type failures. Debug, do not guess.

Situational:
• `type-design-analyzer.md`: D2 and D4 — the event catalogue is a discriminated-union design problem, and the rule DSL is a type problem.
• `e2e-runner.md`: D11–D13 dashboards and demo rehearsal.
• `performance-optimizer.md`: D15 NFR verification pass.
• `code-reviewer.md`, `refactor-cleaner.md`, `planner.md`, `pr-test-analyzer.md`: as previously used.

**Do not use:** `database-reviewer.md` — it is PostgreSQL/Supabase-specific and will give confidently wrong advice about indexes, pooling and query shape for a Convex build. Also skip `python-reviewer`, `pytorch-build-resolver`, `mle-reviewer`, `rag-pipeline-reviewer`.

**Known gap:** no Convex-aware reviewer exists. The Convex Rules section above is always in context and costs nothing to invoke, so a custom `.claude/agents/convex-reviewer.md` is deferred until the generic reviewers demonstrably miss Convex-specific issues. Revisit after Sprint 1.
