# AspireEdge implementation status

Updated 25 November 2026. This replaces the obsolete multi-company roadmap. Existing company tables and records are retained; public routes support the single academy.

## Phase 0 — verified

- Seven frontend errors repaired; backend and frontend compile.
- Existing admin login repaired earlier without recreating the account.
- Local admin recovery command uses Argon2, requires an existing SUPER_ADMIN, updates credentials transactionally, revokes sessions and reset links, and writes a non-secret audit event.
- Recovery does not promote students, create an account, or modify course/payment records.
- ESLint added; source and private database backups retained.
- 36 automated tests cover baseline security, course access, password recovery and login.

## Phase 1 — implemented, verification in progress

- Registration with matching password confirmation and rejection of privileged registration fields.
- Unique Student ID; Argon2 login and session cookies.
- Profile name and phone editing; email intentionally immutable until a verified email-change flow is built.
- Authenticated password change requires the current password and invalidates all sessions and unused reset links.
- Forgot password returns a generic response; reset links are hashed in AccountToken, expire after 30 minutes, and can be used once.
- Verification links and resend UI; registration queues a verification message transactionally.
- EmailJob provides durable local delivery, retry counts and deterministic filenames. `npm run mail:deliver` writes private local mail, never sends externally, and refuses production mode.
- Student disable/enable is audited; disabling invalidates sessions so enabling cannot resurrect old sessions.
- API validation uses Zod; account endpoints have rate limiting and authenticated mutations require CSRF.
- 166 integration HTTP assertions passed against a disposable PostgreSQL database restored from the real local database, including persistence and local mail delivery. The test database was removed after testing; no fixture records were inserted into the real database.
- Browser forgot-password submission verified. Full browser registration/profile/password lifecycle still needs a dedicated disposable browser test environment.

## Remaining phases

2. Course system: instructor/objectives, thumbnail uploads, PDF/video/text lessons, module/lesson ordering, reversible archive/restore, category filtering and catalog pagination implemented. About/FAQ/Contact pages added with the user-approved support email. Archived lessons retain historical progress and are excluded from current completion totals. Local storage only; full browser E2E remains outstanding.
3. Access/payments: manual lookup by ID/email, profile review, optional expiry, revoke/restore, and access-history UI implemented. Expiry is checked on premium content, media downloads and completion. Concurrent grants use serializable transactions. Online checkout is intentionally disabled at the user's request; Razorpay and online refunds/receipts are deferred.
4. Analytics: Student 360 profiles, lesson history, learning activity, saved last lesson, enrollment filters/sorting and CSV export implemented. Export rejects spreadsheet formula payloads and limits results to 5,000 with an explicit error when exceeded. Existing revenue dashboard remains; dedicated sales CSV and richer engagement summaries remain.
5. Assessments: question bank; MCQ/multiple-answer/true-false quizzes; timed, resumable attempts with saved answers; backend scoring and attempt limits; PDF/text assignments; grading feedback and immutable review history implemented. Attempt snapshots preserve scoring after quiz edits. Admin creation/publishing/grading are audited. Browser-tested student login, saved quiz answers after reload, quiz submission, assignment submission, lesson completion, admin login and grading in an isolated restored database. Migration applied after backup and disposable restore test.
6. Certificates: branded templates, course-specific completion requirements, eligibility checks, audited issuance/exceptions, private PDF downloads, QR/public ID verification and audited revocation implemented. Issued records retain immutable name/course/branding/requirements snapshots. Browser-tested template creation, course assignment, eligibility, issuance, PDF download, public verification and revocation. Short/long-name PDF layouts visually checked. Migration applied and schema matches. One certificate per student/course; revoked records are not automatically reissued.
7. Commercial features: server-priced percentage/fixed coupons with expiry, reservation-aware limits and one use per student; published course bundles; atomic manual approval/cancellation; wishlists and moderated verified-purchase reviews implemented. 34 commerce HTTP assertions cover concurrent coupon use, price tampering, allocation, cancellation, authorization and review moderation. Browser-tested coupon/bundle creation, discounted quote, request, wishlist, admin approval and both course enrollments. Review form loads; browser review moderation remains to be checked.
8. Communication: in-app notifications, course/all-student announcements, assignment reminders, private support threads with admin replies/resolution, and durable local email delivery implemented. Worker claims, exponential retry delays, stale-claim recovery and manual retry are supported. 19 communication HTTP assertions plus deduplication/concurrency checks passed in a restored disposable database. Additive migration applied after a fresh backup; schema diff is empty. Live notification/support pages and navigation branding verified. Full browser ticket/reply and announcement lifecycle remain to be checked. See COMMUNICATION_OPERATIONS.md.
9. Production: resolve dependency audit, missing original migration source, production providers, deployment, backup drills, browser E2E, security/load/responsive tests.

Branding: the company logo supplied on 25 November is used in the shared app Brand and new certificate snapshots. The original JPG is preserved; CSS/PDF clipping removes only the surrounding whitespace from view.

No production-readiness claim is made. See KNOWN_ISSUES.md and ACCOUNT_OPERATIONS.md.
