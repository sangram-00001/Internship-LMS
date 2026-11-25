# Assessments and certificates

Validated 25 November 2026 against a disposable PostgreSQL restore. Existing local data preserved.

## Admin workflow

Use Quizzes & assignments to save bank questions, assemble quizzes and publish them. Answers are scored on the server from the question snapshot captured at attempt start. Quiz answers autosave; resume retains the original deadline and attempt number. Expired attempts score zero. Exact matching is required for multiple-answer questions.

Assignments accept text and an optional PDF up to 10 MB. Students may submit up to ten times before the deadline. Admin evaluation stores each score and feedback entry; prior evaluations remain available.

Use Certificates to create a branding/requirements template, assign it to a course, and check a Student ID. Requirements optionally include all current lessons, all published quiz passes, and all published assignments meeting a percentage threshold. Assignment eligibility uses the latest submission and its latest review. Empty courses cannot meet the all-lessons requirement. The student and enrollment must be active. An admin can override unmet completion requirements only with an audited reason; the active-account/access rules still apply.

Issuance is idempotent per student/course. Revocation blocks downloads and changes public verification immediately. Revoked certificates are retained and cannot be silently reissued. Template changes do not rewrite existing certificates. Create and assign a replacement template to change future requirements.

## API routes

All routes are under `/api/v1`. Authenticated mutations require CSRF. `/assessments/admin/*` and `/certificates/admin/*` require the platform administrator role.

- `GET /assessments/admin`; `POST /assessments/admin/questions`
- `POST /assessments/admin/quizzes`; `PATCH /assessments/admin/quizzes/:id`
- `POST /assessments/admin/assignments`; `PATCH /assessments/admin/assignments/:id`
- `GET /assessments/admin/assignments/:id/submissions`; `POST /assessments/admin/submissions/:id/reviews`
- `GET /assessments/student`; `POST /assessments/student/quizzes/:id/start`
- `PUT /assessments/student/attempts/:id/answers`; `POST /assessments/student/attempts/:id/submit`
- `POST /assessments/student/assignments/:id/files`; `POST /assessments/student/assignments/:id/submissions`
- `GET /assessments/submissions/:id/file` — owner/admin only
- `GET /certificates/admin`; `POST /certificates/admin/templates`
- `PUT /certificates/admin/courses/:id/template`
- `POST /certificates/admin/eligibility`; `POST /certificates/admin/issue`
- `POST /certificates/admin/:id/revoke`
- `GET /certificates/student`; `GET /certificates/:id/pdf` — owner/admin only
- `GET /certificates/verify/:id` — public, rate limited, excludes email and internal exception/revocation notes

## Local validation

`npm run test:accounts` restores the local database to a named disposable database, applies migrations there, runs HTTP/persistence assertions, and drops only that test database.

From apps/api, `../../node_modules/.bin/tsx prisma/browser-validation.ts` creates an isolated browser fixture on http://127.0.0.1:5175 with API port 4002. Its credentials are synthetic test fixtures in the script. Never run this on a production machine. It refuses to overwrite an existing validation database. Stop it normally to clean up; after interruption, inspect active connections before removing only the known disposable database.

PDF generation uses PDFKit and node-qrcode. Set `CERTIFICATE_FONT_PATH` for non-ASCII text and ensure the chosen licensed font covers the required language. Set the final `WEB_ORIGIN` before production issuance, because verification URLs are captured in the certificate snapshot.

References: https://pdfkit.org/docs/getting_started.html and https://github.com/soldair/node-qrcode
