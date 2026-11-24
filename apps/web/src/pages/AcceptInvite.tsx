import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MailOpen, CheckCircle2 } from 'lucide-react';
import { Brand, Alert, Spinner } from '../components/UI';
import { api, messageFromError, setCsrf, type ApiOne } from '../lib/api';
import { useAuth } from '../context/AuthContext';

type Invite = { company: string; tenantSlug: string; email: string; name: string; role: string; needsPassword: boolean };
export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [invite, setInvite] = useState<Invite | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  useEffect(() => {
    if (!token) { setError('Invitation token is missing.'); setLoading(false); return; }
    api<ApiOne<Invite>>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then(r => setInvite(r.data)).catch(e => setError(messageFromError(e))).finally(() => setLoading(false));
  }, [token]);
  async function accept(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const response = await api<ApiOne<{ csrfToken: string }>>('/auth/invitations/accept', {
      method: 'POST', body: JSON.stringify({ token, ...(invite?.needsPassword ? { password } : {}) }),
    });
      setCsrf(response.data.csrfToken); await refresh(); navigate('/company', { replace: true }); }
    catch (err) { setError(messageFromError(err)); }
    finally { setBusy(false); }
  }
  return <div className="invite-shell"><div className="invite-card"><Brand/><div className="invite-visual"><MailOpen size={32}/></div>
    <h1>You're invited!</h1><p>Securely join your Aspireedge learning workspace.</p>
    {loading ? <div className="center-spinner"><Spinner/></div> : error ? <Alert message={error}/> : invite && <>
      <div className="invite-details"><span>COMPANY</span><strong>{invite.company}</strong><span>INVITED EMAIL</span><strong>{invite.email}</strong><span>YOUR ROLE</span><strong>{invite.role.replaceAll('_', ' ')}</strong></div>
      <form onSubmit={accept} className="auth-form">
        {invite.needsPassword && <label>Create password (12+ characters)<input type="password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a secure password" autoComplete="new-password"/></label>}
        {!invite.needsPassword && <div className="existing-account"><CheckCircle2 size={18}/> Your existing account can be linked to this workspace.</div>}
        <button type="submit" disabled={busy} className="primary-button">{busy ? 'Accepting…' : 'Accept invitation'} <ArrowRight size={17}/></button>
      </form>
    </>}
    <div className="invite-back"><Link to="/login">Back to sign in</Link></div>
  </div></div>;
}
