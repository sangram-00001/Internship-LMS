import { FormEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Building2, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { Brand, Alert } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { messageFromError } from '../lib/api';

export function Login() {
  const { login, me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'PLATFORM'|'TENANT'>(params.get('tenant') ? 'TENANT' : 'PLATFORM');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState(params.get('tenant') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (me) return <Navigate to={me.scope === 'PLATFORM' ? '/platform' : '/company'} replace/>;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(email, password, mode === 'TENANT' ? tenantSlug.trim().toLowerCase() : undefined);
      navigate(mode === 'PLATFORM' ? '/platform' : '/company', { replace: true }); }
    catch (err) { setError(messageFromError(err)); }
    finally { setBusy(false); }
  }
  return <div className="auth-shell"><section className="auth-left"><div className="auth-identity"><Brand/></div>
    <div className="auth-hero"><div className="mini-star"><Sparkles size={19}/> YOUR LEARNING OPERATING SYSTEM</div>
      <h1>All your learning.<br/><em>One powerful</em><br/>workspace.</h1><p>Manage companies, internships, courses and student success—all from one beautifully connected platform.</p>
      <div className="auth-feature"><span><ShieldCheck size={19}/></span><div><strong>Built for secure growth</strong><small>Enterprise-minded access and workspace isolation.</small></div></div>
    </div><div className="auth-footer">© {new Date().getFullYear()} Aspireedge Learning Cloud <span>•</span> Built to scale</div></section>
    <section className="auth-right"><div className="login-wrap"><div className="mobile-brand"><Brand/></div><div className="welcome-icon"><LockKeyhole size={25}/></div><h2>Welcome back</h2><p className="auth-subtitle">Sign in to your Aspireedge workspace</p>
    <div className="login-switch"><button type="button" className={mode === 'PLATFORM' ? 'selected' : ''} onClick={() => setMode('PLATFORM')}><ShieldCheck size={17}/> Super Admin</button>
      <button type="button" className={mode === 'TENANT' ? 'selected' : ''} onClick={() => setMode('TENANT')}><Building2 size={17}/> Company Login</button></div>
    {error && <Alert message={error} onClose={() => setError('')}/>}
    <form onSubmit={submit} className="auth-form">
      {mode === 'TENANT' && <label>Company slug<input required value={tenantSlug} onChange={e => setTenantSlug(e.target.value)} placeholder="e.g. acme-technologies" autoCapitalize="none"/></label>}
      <label>Email address<div className="input-icon"><Mail size={18}/><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="username"/></div></label>
      <label>Password<div className="input-icon"><LockKeyhole size={18}/><input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password"/></div></label>
      <button type="submit" disabled={busy} className="primary-button auth-button">{busy ? 'Signing in…' : 'Sign in to workspace'}<ArrowRight size={18}/></button>
    </form><p className="login-hint">New here? Ask your administrator for a secure invitation link.</p>
    <div className="auth-note"><ShieldCheck size={17}/><span>Your account is protected by secure server-side sessions.</span></div></div></section>
  </div>;
}
