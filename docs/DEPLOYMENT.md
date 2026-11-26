# Deployment preparation — 26 November 2026

The app is not published yet. Hosting account selection and database baseline reconciliation remain required. Current work is on `codex/continue-academy`; main has not been merged.

## Application image

Build from the repository root with `docker build -t aspireedge-lms .`. The image serves the built frontend and API on one origin, port 4000 by default. Production frontend requests use `/api/v1`, avoiding cross-site session cookie dependencies. `WEB_DIST_PATH` is set by the image. Deep links return the frontend; missing APIs and assets remain 404 errors.

The multi-stage image excludes local environment files, backups, private media/mail, Git metadata, test output and development dependencies from the runtime. It runs as the unprivileged Node user. It performs no database migrations or seeding on startup.

Configure these values privately through the chosen host:

- `DATABASE_URL`: hosted PostgreSQL connection, with TLS settings required by the provider. Never use the local development database address/password.
- `WEB_ORIGIN`: exact public HTTPS origin, without a trailing slash.
- `NODE_ENV=production` and `PORT`: image default is 4000; the host may override PORT.
- Optional `CERTIFICATE_FONT_PATH`: a licensed font supplied securely in the deployment for non-ASCII certificate names.

Health endpoint `/health` is process liveness only; it does not establish database readiness. Verify login, catalog and an authenticated workflow after database setup. Host-specific reverse-proxy trust must be configured narrowly once the host is selected, so rate limiting uses the correct client address.

## Database release gate

The initial applied migration `20261123182746_init` is missing from the repository. Later migrations cannot initialize a blank database on their own. Recover the original migration or review a separate baseline procedure before creating the hosted schema. Do not reset the local database, silently rewrite historical checksums, or run `db push` as a deployment shortcut.

Choose whether the hosted app starts with an empty catalog or receives a private backup transfer of local data. No local records or files have been uploaded. Provision the first administrator privately after schema initialization; never commit credentials.

## Service limitations

Online checkout remains disabled by user choice. Email and upload adapters remain local-development only; production file uploads and the local email worker refuse production mode. Consequently, password-reset/verification emails, course uploads and queued announcements/reminders need production adapters before a functional public release. Current dependency audit and broader browser/security validation also remain release work; see KNOWN_ISSUES.md.

## Future updates

After the hosting account is chosen, connect the GitHub repository and select the deployment branch. Enable deployment only after passing checks. Database migrations require a reviewed release step and a fresh backup; rollback of application code alone does not reverse a schema change. No automatic-deployment connection has been made yet.

Image structure follows Docker's multi-stage build guidance: https://docs.docker.com/build/building/multi-stage/
