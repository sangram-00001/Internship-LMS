import { MembershipRole, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { randomToken, sha256 } from '../lib/security.js';

export async function createInvitation(
  tx: Prisma.TransactionClient,
  data: { tenantId: string; email: string; name: string; role: MembershipRole },
) {
  const token = randomToken();
  await tx.invitation.create({
    data: { ...data, email: data.email.toLowerCase(), tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });
  return `${process.env.WEB_ORIGIN || 'http://localhost:5173'}/accept-invite?token=${encodeURIComponent(token)}`;
}

export async function audit(input: {
  tenantId?: string | null; actorId: string; action: string; entityType: string; entityId: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  return prisma.auditLog.create({ data: {
    tenantId: input.tenantId || null, actorId: input.actorId,
    action: input.action, entityType: input.entityType, entityId: input.entityId,
    metadata: input.metadata || undefined,
  } });
}
