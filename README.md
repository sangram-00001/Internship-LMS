# Aspireedge Academy — Admin & Student Course LMS (Milestone 2)

A source-code update to the original Aspireedge internship LMS starter. The new direct-to-student flow has **one platform administrator, public registration, a course storefront, admin-managed offline access and student progress tracking**.

**Status: development milestone, not production-ready.** Dependencies and live PostgreSQL/browser tests could not run in the creation environment because the npm registry was unavailable. Run the checks below on your Mac. **Online Razorpay/card/UPI checkout is not yet implemented**; the purchase interface explicitly creates *offline payment requests* that require manual verification.

## Implemented in this milestone

- Public landing page, course catalog, course details, syllabus and public preview lessons.
- Student self-registration with password hashing, unique random Student ID, student sign-in and secure server-side session cookies.
- Single administrator sign-in reusing your already-seeded `SUPER_ADMIN` account.
- Admin dashboard with actual database counts; no fake revenue data.
- Admin course create/edit/publish/archive; module and lesson authoring (text, external video and link).
- Admin searchable student directory including course enrollment source and completion percentage.
- Admin access grant via Student ID for **verified offline payment** or **complimentary access**, plus revocation. Historic progress remains after revocation.
- Student can enroll directly in published free courses.
- Paid course users can submit an **offline purchase request**; the administrator may independently verify a payment and grant access, or reject a request.
- Student dashboard, access-controlled lesson viewer, manual lesson completion and purchase history.
- New API access tests; audit entries for important administrative actions.

## Import this update into the project already on your Mac

Your local project (from the previous milestone) is assumed to be:

`/Users/sangramrath/Documents/AspireEdge/aspireedge-lms`

**Do not delete your existing project, database, local `.env` files or `apps/api/prisma/migrations`.** This release adds schema objects and intentionally preserves legacy company tables and records. The legacy company screens are no longer linked in the main UI; the old company tables and source remain for database compatibility, but the former company API endpoints are disabled.

1. Stop any running `npm run dev` processes (Ctrl+C in terminals).
2. Make a backup of your project **and PostgreSQL database**. If PostgreSQL is in Docker, use `docker compose ps` to locate it and `pg_dump` for a database backup. Do not skip this for real data.
3. Extract `Aspireedge-Student-LMS-Update.zip`. Its `aspireedge-lms/` folder contains only changed/new files.
4. In Finder, copy the update files **into the matching existing project folders**, selecting *Replace* for files included in this update. Or use the Terminal example below.
5. Keep your current `apps/api/.env`, `apps/web/.env` and `apps/api/prisma/migrations` untouched.

Example, after extracting the update to `~/Downloads/aspireedge-update/`:

```bash
cd /Users/sangramrath/Documents/AspireEdge/aspireedge-lms
# Optional source backup, outside the application folder:
cd .. && cp -R aspireedge-lms aspireedge-lms-backup
cd aspireedge-lms
cp -R ~/Downloads/aspireedge-update/aspireedge-lms/. .
```

Do not paste the last command until you have confirmed the extracted folder location.

## Run on Mac (existing PostgreSQL instance)

Ensure Docker Desktop is running and run these commands from your existing project root:

```bash
docker compose up -d
npm install
# Generate the revised Prisma Client, then create an additive migration
npm run db:generate
cd apps/api
npx prisma migrate dev --name direct_student_academy
cd ../..
npm run db:generate
npm run db:seed
npm run typecheck
npm run test
npm run dev
```

The migration command should retain your already-applied prior migrations. **If Prisma proposes resetting your database, answer NO**; stop and reconcile migration history before proceeding. Do not use `prisma migrate reset` or `--accept-data-loss` against your existing data.

Your previous seeded Super Admin account is preserved. The seed script deliberately does not replace an existing password.

- Website and public catalog: http://localhost:5173
- Student registration: http://localhost:5173/register
- Student dashboard: http://localhost:5173/student
- Admin dashboard: http://localhost:5173/admin
- Admin courses: http://localhost:5173/admin/courses
- Manual access grants: http://localhost:5173/admin/access
- Payment request approvals: http://localhost:5173/admin/orders
- API health: http://localhost:4000/health

**Port warning:** Vite now requires port 5173. If it reports that the port is occupied, stop the older Vite process before rerunning; do not let it fall back to port 5175 while the API `WEB_ORIGIN` is still 5173.

## Test the primary workflow

1. Sign in with the seeded Super Admin credentials at `/login`. The correct destination is `/admin`.
2. From Admin → Courses, create a course, publish it, then click **Content** and add a module and lessons.
3. Sign out. Register a different email at `/register`. Note the displayed unique Student ID in `/student`.
4. Open `/courses`, choose the published paid course and submit an **offline payment request**. This does *not* grant access yet.
5. As admin, open Payment Requests; independently verify that payment was received, then click **Verify & grant**, or use Admin → Grant Course Access with the Student ID for a verified manual payment or complimentary grant.
6. Sign back in as the student. The course appears in My Learning. Open a lesson and mark it completed.
7. As admin, open Students & Progress, select that student and verify lesson completion. Revoke access if needed; check the student no longer opens paid lessons.

For **free courses** (`pricePaise=0`), the student may enroll without admin approval.

## API overview

- `POST /api/v1/auth/register` — self-registration.
- `POST /api/v1/auth/login` — admin or student sign-in.
- `GET /api/v1/academy/courses` and `GET /api/v1/academy/courses/:id` — public catalog/syllabus.
- `POST /api/v1/academy/student/orders` — submit offline payment request, not payment capture.
- `POST /api/v1/academy/student/courses/:id/enroll-free` — free enrollment.
- `GET /api/v1/academy/student/dashboard` — enrolled courses and progress.
- `GET /api/v1/academy/student/courses/:id` — content, only with active access.
- `POST /api/v1/academy/student/lessons/:id/complete` — mark a lesson complete.
- `/api/v1/academy/admin/courses` — course CRUD / archive.
- `/api/v1/academy/admin/students` — student directory and status.
- `POST /api/v1/academy/admin/enrollments` — verified manual/complimentary access grant.
- `POST /api/v1/academy/admin/enrollments/:id/revoke` — revoke access.
- `GET /api/v1/academy/admin/orders` — payment history and pending requests.
- `POST /api/v1/academy/admin/orders/:id/approve` — independently verify offline payment and grant access.
- `POST /api/v1/academy/admin/orders/:id/reject` — reject request.

## Known gaps before commercial launch

1. Integrate Razorpay checkout with server-side signature, webhook and provider reconciliation. Current UI supports **offline payment requests only**. Never accept an unverified browser success response.
2. Add real private/signed video and PDF object storage. The current external lesson URLs can be copied; do not upload paid premium media to public links and assume they are protected.
3. Add transactional email verification, password reset, billing receipts and notifications.
4. Add assignments, graded quizzes, completion certificates, refund workflow, reporting exports and pagination beyond the first 100 items.
5. Add full integration/E2E testing against PostgreSQL and browser, performance testing, production backups and security review. Lesson completion currently is **student-reported**, not verified video watch time.
6. Reconcile historic tenant resources if you want to migrate old company courses or students into the new academy model. This update **does not automatically import old tenant students/courses**.

See `docs/ACADEMY_IMPLEMENTATION_STATUS.md` for the delivered feature status and remaining work.
# Internship-LMS
