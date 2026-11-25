import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { deliverLocalMail } from '../src/lib/notifications.js';
const db = new PrismaClient();
try { console.log(`Delivered ${await deliverLocalMail(db)} message(s) to the private local mailbox. No external email sent.`); }
catch { console.error('Local email delivery failed. Check database connectivity and mailbox permissions.'); process.exitCode = 1; }
finally { await db.$disconnect(); }
