import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { deliverLocalMail, dispatchAnnouncements, queueAssignmentReminders } from '../src/lib/notifications.js';
const db = new PrismaClient();
if (process.env.NODE_ENV === 'production') { console.error('Configure production email delivery before starting a production worker.'); process.exit(1); }
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
try {
  do {
    try { const announced = await dispatchAnnouncements(db), reminded = await queueAssignmentReminders(db), delivered = await deliverLocalMail(db); if (announced || reminded || delivered) console.log(`Local worker: ${announced} announcements, ${reminded} reminders, ${delivered} private mailbox deliveries. No external email sent.`); }
    catch { console.error('Local worker cycle failed; queued jobs remain available for retry.'); if (process.argv.includes('--once')) process.exitCode = 1; }
    if (process.argv.includes('--once')) break;
    for (let second = 0; second < 60 && !stopping; second++) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping);
} finally { await db.$disconnect(); }
