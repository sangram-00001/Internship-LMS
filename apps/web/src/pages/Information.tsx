import { Link } from 'react-router-dom';
import { PublicHeader } from './Public';

const questions = [
  ['How do I start learning?', 'Create a student account, browse the course catalog, and enroll in a free course or request access to a paid course.'],
  ['Where is my Student ID?', 'After signing in, your Student ID appears in your learning dashboard and in Profile & security. Share it with the administrator when requesting manual course access.'],
  ['Can I pay online?', 'Online checkout is not available yet. Request verified payment instructions from the administrator before making an offline payment. Course access begins after the administrator confirms it.'],
  ['Can I continue where I left off?', 'Completed lessons are saved to your account. The course player opens your first incomplete lesson when you return.'],
  ['What happens when access is revoked?', 'You can no longer open premium course content. Your saved learning progress remains recorded and is available if access is restored.'],
  ['How do I recover my account?', 'Choose Forgot password on the sign-in page. In this local development version, account emails are delivered to the private local mailbox rather than sent externally.'],
];
export function Information({ page }: { page: 'about' | 'faq' | 'contact' }) {
  const supportEmail = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'sangramrath0001@gmail.com';
  return <><PublicHeader/><main className="academy-container academy-section">
    <span className="eyebrow">ASPIREEDGE ACADEMY</span>
    {page === 'about' ? <><h1>Learn at your own pace</h1><p className="academy-lead">AspireEdge Academy brings courses, learning resources, and progress tracking into one place.</p><div className="academy-panel"><h2>Your learning journey</h2><p>Explore the published curriculum, preview available lessons, and use your student dashboard to continue learning. Each course page explains its content, level, duration, instructor, and price.</p><Link className="primary-button inline-button" to="/courses">Explore courses</Link></div></> : page === 'faq' ? <><h1>Frequently asked questions</h1>{questions.map(([question, answer]) => <details className="academy-panel" key={question}><summary><strong>{question}</strong></summary><p>{answer}</p></details>)}</> : <><h1>Contact AspireEdge</h1><div className="academy-panel"><h2>Course and account support</h2><p>When asking about course access, include your Student ID and course title. Never send your password or password-reset links.</p>{supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail) ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : <p>The public support contact has not been configured yet.</p>}<p><Link to="/faq">Read the frequently asked questions</Link></p></div></>}
  </main></>;
}
