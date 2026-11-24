export function enrollmentActive(enrollment: { status: string; expiresAt?: Date | null } | null | undefined) {
  return !!enrollment && enrollment.status === 'ACTIVE' && (!enrollment.expiresAt || enrollment.expiresAt > new Date());
}
export function enrollmentStatus(enrollment: { status: string; expiresAt?: Date | null }) {
  return enrollment.status === 'ACTIVE' && !enrollmentActive(enrollment) ? 'EXPIRED' : enrollment.status;
}
