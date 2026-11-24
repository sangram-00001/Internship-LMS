import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Search, Eye, ArrowLeft, ArrowRight, Check, Link2, Copy, ShieldCheck } from 'lucide-react';
import { api, messageFromError, type ApiList, type ApiOne } from '../lib/api';
import { Alert, Badge, EmptyState, formatDate, Modal, PageTitle, Skeleton, statusVariant, initials } from '../components/UI';

type Plan = { id: string; name: string; monthlyPricePaise: number; studentLimit: number; trainerLimit: number; courseLimit: number };
type Company = { id: string; name: string; slug: string; status: string; createdAt: string; subscriptions: { status: string; plan: Plan }[]; _count: { students: number; trainers: number; courses: number } };
type Detail = Company & { memberships: { status: string; user: { name: string; email: string } }[]; _count: Company['_count'] & { internships: number; batches: number } };
const initial = { name: '', slug: '', adminName: '', adminEmail: '', planId: '' };
export function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(initial);
  const [inviteUrl, setInviteUrl] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const result = await api<ApiList<Company>>(`/platform/companies?page=${page}&pageSize=10&q=${encodeURIComponent(search)}`);
      setCompanies(result.data); setTotal(result.meta.total); setError(''); }
    catch(err) { setError(messageFromError(err)); }
    finally { setLoading(false); }
  }, [page, search]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { api<ApiOne<Plan[]>>('/platform/plans').then(r => setPlans(r.data)).catch(() => {}); }, []);
  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const result = await api<ApiOne<{ company: Company; invitationUrl: string }>>('/platform/companies', {
      method:'POST', body: JSON.stringify({ ...form, ...(form.planId ? { planId: form.planId } : {}) }),
    });
      setShowCreate(false); setInviteUrl(result.data.invitationUrl); setForm(initial); setPage(1); await refresh(); }
    catch(err) { setError(messageFromError(err)); }
    finally { setBusy(false); }
  }
  async function showDetails(id: string) {
    try { const result = await api<ApiOne<Detail>>(`/platform/companies/${id}`); setDetail(result.data); }
    catch(err) { setError(messageFromError(err)); }
  }
  async function toggleStatus(company: Company | Detail) {
    const next = company.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (!window.confirm(`Are you sure you want to ${next === 'ACTIVE' ? 'reactivate' : 'suspend'} ${company.name}?`)) return;
    try { await api(`/platform/companies/${company.id}`, { method:'PATCH', body:JSON.stringify({ status: next }) });
      if (detail) setDetail(null); await refresh(); }
    catch(err) { setError(messageFromError(err)); }
  }
  return <><PageTitle kicker="PLATFORM / DIRECTORY" title="Company management" description="Create, manage and oversee every company using your LMS."
    action={<button type="button" className="primary-button" onClick={() => setShowCreate(true)}><Plus size={18}/> New company</button>}/>
    {error && <Alert message={error} onClose={() => setError('')}/>}
    <div className="workspace-panel"><div className="list-heading"><div><h2>All companies <span className="count-pill">{total}</span></h2><p>Workspaces registered on Aspireedge LMS</p></div>
      <form className="search-field" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query); }}><Search size={18}/><input placeholder="Search company or slug" value={query} onChange={e => setQuery(e.target.value)}/><button type="submit">Search</button></form></div>
      {loading ? <Skeleton/> : companies.length === 0 ? <EmptyState title="No companies found" subtitle="Create your first company or try a different search."/> : <div className="table-wrap"><table className="data-table"><thead><tr><th>COMPANY</th><th>STATUS</th><th>PLAN</th><th>STUDENTS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>
        {companies.map(c => <tr key={c.id}><td><div className="name-cell"><div className="row-avatar">{initials(c.name)}</div><div><strong>{c.name}</strong><small>{c.slug}</small></div></div></td>
          <td><Badge variant={statusVariant(c.status)}>{c.status}</Badge></td><td>{c.subscriptions[0]?.plan.name || '—'}</td><td>{c._count.students}</td><td>{formatDate(c.createdAt)}</td>
          <td><div className="table-actions"><button title="View details" type="button" onClick={() => showDetails(c.id)}><Eye size={17}/></button><button className="text-link" type="button" onClick={() => toggleStatus(c)}>{c.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</button></div></td></tr>)}
        </tbody></table></div>}
      <div className="table-footer"><span>Showing {companies.length} of {total} companies</span><div><button type="button" disabled={page === 1} onClick={() => setPage(x => x - 1)}><ArrowLeft size={15}/> Previous</button><span>Page {page}</span><button type="button" disabled={page * 10 >= total} onClick={() => setPage(x => x + 1)}>Next <ArrowRight size={15}/></button></div></div></div>
    {showCreate && <Modal title="Create company workspace" close={() => setShowCreate(false)}><form onSubmit={create} className="entity-form">
      <div className="form-columns"><label>Company name *<input required minLength={2} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: f.slug || e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') }))} placeholder="Acme Technologies"/></label>
      <label>Company slug *<input required minLength={2} value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase() }))} placeholder="acme-technologies"/></label>
      <label>Admin full name *<input required minLength={2} value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} placeholder="Alex Johnson"/></label>
      <label>Admin email *<input required type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} placeholder="admin@company.com"/></label>
      <label className="form-wide">Subscription plan<select value={form.planId} onChange={e => setForm(f => ({ ...f, planId: e.target.value }))}><option value="">Starter (default)</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Cancel</button><button disabled={busy} className="primary-button" type="submit">{busy ? 'Creating…' : 'Create workspace'}<Plus size={16}/></button></div></form></Modal>}
    {inviteUrl && <Modal title="Company created successfully" close={() => setInviteUrl('')}><div className="success-invite"><div className="success-check"><Check size={30}/></div><h3>Workspace is ready!</h3><p>Share this one-time invitation link privately with the company's administrator. The administrator can create their password and activate access.</p>
      <div className="invite-url"><Link2 size={18}/><input readOnly aria-label="Invitation link" value={inviteUrl}/><button type="button" title="Copy invitation link" onClick={() => void navigator.clipboard.writeText(inviteUrl)}><Copy size={18}/></button></div><div className="warning-note">This link is shown only once, and expires in 7 days. It is not emailed automatically in the starter build.</div><button className="primary-button" onClick={() => setInviteUrl('')}>Done <Check size={16}/></button></div></Modal>}
    {detail && <Modal title="Company overview" close={() => setDetail(null)}><div className="company-detail"><div className="detail-hero"><div className="detail-symbol"><Building2 size={28}/></div><div><h3>{detail.name}</h3><div className="muted">{detail.slug}</div><Badge variant={statusVariant(detail.status)}>{detail.status}</Badge></div></div>
      <div className="detail-stats"><div><strong>{detail._count.students}</strong><span>Students</span></div><div><strong>{detail._count.trainers}</strong><span>Trainers</span></div><div><strong>{detail._count.internships}</strong><span>Internships</span></div><div><strong>{detail._count.courses}</strong><span>Courses</span></div></div>
      <h4>Company administrators</h4>{detail.memberships.map((m, i) => <div className="member-line" key={i}><ShieldCheck size={18}/><div><strong>{m.user.name}</strong><small>{m.user.email}</small></div><Badge variant={m.status === 'ACTIVE' ? 'green' : 'amber'}>{m.status}</Badge></div>)}
      <div className="modal-actions"><button className="secondary-button" onClick={() => setDetail(null)}>Close</button><button className="primary-button" onClick={() => toggleStatus(detail)}>{detail.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} company</button></div>
    </div></Modal>}
  </>;
}
