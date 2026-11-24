import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Eye, Link2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, messageFromError, type ApiList, type ApiOne } from '../lib/api';
import { Alert, Badge, EmptyState, formatDate, Modal, PageTitle, Skeleton, statusVariant, initials } from '../components/UI';

type Row = Record<string, unknown> & { id: string; createdAt: string; status?: string; title?: string; fullName?: string; name?: string };
type Field = { key: string; label: string; type?: 'text'|'email'|'number'|'textarea'|'select'|'date'; required?: boolean; placeholder?: string; options?: string[]; createOnly?: boolean };
type Config = { title: string; singular: string; description: string; columns: string[]; fields: Field[]; endpoint: string };
const configs: Record<string, Config> = {
  students: { title: 'Students', singular: 'Student', description: 'Manage student profiles, enrollment access and secure invitations.', endpoint: 'students', columns: ['fullName','studentCode','email','college','status'], fields: [
    { key:'fullName', label:'Full name', required:true, placeholder:'e.g. Priya Sharma' },
    { key:'email', label:'Email address', type:'email', required:true, createOnly:true, placeholder:'student@example.com' },
    { key:'studentCode', label:'Student code', required:true, placeholder:'STU-001' },
    { key:'phone', label:'Phone number', placeholder:'Optional' },
    { key:'college', label:'College / university', placeholder:'College name' },
    { key:'department', label:'Department', placeholder:'Computer Science' },
    { key:'graduationYear', label:'Graduation year', type:'number', placeholder:'2027' },
  ] },
  trainers: { title: 'Trainers', singular: 'Trainer', description: 'Manage teaching staff and invite mentors into your workspace.', endpoint: 'trainers', columns: ['fullName','email','specialization','phone','status'], fields: [
    { key:'fullName', label:'Full name', required:true, placeholder:'Trainer name' },
    { key:'email', label:'Email address', type:'email', required:true, createOnly:true, placeholder:'trainer@example.com' },
    { key:'phone', label:'Phone number', placeholder:'Optional' },
    { key:'specialization', label:'Specialization', placeholder:'e.g. Data Science' },
  ] },
  internships: { title: 'Internships', singular: 'Internship', description: 'Create structured internships and manage the programs you deliver.', endpoint: 'internships', columns: ['title','mode','durationDays','capacity','status'], fields: [
    { key:'title', label:'Internship title', required:true, placeholder:'e.g. Python Development' },
    { key:'description', label:'Description', type:'textarea', placeholder:'Program overview' },
    { key:'mode', label:'Internship mode', type:'select', options:['ONLINE','OFFLINE','HYBRID'] },
    { key:'durationDays', label:'Duration (days)', type:'number', placeholder:'45' },
    { key:'capacity', label:'Student capacity', type:'number', placeholder:'100' },
    { key:'startsAt', label:'Start date', type:'date' },
    { key:'endsAt', label:'End date', type:'date' },
    { key:'status', label:'Status', type:'select', options:['DRAFT','PUBLISHED','ONGOING','COMPLETED'] },
  ] },
  courses: { title: 'Courses', singular: 'Course', description: 'Manage your course catalog and prepare courses for delivery.', endpoint: 'courses', columns: ['title','level','status','createdAt'], fields: [
    { key:'title', label:'Course title', required:true, placeholder:'e.g. Introduction to Data Science' },
    { key:'description', label:'Description', type:'textarea', placeholder:'What will students learn?' },
    { key:'level', label:'Difficulty level', type:'select', options:['BEGINNER','INTERMEDIATE','ADVANCED'] },
    { key:'status', label:'Status', type:'select', options:['DRAFT','PUBLISHED'] },
  ] },
  batches: { title: 'Batches', singular: 'Batch', description: 'Organize students into batches for structured program delivery.', endpoint: 'batches', columns: ['name','code','capacity','status','createdAt'], fields: [
    { key:'name', label:'Batch name', required:true, placeholder:'e.g. Python January Cohort' },
    { key:'code', label:'Batch code', required:true, placeholder:'PY-2026-01' },
    { key:'capacity', label:'Capacity', type:'number', placeholder:'60' },
    { key:'startsAt', label:'Start date', type:'date' },
    { key:'endsAt', label:'End date', type:'date' },
    { key:'status', label:'Status', type:'select', options:['DRAFT','ACTIVE','COMPLETED'] },
  ] },
};

