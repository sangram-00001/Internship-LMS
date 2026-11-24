import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, BookOpen, BriefcaseBusiness, GraduationCap, Layers3, ShieldCheck, Sparkles, UsersRound, Users, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, messageFromError, type ApiOne } from '../lib/api';
import { Alert, PageTitle, Skeleton, StatCard } from '../components/UI';

type PlatformStats = { companies: number; activeCompanies: number; suspendedCompanies: number; students: number; trainers: number; internships: number; courses: number; subscriptions: number };
type TenantStats = { students: number; trainers: number; activeInternships: number; courses: number; batches: number; activeMemberships: number };
export function Dashboard() {
  const { me } = useAuth();
  const platform = me?.scope === 'PLATFORM';
  const studentOnly = !platform && me?.roles.every(role => role === 'STUDENT');
  const [stats, setStats] = useState<PlatformStats | TenantStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (studentOnly) return;
    api<ApiOne<PlatformStats | TenantStats>>(platform ? '/platform/dashboard' : '/tenant/dashboard')
      .then(r => setStats(r.data)).catch(err => setError(messageFromError(err)));
  }, [platform, studentOnly]);
  if (studentOnly) return <div className="dashboard-page"><PageTitle kicker="STUDENT WORKSPACE" title={`Welcome, ${me?.user.name.split(' ')[0]}`} description="Your student account is active. Learning features will be included in the next development phase."/>
    <div className="feature-upcoming"><Sparkles size={27}/><h2>Student learning portal is next</h2><p>The current starter includes account invitations, company management and administrative CRUD. Courses, lessons and student assignments are not yet implemented.</p></div></div>;
  const p = stats as PlatformStats | null;
  const t = stats as TenantStats | null;
  return <div className="dashboard-page"><PageTitle kicker={platform ? 'PLATFORM OVERVIEW' : 'COMPANY OVERVIEW'}
    title={platform ? 'Good to have you back.' : `Welcome back, ${me?.user.name.split(' ')[0] || 'there'}.`}
    description={platform ? 'A clear view of all your companies, learners and platform activity.' : `Here's what's happening at ${me?.tenant?.name} today.`}
    action={<span className="today-pill"><Activity size={16}/> Live overview</span>}/>
    {error && <Alert message={error}/>}
    {!stats && !error ? <Skeleton/> : stats && <>
      <div className="stat-grid">{platform ? <>
        <StatCard title="Total companies" value={p!.companies} icon={<Building2 size={22}/>} footer="Across the platform"/>
        <StatCard title="Active companies" value={p!.activeCompanies} icon={<ShieldCheck size={22}/>} tone="aqua" footer="Currently enabled"/>
        <StatCard title="Total students" value={p!.students} icon={<GraduationCap size={22}/>} tone="violet" footer="Active student profiles"/>
        <StatCard title="Subscriptions" value={p!.subscriptions} icon={<Layers3 size={22}/>} tone="amber" footer="Active and trial"/>
        <StatCard title="Trainers" value={p!.trainers} icon={<UsersRound size={22}/>} tone="aqua"/>
        <StatCard title="Internships" value={p!.internships} icon={<BriefcaseBusiness size={22}/>} tone="indigo"/>
        <StatCard title="Courses" value={p!.courses} icon={<BookOpen size={22}/>} tone="violet"/>
        <StatCard title="Suspended" value={p!.suspendedCompanies} icon={<ShieldCheck size={22}/>} tone="amber" footer="Companies with blocked access"/>
      </> : <>
        <StatCard title="Total students" value={t!.students} icon={<GraduationCap size={22}/>} footer="Active learners"/>
        <StatCard title="Active trainers" value={t!.trainers} icon={<UsersRound size={22}/>} tone="aqua" footer="Your teaching team"/>
        <StatCard title="Active internships" value={t!.activeInternships} icon={<BriefcaseBusiness size={22}/>} tone="violet" footer="Published or ongoing"/>
        <StatCard title="Courses" value={t!.courses} icon={<BookOpen size={22}/>} tone="amber" footer="Available in workspace"/>
        <StatCard title="Batches" value={t!.batches} icon={<Layers3 size={22}/>} tone="indigo"/>
        <StatCard title="Workspace members" value={t!.activeMemberships} icon={<Users size={22}/>} tone="aqua"/>
      </>}</div>
      <div className="dashboard-lower"><section className="panel getting-started"><div className="panel-kicker"><Sparkles size={17}/> GETTING STARTED</div><h2>{platform ? 'Your platform, your rules.' : 'Everything starts here.'}</h2>
        <p>{platform ? 'Create a company workspace, share its secure invitation, and start managing your customers.' : 'Build your team, create internships and organize your training programs—all in one place.'}</p>
        <Link className="primary-button inline-button" to={platform ? '/platform/companies' : '/company/internships'}>{platform ? 'Manage companies' : 'Manage internships'}<ArrowRight size={17}/></Link>
        <div className="getting-shapes"><div/><div/><div/></div></section>
        <section className="panel quick-actions"><div className="panel-kicker">QUICK ACCESS</div><h2>Jump back in</h2>
          {(platform ? [
            { label: 'Company directory', caption: 'Create and manage customers', to: '/platform/companies', icon: Building2 },
            { label: 'Subscription plans', caption: 'Review your plan catalog', to: '/platform/plans', icon: Layers3 },
          ] : [
            { label: 'Student directory', caption: 'Manage learners and invitations', to: '/company/students', icon: GraduationCap },
            { label: 'Course library', caption: 'Manage your courses', to: '/company/courses', icon: BookOpen },
            { label: 'Batch management', caption: 'Organize internship batches', to: '/company/batches', icon: Layers3 },
          ]).map(a => { const Icon = a.icon; return <Link className="quick-action" to={a.to} key={a.to}><span className="quick-icon"><Icon size={19}/></span><span><strong>{a.label}</strong><small>{a.caption}</small></span><ArrowRight size={17}/></Link>; })}
        </section></div>
    </>}
  </div>;
}
