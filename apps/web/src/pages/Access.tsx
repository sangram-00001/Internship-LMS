import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, LockKeyhole, Mail, ShieldCheck, UserRoundPlus } from 'lucide-react';
import { Brand, Alert } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { api, messageFromError, type ApiOne } from '../lib/api';

export function Login() {
 const {me, login} = useAuth(); const navigate = useNavigate();
 const [email,setEmail] = useState(''); const [password,setPassword] = useState('');
 const [busy,setBusy] = useState(false); const [error,setError] = useState('');
 if(me) return <Navigate to={me.scope==='PLATFORM'?'/admin':'/student'} replace/>;
 async function submit(e:FormEvent) { e.preventDefault(); setBusy(true); setError('');
   try {await login(email,password); const m=await api<ApiOne<{scope:string}>>('/auth/me');navigate(m.data.scope==='PLATFORM'?'/admin':'/student',{replace:true});}
   catch(err){setError(messageFromError(err));} finally{setBusy(false);} }
 return <div className="auth-shell"><section className="auth-left"><div className="auth-identity"><Link to="/"><Brand/></Link></div><div className="auth-hero"><div className="mini-star">ASPIREEDGE ACADEMY</div><h1>Keep growing.<br/><em>Keep learning.</em></h1><p>Your courses, achievements and learning journey in one place.</p><div className="auth-feature"><span><BookOpen size={20}/></span><div><strong>Learn on your schedule</strong><small>Pick up from your last completed lesson.</small></div></div></div></section>
 <section className="auth-right"><div className="login-wrap"><div className="welcome-icon"><LockKeyhole size={25}/></div><h2>Welcome back</h2><p className="auth-subtitle">Sign in as a student or administrator</p>
 {error&&<Alert message={error} onClose={()=>setError('')}/>}
 <form className="auth-form" onSubmit={submit}><label>Email address<div className="input-icon"><Mail size={18}/><input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com"/></div></label><label>Password<div className="input-icon"><LockKeyhole size={18}/><input required type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" placeholder="Your password"/></div></label><button disabled={busy} className="primary-button auth-button">{busy?'Signing in…':'Sign in'}<ArrowRight size={18}/></button></form>
 <p className="login-hint"><Link to="/forgot-password">Forgot password?</Link></p><p className="login-hint">New student? <Link to="/register">Create a free account</Link></p><div className="auth-note"><ShieldCheck size={17}/>Secure sign-in</div></div></section></div>;
}
export function Register() {
 const {me, register} = useAuth(); const navigate=useNavigate();
 const [confirmPassword,setConfirmPassword]=useState('');
 const [name,setName]=useState('');const [email,setEmail]=useState('');const [phone,setPhone]=useState('');const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 if(me) return <Navigate to={me.scope==='PLATFORM'?'/admin':'/student'} replace/>;
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{if(password!==confirmPassword) throw new Error('Passwords must match.');await register(name,email,phone,password,confirmPassword);navigate('/student',{replace:true});}catch(err){setError(messageFromError(err));}finally{setBusy(false);}}
 return <div className="academy-auth-alone"><div className="academy-auth-card"><Link to="/"><Brand/></Link><div className="welcome-icon" style={{marginTop:25}}><UserRoundPlus size={25}/></div><h2>Create your student account</h2><p className="auth-subtitle">Browse courses for free. Purchase or request access when you're ready.</p>{error&&<Alert message={error} onClose={()=>setError('')}/>}
 <form className="auth-form" onSubmit={submit}><label>Full name<input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name"/></label><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com"/></label><label>Mobile number (optional)<input value={phone} onChange={e=>setPhone(e.target.value)} maxLength={25} placeholder="Your phone number"/></label><label>Password (at least 12 characters)<input required type="password" minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" placeholder="Create a strong password"/></label><label>Confirm password<input required type="password" minLength={12} maxLength={128} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password"/></label><button className="primary-button auth-button" disabled={busy}>{busy?'Creating account…':'Create student account'}<ArrowRight size={18}/></button></form><p className="login-hint">Already have an account? <Link to="/login">Sign in</Link></p></div></div>;
}
