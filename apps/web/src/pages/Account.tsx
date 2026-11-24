import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, messageFromError, type ApiOne } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Alert, PageTitle } from '../components/UI';

export function AccountLink({ mode }: { mode: 'forgot' | 'reset' | 'verify' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, '', window.location.pathname); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'reset' && password !== confirmation) throw new Error('Passwords must match.');
      if (mode !== 'forgot' && !token) throw new Error('Open the complete link from your email.');
      await api(`/account/${mode === 'forgot' ? 'forgot-password' : mode === 'reset' ? 'reset-password' : 'verify-email'}`, {
        method: 'POST', body: JSON.stringify(mode === 'forgot' ? { email } : { token, ...(mode === 'reset' ? { password } : {}) }),
      });
      setMessage(mode === 'forgot' ? 'If an account exists, a reset email will be sent.' : mode === 'reset' ? 'Password reset. Sign in with your new password.' : 'Your email is verified.');
      setPassword(''); setConfirmation('');
      if (mode !== 'forgot') await refresh();
    } catch (err) { setError(messageFromError(err)); } finally { setBusy(false); }
  }
  return <div className="academy-auth-alone"><section className="academy-auth-card">
    <Link to="/">AspireEdge Academy</Link>
    <h1>{mode === 'forgot' ? 'Forgot password' : mode === 'reset' ? 'Set a new password' : 'Verify your email'}</h1>
    {error && <Alert message={error}/>}{message && <Alert success message={message}/>}
    {!message && <form className="auth-form" onSubmit={submit}>
      {mode === 'forgot' && <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></label>}
      {mode === 'reset' && <><label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label></>}
      <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : 'Verify email'}</button>
    </form>}
    <p><Link to="/login">Back to sign in</Link></p>
  </section></div>;
}

type ProfileData = { name: string; email: string; emailVerifiedAt: string | null; directStudent: { phone: string | null; studentCode: string } | null };
export function Profile() {
  const { refresh } = useAuth(); const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<ApiOne<ProfileData>>('/account/profile').then(({ data }) => { setProfile(data); setName(data.name); setPhone(data.directStudent?.phone || ''); }).catch(e => setError(messageFromError(e))); }, []);
  async function action(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(messageFromError(e)); } finally { setBusy(false); } }
  async function save(e: FormEvent) { e.preventDefault(); await action(async () => { await api('/account/profile', { method: 'PATCH', body: JSON.stringify({ name, ...(profile?.directStudent ? { phone } : {}) }) }); await refresh(); setNotice('Profile saved.'); }); }
  async function change(e: FormEvent) { e.preventDefault(); await action(async () => { if (password !== confirm) throw new Error('Passwords must match.'); await api('/account/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, password }) }); await refresh(); navigate('/login', { replace: true }); }); }
  return <><PageTitle kicker="YOUR ACCOUNT" title="Profile & security" description="Manage your details and keep your account secure."/>
    {error && <Alert message={error}/>} {notice && <Alert success message={notice}/>}
    {profile && <div className="academy-panel"><p><strong>{profile.email}</strong> · {profile.emailVerifiedAt ? 'Verified' : 'Email not verified'}</p>
      {!profile.emailVerifiedAt && <button className="academy-small-button" disabled={busy} onClick={() => void action(async () => { await api('/account/verification-email', { method: 'POST' }); setNotice('Verification email requested.'); })}>Send verification email</button>}
      {profile.directStudent && <p>Student ID: {profile.directStudent.studentCode}</p>}
      <form className="auth-form" onSubmit={save}><label>Full name<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label>
        {profile.directStudent && <label>Phone number<input maxLength={25} value={phone} onChange={e => setPhone(e.target.value)}/></label>}
        <button className="primary-button" disabled={busy}>Save profile</button></form>
      <h2>Change password</h2><p>Changing your password signs you out on all devices.</p>
      <form className="auth-form" onSubmit={change}><label>Current password<input required type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}/></label>
        <label>New password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>
        <label>Confirm new password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)}/></label>
        <button className="primary-button" disabled={busy}>Change password & sign out</button></form>
    </div>}</>;
}
