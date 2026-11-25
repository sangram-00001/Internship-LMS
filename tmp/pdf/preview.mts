import { writeFile } from 'node:fs/promises';
import { renderCertificate } from '../../apps/api/src/lib/certificates.js';
const certificate = { id: '00000000-0000-4000-8000-000000000000', issuedAt: new Date('2026-11-24T12:00:00Z'), revokedAt: null, snapshot: {
  logoAsset: 'aspireedge-20261125.jpg', studentName: 'Sample Learner', courseTitle: 'Full-Stack Web Development', brandName: 'ASPIREEDGE ACADEMY - SAMPLE', signatory: 'Academy Director', accentColor: '#3456dc', templateId: '00000000-0000-4000-8000-000000000001', verificationOrigin: 'http://localhost:5173', requirements: {requireAllLessons:true,requireQuizzes:true,requireAssignments:true,assignmentPassPercent:70},
}};
await writeFile('tmp/pdf/certificate-sample.pdf', await renderCertificate(certificate));
await writeFile('tmp/pdf/certificate-long.pdf', await renderCertificate({...certificate,snapshot:{...certificate.snapshot,studentName:'Alexandra Elizabeth Montgomery-Wellington',courseTitle:'Advanced Application Development, Database Architecture and Professional Software Engineering'}}));
