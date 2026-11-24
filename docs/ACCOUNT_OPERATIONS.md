# Account operations and API

Run commands from the existing AspireEdge project root.

## Checks

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:accounts` — requires the local Docker PostgreSQL service. Creates `aspireedge_accounts_validation`, restores a snapshot, applies pending migrations only there, runs HTTP/persistence tests, and removes only the database it created. Refuses to overwrite an existing validation database.
- `npm run build`

## Admin recovery

Configure the existing admin email and a 12–128 character password privately in `apps/api/.env` using SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD. Never paste them into chat, shell arguments, logs or source control.

Run `npm run admin:reset-password -- --confirm` only when a reset is intended. It preserves the account and relationships, uses Argon2, revokes all sessions and unused reset links, and writes an audit event. It fails for absent/non-admin accounts and never promotes a student. The seed command intentionally does not change an existing password.

## Local email

Run `npm run mail:deliver`. Messages are written into `apps/api/.local-mail/` with private directory/file permissions. Open the relevant text file locally to use the link; do not share links or mailbox contents. Links carry tokens in a URL fragment and the recovery UI clears that fragment after loading. Each link expires after 30 minutes. No external mail is sent. The worker refuses NODE_ENV=production.

Registration queues verification mail. Existing users can request verification from Profile & security. Password reset is available from the login screen. Changing a password signs the user out everywhere.

## Account API

Base: `/api/v1`. All authenticated writes require the session cookie and X-CSRF-Token from `/auth/me`. Origin checks apply to writes.

| Method | Path | Input/behavior |
|---|---|---|
| POST | /auth/register | name, email, optional phone, password, confirmPassword; rejects extra privileged fields |
| POST | /auth/login | email, password; issues session cookie |
| GET | /auth/me | Current authenticated account and CSRF token |
| POST | /auth/logout | Invalidates current session |
| GET | /account/profile | Safe profile fields only |
| PATCH | /account/profile | name, optional phone; cannot change role/email |
| POST | /account/change-password | currentPassword, password; revokes sessions |
| POST | /account/forgot-password | email; generic response regardless of existence |
| POST | /account/reset-password | token, password; single-use token |
| POST | /account/verification-email | Authenticated resend request |
| POST | /account/verify-email | token; marks email verified |
| PATCH | /academy/admin/students/:id | Admin-only ACTIVE/DISABLED status; audited and sessions revoked when disabled |

## Migration safety

Backup before every migration. Never use migrate reset. The account migration adds nullable emailVerifiedAt plus AccountToken/EmailJob tables; it removes no existing table or column. The original migration source is missing, so do not use migrate dev or deploy onto an empty database until history is reconciled.

This is a local development setup, not an approved production deployment. See KNOWN_ISSUES.md.

## Local course files

The course builder accepts PDF, MP4 and WebM lesson uploads up to 50 MB. `POST /api/v1/media/courses/:courseId` is admin-only, CSRF protected and checks the file signature. Use the file MIME type as Content-Type and raw bytes as the request body. It returns a URL to attach to the lesson. The adapter also accepts PNG/JPEG through the API; thumbnail upload UI is not complete.

`GET /api/v1/media/:id` checks the owning course, attachment to a lesson, preview status, student session and active enrollment before serving bytes. It supports Express byte ranges for video and disables cache storage. Files are stored in `apps/api/.local-storage/`, outside the public web directory. Metadata and content have private filesystem permissions. Never serve this directory statically. API_ORIGIN defaults to http://localhost:4000; configure it consistently before uploading files. Local uploads are disabled in production.
