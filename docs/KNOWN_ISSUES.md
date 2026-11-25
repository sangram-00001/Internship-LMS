# Known issues and release blockers

- The original applied migration `20261123182746_init` is missing from disk and the downloaded source ZIP. PostgreSQL still retains its original migration record. Do not accept a development migration reset. Recover the original SQL or undertake a separately reviewed baseline-reconciliation procedure before fresh deployment. New migrations were reviewed and applied with migrate deploy after backup/restore validation.
- npm audit currently reports 11 findings: 3 moderate, 6 high, 2 critical. Critical findings involve vitest/tinypool; others include Prisma transitive packages, Zod, Vite and React Router. Some fixes require major-version upgrades. Full details are in the private development backup's dependency-audit.json. No force upgrade was run.
- Production transactional email and course-file storage are not configured. User selected local development adapters. Local email requires `npm run worker:local` (continuous) or `npm run jobs:run` (one cycle); it does not deliver to inboxes. Course files now have a private local adapter; production upload is disabled.
- Email verification is tracked and displayed but does not yet gate all academy actions. Existing users are not automatically treated as verified.
- Recovery responses do not reveal account existence in content, but production timing/abuse testing and distributed rate limiting remain.
- Email jobs contain sensitive links until delivery, after which their bodies are redacted. Keep PostgreSQL and the private local mailbox restricted; add retention/cleanup policy before release.
- Local delivery now supports continuous processing, bounded batches, five attempts, exponential backoff, concurrent claims and administrator retries. Production email transport, process supervision and external monitoring remain blocked. Assignment reminder scanning is limited to the earliest 100 assignments due within 24 hours per cycle; larger deployments need cursor-based scanning to prevent starvation.
- Existing external video/link URLs remain controlled by their external hosts. New local uploads use authorization-aware delivery, but production storage, malware scanning, quotas, streaming uploads beyond 50 MB and retention/orphan cleanup remain. Local files and JSON metadata must be backed up together with PostgreSQL.
- Full browser end-to-end and responsive validation are incomplete. API integration tests are not a substitute for those checks.
- Online checkout is intentionally disabled at the user’s request. Razorpay credentials, webhook setup and production hosting are not configured. Do not accept live online payments.
- The user initialized an independent repository and committed the current project on 24 November. Continuation work is on codex/continue-academy; backups and private local data remain ignored.
- Later phases in IMPLEMENTATION_STATUS.md remain unfinished.

- Browser access recovered. Live student dashboard, Contact page and empty assessment page were verified. Assessment submission, grading and the certificate lifecycle now passed isolated browser checks. Broader curriculum/profile/report workflows and responsive validation remain.
- Public support email is configured as sangramrath0001@gmail.com.

- Certificates use an ASCII-safe default PDF font. Configure CERTIFICATE_FONT_PATH to a licensed font covering the intended language for non-ASCII names or titles; unsupported output is blocked rather than producing unreadable names. Production verification links require the final WEB_ORIGIN before issuing certificates.