function stringify(value: unknown, key: string) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'createdAt' || key.endsWith('At')) return formatDate(String(value));
  if (key === 'durationDays') return `${String(value)} days`;
  return String(value);
}
function fieldValue(row: Row | null, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return '';
  if ((key === 'startsAt' || key === 'endsAt') && value) return String(value).slice(0, 10);
  return String(value);
}
function displayName(row: Row) { return row.fullName || row.title || row.name || String(row.code || row.id); }

export function Resources({ type }: { type: string }) {
  const config = configs[type];
  const { me } = useAuth();
  const isStaff = !!me?.roles.some(r => ['COMPANY_ADMIN','HR'].includes(r));
  const canCreate = isStaff || (type === 'courses' && me?.roles.includes('TRAINER'));
  const canArchive = isStaff;
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string,string>>({});
  const [detail, setDetail] = useState<Row | null>(null);
  const [inviteUrl, setInviteUrl] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const result = await api<ApiList<Row>>(`/tenant/${config.endpoint}?page=${page}&pageSize=10&q=${encodeURIComponent(search)}`);
      setItems(result.data); setTotal(result.meta.total); setError(''); }
    catch (err) { setError(messageFromError(err)); }
    finally { setLoading(false); }
  }, [config.endpoint, page, search]);
  useEffect(() => { void refresh(); }, [refresh]);
  function openCreate() { setEditing(null); setForm({}); setFormError(''); setFormOpen(true); }
  function openEdit(row: Row) {
    setEditing(row); setForm(Object.fromEntries(config.fields.map(f => [f.key, fieldValue(row, f.key)])));
    setFormError(''); setFormOpen(true);
  }
  function buildBody() {
    const body: Record<string,unknown> = {};
    for (const field of config.fields) {
      if (editing && field.createOnly) continue;
      const raw = (form[field.key] || '').trim();
      if (!raw) continue;
      if (field.type === 'number') body[field.key] = Number(raw);
      else if (field.type === 'date') body[field.key] = new Date(`${raw}T00:00:00.000Z`).toISOString();
      else body[field.key] = raw;
    }
    return body;
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setFormError('');
    try {
      const response = await api<ApiOne<{ invitationUrl?: string }>>(`/tenant/${config.endpoint}${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(buildBody()),
      });
      setFormOpen(false);
      if (response.data?.invitationUrl) setInviteUrl(response.data.invitationUrl);
      if (!editing) setPage(1);
      await refresh();
    } catch(err) { setFormError(messageFromError(err)); }
    finally { setBusy(false); }
  }
  async function archive(row: Row) {
    if (!window.confirm(`Archive ${displayName(row)}? This action removes it from active lists.`)) return;
    try { await api(`/tenant/${config.endpoint}/${row.id}`, { method:'DELETE' });
      if (items.length === 1 && page > 1) setPage(p => p - 1); else await refresh();
    } catch(err) { setError(messageFromError(err)); }
  }
  if (!config) return <Alert message="Unknown resource."/>;
  return <><PageTitle kicker="COMPANY / MANAGEMENT" title={config.title} description={config.description}
    action={canCreate && <button type="button" className="primary-button" onClick={openCreate}><Plus size={18}/> Add {config.singular.toLowerCase()}</button>}/>
    {error && <Alert message={error} onClose={() => setError('')}/>}
    <div className="workspace-panel"><div className="list-heading"><div><h2>{config.title} <span className="count-pill">{total}</span></h2><p>Manage records in your company workspace</p></div>
      <form className="search-field" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query); }}><Search size={18}/><input placeholder={`Search ${config.title.toLowerCase()}…`} value={query} onChange={e => setQuery(e.target.value)}/><button type="submit">Search</button></form></div>
      {loading ? <Skeleton/> : items.length === 0 ? <EmptyState title={`No ${config.title.toLowerCase()} found`} subtitle={canCreate ? `Add your first ${config.singular.toLowerCase()} to get started.` : 'No records available for your account.'}/> : <div className="table-wrap"><table className="data-table"><thead><tr>{config.columns.map(k => <th key={k}>{k.replace(/([A-Z])/g,' $1').toUpperCase()}</th>)}<th>ACTIONS</th></tr></thead><tbody>{items.map(row => <tr key={row.id}>{config.columns.map((k, j) => <td key={k}>{j === 0 ? <div className="name-cell"><div className="row-avatar">{initials(String(displayName(row)))}</div><div><strong>{stringify(row[k],k)}</strong>{Boolean(row.email) && k !== 'email' && <small>{String(row.email)}</small>}</div></div> : k === 'status' ? <Badge variant={statusVariant(row.status || '')}>{row.status}</Badge> : stringify(row[k],k)}</td>)}
        <td><div className="table-actions"><button type="button" title="View" onClick={() => setDetail(row)}><Eye size={17}/></button>{canCreate && <button type="button" title="Edit" onClick={() => openEdit(row)}><Pencil size={16}/></button>}{canArchive && <button type="button" title="Archive" className="danger-icon" onClick={() => archive(row)}><Trash2 size={17}/></button>}</div></td></tr>)}</tbody></table></div>}
      <div className="table-footer"><span>Showing {items.length} of {total} records</span><div><button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ArrowLeft size={15}/> Previous</button><span>Page {page}</span><button type="button" disabled={page * 10 >= total} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={15}/></button></div></div>
    </div>
    {formOpen && <Modal title={editing ? `Edit ${config.singular.toLowerCase()}` : `Add ${config.singular.toLowerCase()}`} close={() => setFormOpen(false)}>
      <form className="entity-form" onSubmit={save}>{formError && <Alert message={formError} onClose={() => setFormError('')}/>}<div className="form-columns">{config.fields.filter(field => !editing || !field.createOnly).map(field => <label key={field.key} className={field.type === 'textarea' ? 'form-wide' : ''}>{field.label}{field.required && ' *'}
        {field.type === 'textarea' ? <textarea rows={4} value={form[field.key] || ''} placeholder={field.placeholder} required={field.required} onChange={e => setForm(f => ({ ...f, [field.key]:e.target.value }))}/> : field.type === 'select' ?
        <select value={form[field.key] || field.options?.[0] || ''} onChange={e => setForm(f => ({ ...f, [field.key]:e.target.value }))}>{field.options?.map(option => <option value={option} key={option}>{option.replaceAll('_',' ')}</option>)}</select> :
        <input type={field.type || 'text'} required={field.required} value={form[field.key] || ''} placeholder={field.placeholder} onChange={e => setForm(f => ({ ...f, [field.key]:e.target.value }))}/>}</label>)}</div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" disabled={busy} className="primary-button">{busy ? 'Saving…' : editing ? 'Save changes' : `Create ${config.singular.toLowerCase()}`}</button></div>
      </form></Modal>}
    {detail && <Modal title={`${config.singular} details`} close={() => setDetail(null)}><div className="detail-hero"><div className="detail-symbol">{initials(String(displayName(detail)))}</div><div><h3>{displayName(detail)}</h3><Badge variant={statusVariant(detail.status || '')}>{detail.status || 'Record'}</Badge></div></div>
      <div className="detail-grid">{config.fields.map(field => <div key={field.key}><span>{field.label}</span><strong>{stringify(detail[field.key], field.key)}</strong></div>)}<div><span>Created</span><strong>{formatDate(detail.createdAt)}</strong></div></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDetail(null)}>Close</button>{canCreate && <button type="button" className="primary-button" onClick={() => { openEdit(detail); setDetail(null); }}>Edit record</button>}</div>
    </Modal>}
    {inviteUrl && <Modal title="Invitation ready" close={() => setInviteUrl('')}><div className="success-invite"><h3>New account invited</h3><p>Copy this private invitation link and send it to the person securely. The link is valid for 7 days and is shown only once.</p>
      <div className="invite-url"><Link2 size={18}/><input readOnly aria-label="Invitation link" value={inviteUrl}/><button title="Copy invitation" type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)}><Copy size={18}/></button></div><div className="warning-note">Email delivery has not been configured. Share the link yourself.</div><button type="button" className="primary-button" onClick={() => setInviteUrl('')}>Done</button></div></Modal>}
  </>;
}
