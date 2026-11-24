import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient, PlatformRole } from '@prisma/client';

const prisma = new PrismaClient();
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('Set SEED_ADMIN_EMAIL and a strong SEED_ADMIN_PASSWORD (at least 12 characters) in apps/api/.env before seeding.');
  }
  await prisma.user.upsert({
    where: { email },
    update: {}, // Never overwrite an existing password during a seed.
    create: {
      email, name: process.env.SEED_ADMIN_NAME || 'Platform Administrator',
      passwordHash: await argon2.hash(password), platformRole: PlatformRole.SUPER_ADMIN,
    },
  });
  for (const plan of [
    { name: 'Starter', monthlyPricePaise: 199900, studentLimit: 100, trainerLimit: 2, courseLimit: 10 },
    { name: 'Professional', monthlyPricePaise: 499900, studentLimit: 500, trainerLimit: 10, courseLimit: 50 },
    { name: 'Enterprise', monthlyPricePaise: 0, studentLimit: 1000000, trainerLimit: 1000000, courseLimit: 1000000 },
  ]) {
    await prisma.subscriptionPlan.upsert({ where: { name: plan.name }, update: {}, create: plan });
  }
  console.log('Platform Super Admin account (if new) and subscription plan catalog seeded.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
