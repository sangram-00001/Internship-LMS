# Communication operations

Updated 25 November 2026. Local development only; no external emails are sent.

## Using the app

Students use Notifications for account/course updates and Support for private help threads. Administrators use Student support to reply or resolve tickets. A student reply reopens a resolved ticket. Only the owner and platform administrator can read a thread. Tickets are limited to five new threads per student per day and 100 messages per thread.

Administrators use Announcements & delivery to queue updates to all active students or active, unexpired enrollments in one course. Delivery status shows pending jobs and exhausted retries. Review the failure cause before using Retry delivery. A stale claim older than five minutes can be retried even if the worker crashed on its fifth attempt.

## Local worker

From the repository root:

```sh
npm run worker:local
```

Keep this terminal running alongside the app. It processes a cycle every minute. For a single cycle use `npm run jobs:run`; for mail only use `npm run mail:deliver`. The worker refuses production mode. A failed single cycle returns a failure exit code.

Announcements use a persisted recipient cursor and unique event IDs. Assignment reminders target enrolled active students with no submission when a published assignment is due within 24 hours. Changes to the deadline allow a new reminder. Reminder batches currently scan at most 100 assignments and 100 eligible recipients per assignment per cycle; this limit must be revisited before large-scale use.

Mail is written to the API working directory's private `.local-mail` folder unless LOCAL_MAIL_PATH is configured locally. Do not paste its contents into chats or logs: account emails can contain reset/verification links. Files use private permissions; delivered database bodies are redacted. Claims expire after five minutes, retry delays grow exponentially, and five failed attempts require admin review. Stable filenames and atomic renames prevent duplicate local files during retries.

Notifications cover access grants, offline purchase decisions, assignment grading, certificate issuance/revocation and support replies. Existing historical actions are not backfilled.

## Validation and data safety

36 unit tests and 166 HTTP integration assertions passed, including 19 communication checks plus announcement/reminder deduplication, concurrent mail workers, stale final-claim retry, ticket isolation and reopening. The integration runner restores the real database into its own disposable database and removes only that database afterward.

The additive communication migration was backed up and tested before live application. Backup: `backups/communication-20261125/database-before-apply.dump`. No database reset was performed; schema diff after migration was empty.

Live Notifications and Support pages and the navigation logo were visually checked. Full browser ticket/reply and announcement lifecycle validation remains outstanding. Production transport, supervision, retention, distributed rate limiting and the missing original migration source remain release blockers.
