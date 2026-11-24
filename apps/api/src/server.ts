import 'dotenv/config';
import { app } from './app.js';
import { prisma } from './lib/prisma.js';
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => console.log(`Aspireedge API listening on http://localhost:${port}`));
const shutdown = () => {
  server.close(() => { prisma.$disconnect().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
