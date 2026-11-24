import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, GraduationCap, IndianRupee, Plus, ShoppingBag, UserRoundCheck, ArrowRight, LockKeyhole } from 'lucide-react';
import { Alert, Badge, EmptyState, PageTitle, Skeleton, StatCard } from '../components/UI';
import { api, messageFromError, type ApiList, type ApiOne } from '../lib/api';
import { inr, type Course } from './Public';

type Dashboard = {students:number;courses:number;publishedCourses:number;activeEnrollments:number;manualEnrollments:number;pendingOrders:number;recordedRevenuePaise:number;recordedPayments:number};
type Student = {id:string;userId:string;studentCode:string;name:string;email:string;phone:string|null;status:'ACTIVE'|'DISABLED';enrolledCourses:{id:string;title:string;status:string;expiresAt:string|null;source:string;completed:number;total:number;progressPercent:number}[]};
type AdminCourse = Course & {_count?:{modules:number;directEnrollments:number}};
type Order = {id:string;amountPaise:number;status:'PENDING'|'PAID'|'CANCELLED';paymentMethod:string|null;paymentReference:string|null;createdAt:string;course:{title:string};user:{name:string;email:string;directStudent:{studentCode:string}|null}};
export function AdminDashboard(){const [data,setData]=useState<Dashboard|null>(null);const [error,setError]=useState('');useEffect(()=>{api<ApiOne<Dashboard>>('/academy/admin/dashboard').then(r=>setData(r.data)).catch(e=>setError(messageFromError(e)));},[]);return <><PageTitle kicker="ACADEMY OVERVIEW" title="Your academy, at a glance" description="Monitor students, access, payments and learning content."/>{error&&<Alert message={error}/>} {!data?<Skeleton/>:<><div className="stat-grid"><StatCard title="Registered students" value={data.students} icon={<GraduationCap size={22}/>}/><StatCard title="Published courses" value={data.publishedCourses} icon={<BookOpen size={22}/>} tone="aqua"/><StatCard title="Active enrollments" value={data.activeEnrollments} icon={<UserRoundCheck size={22}/>} tone="violet"/><StatCard title="Pending payment requests" value={data.pendingOrders} icon={<ShoppingBag size={22}/>} tone="amber"/><StatCard title="Manually paid enrollments" value={data.manualEnrollments} icon={<LockKeyhole size={22}/>} tone="indigo"/><StatCard title="Recorded offline payments" value={inr(data.recordedRevenuePaise)} icon={<IndianRupee size={22}/>} tone="aqua"/></div><div className="academy-quick-links"><Link className="academy-panel" to="/admin/courses"><BookOpen/><strong>Manage courses</strong><p>Create and publish learning content.</p><ArrowRight size={17}/></Link><Link className="academy-panel" to="/admin/access"><UserRoundCheck/><strong>Grant course access</strong><p>Find a student by ID and unlock any course.</p><ArrowRight size={17}/></Link><Link className="academy-panel" to="/admin/students"><GraduationCap/><strong>Student progress</strong><p>Check enrollment and course completion.</p><ArrowRight size={17}/></Link></div></>}</>}
const emptyForm = {title:'',description:'',previewText:'',category:'',level:'BEGINNER',priceRupees:'',durationHours:'',thumbnailUrl:'',status:'DRAFT'};
export function AdminCourses(){const [courses,setCourses]=useState<AdminCourse[]>([]);const [q,setQ]=useState('');const [search,setSearch]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');const [form,setForm]=useState(emptyForm);const [editing,setEditing]=useState<string|null>(null);const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);
const load=useCallback(()=>{api<ApiList<AdminCourse>>(`/academy/admin/courses?pageSize=100&q=${encodeURIComponent(search)}`).then(r=>setCourses(r.data)).catch(e=>setError(messageFromError(e)));},[search]);useEffect(()=>{load()},[load]);
function edit(c:AdminCourse){setEditing(c.id);setForm({title:c.title,description:c.description||'',previewText:c.previewText||'',category:c.category||'',level:c.level,priceRupees:(c.pricePaise/100).toString(),durationHours:c.durationHours?.toString()||'',thumbnailUrl:c.thumbnailUrl||'',status:c.status});setOpen(true)}
async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const body={title:form.title,description:form.description,previewText:form.previewText,category:form.category,level:form.level,pricePaise:Math.round(Number(form.priceRupees||0)*100),durationHours:form.durationHours?Number(form.durationHours):null,thumbnailUrl:form.thumbnailUrl||null,status:form.status};await api(editing?`/academy/admin/courses/${editing}`:'/academy/admin/courses',{method:editing?'PATCH':'POST',body:JSON.stringify(body)});setOpen(false);setEditing(null);setForm(emptyForm);setNotice(editing?'Course updated.':'Course created.');load()}catch(err){setError(messageFromError(err))}finally{setBusy(false)}}
async function archive(c:AdminCourse){if(!window.confirm(`Archive ${c.title}? Existing enrollments remain recorded.`))return;try{await api(`/academy/admin/courses/${c.id}`,{method:'DELETE'});load();}catch(e){setError(messageFromError(e))}}
return <><PageTitle kicker="COURSE MANAGEMENT" title="Courses" description="Create, edit, publish and archive the courses students can purchase." action={<button className="primary-button inline-button" onClick={()=>{setOpen(true);setEditing(null);setForm(emptyForm)}}><Plus size={17}/> Add course</button>}/>{error&&<Alert message={error} onClose={()=>setError('')}/>} {notice&&<Alert success message={notice} onClose={()=>setNotice('')}/>}
<div className="academy-panel"><form className="academy-search" onSubmit={e=>{e.preventDefault();setSearch(q)}}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search courses" aria-label="Search courses"/><button className="primary-button">Search</button></form><div className="academy-table-scroll"><table className="academy-table"><thead><tr><th>Course</th><th>Price</th><th>Status</th><th>Students</th><th>Actions</th></tr></thead><tbody>{courses.map(c=><tr key={c.id}><td><strong>{c.title}</strong><div className="academy-small">{c.category||'Uncategorized'}</div></td><td>{inr(c.pricePaise)}</td><td><Badge variant={c.status==='PUBLISHED'?'green':c.status==='DRAFT'?'amber':'red'}>{c.status}</Badge></td><td>{c._count?.directEnrollments||0}</td><td><div className="academy-actions"><Link className="academy-small-button" to={`/admin/courses/${c.id}`}>Content</Link><button className="academy-small-button" onClick={()=>edit(c)}>Edit</button>{c.status!=='ARCHIVED'&&<button className="academy-small-button academy-danger" onClick={()=>archive(c)}>Archive</button>}</div></td></tr>)}</tbody></table>{!courses.length&&<EmptyState title="No courses yet" subtitle="Click Add course to start selling your first course."/>}</div></div>
{open&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="modal-panel academy-form-modal" role="dialog" aria-modal="true" aria-label={editing?'Edit course':'Create course'}><h2>{editing?'Edit course':'Create a course'}</h2><form className="academy-form-grid" onSubmit={save}><label>Course title<input required minLength={3} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label>Category<input value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label><label>Price (₹)<input type="number" min="0" step="0.01" value={form.priceRupees} onChange={e=>setForm({...form,priceRupees:e.target.value})}/></label><label>Duration (hours)<input type="number" min="1" value={form.durationHours} onChange={e=>setForm({...form,durationHours:e.target.value})}/></label><label>Level<select value={form.level} onChange={e=>setForm({...form,level:e.target.value})}><option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option></select></label><label>Status<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label><label className="academy-wide">Thumbnail URL (optional)<input type="url" value={form.thumbnailUrl} onChange={e=>setForm({...form,thumbnailUrl:e.target.value})}/></label><label className="academy-wide">Short summary<textarea value={form.previewText} onChange={e=>setForm({...form,previewText:e.target.value})} rows={2}/></label><label className="academy-wide">Course description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={4}/></label><div className="academy-wide academy-actions"><button type="button" className="academy-small-button" onClick={()=>setOpen(false)}>Cancel</button><button disabled={busy} className="primary-button">{busy?'Saving…':'Save course'}</button></div></form></section></div>}</>}
export function AdminStudents() {
 const [history,setHistory]=useState<{id:string;action:string;actor:string;createdAt:string;metadata:{reason?:string;note?:string}|null}[]>([]);
 const [data,setData] = useState<Student[]>([]);
 const [q,setQ] = useState('');
 const [search,setSearch] = useState('');
 const [error,setError] = useState('');
 const [selected,setSelected] = useState<string|null>(null);
 const load=useCallback(()=>{
  api<ApiList<Student>>(`/academy/admin/students?pageSize=100&q=${encodeURIComponent(search)}`)
   .then(r=>setData(r.data)).catch(e=>setError(messageFromError(e)));
 },[search]);
 useEffect(()=>{load()},[load]);
 async function restore(enrollmentId:string){const reason=window.prompt('Reason for restoring course access:');if(!reason||reason.trim().length<3)return;try{await api(`/academy/admin/enrollments/${enrollmentId}/restore`,{method:'POST',body:JSON.stringify({reason})});load()}catch(e){setError(messageFromError(e))}}
 async function showHistory(enrollmentId:string){try{const r=await api<ApiOne<typeof history>>(`/academy/admin/enrollments/${enrollmentId}/history`);setHistory(r.data)}catch(e){setError(messageFromError(e))}}
 async function toggle(s:Student) {
  if(!window.confirm(`${s.status==='ACTIVE'?'Disable':'Enable'} ${s.name}'s account?`)) return;
  try { await api(`/academy/admin/students/${s.id}`,{method:'PATCH',body:JSON.stringify({status:s.status==='ACTIVE'?'DISABLED':'ACTIVE'})}); load(); }
  catch(e){setError(messageFromError(e));}
 }
 async function revoke(enrollmentId:string){
  const reason=window.prompt('Reason for revoking access (required):');
  if(!reason || reason.trim().length<3) return;
  try {await api(`/academy/admin/enrollments/${enrollmentId}/revoke`,{method:'POST',body:JSON.stringify({reason})});load();}
  catch(e){setError(messageFromError(e));}
 }
 return <>
  <PageTitle kicker="STUDENT MANAGEMENT" title="Students & learning progress" description="Search registered students, inspect enrollments and monitor lesson completion." action={<Link className="primary-button inline-button" to="/admin/access">Grant access <ArrowRight size={17}/></Link>}/>
  {error&&<Alert message={error}/>}
  <div className="academy-panel">
   <form className="academy-search" onSubmit={e=>{e.preventDefault();setSearch(q);}}>
    <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search Student ID, name or email" aria-label="Search students"/>
    <button className="primary-button">Search</button>
   </form>
   <div className="academy-table-scroll"><table className="academy-table">
    <thead><tr><th>Student</th><th>Student ID</th><th>Courses</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>{data.map(s=><tr key={s.id}>
     <td><strong>{s.name}</strong><div className="academy-small">{s.email}</div></td>
     <td><code>{s.studentCode}</code></td><td>{s.enrolledCourses.length}</td>
     <td><Link className="academy-small-button" to={`/admin/students/${s.id}`}>Student profile</Link><Badge variant={s.status==='ACTIVE'?'green':'red'}>{s.status}</Badge></td>
     <td><div className="academy-actions">
      <button className="academy-small-button" onClick={()=>setSelected(selected===s.id?null:s.id)}>{selected===s.id?'Hide':'Progress'}</button>
      <button className="academy-small-button" onClick={()=>toggle(s)}>{s.status==='ACTIVE'?'Disable':'Enable'}</button>
     </div></td>
    </tr>)}</tbody>
   </table></div>
   {!data.length&&<EmptyState title="No students" subtitle="Student registrations will appear here."/>}
   {selected && data.filter(s=>s.id===selected).map(s=><div className="academy-student-detail" key={s.id}>
    <h3>{s.name} — course progress</h3>
    {s.enrolledCourses.map(e=><div key={e.id} className="academy-progress-card">
     <div className="academy-between"><strong>{e.title}</strong><span>{e.status} · {e.source.replaceAll('_',' ')}</span></div>
     <div className="academy-progress-bg"><div style={{width:`${e.progressPercent}%`}}/></div>
     <small>{e.completed}/{e.total} lessons completed · {e.progressPercent}%</small>
     <button className="academy-small-button" onClick={()=>void showHistory(e.id)}>Access history</button>{e.status!=='ACTIVE'&&<button className="academy-small-button" onClick={()=>void restore(e.id)}>Restore access</button>}{e.expiresAt&&<small>Expires {new Date(e.expiresAt).toLocaleString()}</small>}{e.status==='ACTIVE'&&<button className="academy-small-button academy-danger" onClick={()=>revoke(e.id)}>Revoke access</button>}
    </div>)}
    {!s.enrolledCourses.length&&<p>No course enrollments yet.</p>}
   </div>)}
  </div>
 {history.length>0&&<section className="academy-panel"><h2>Access history</h2><button onClick={()=>setHistory([])}>Close history</button>{history.map(h=><p key={h.id}>{new Date(h.createdAt).toLocaleString()} · {h.action.replaceAll('_',' ')} · {h.actor}<br/>{h.metadata?.reason||h.metadata?.note}</p>)}</section>}
 </>;
}
export function AdminOrders(){const [orders,setOrders]=useState<Order[]>([]);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [status,setStatus]=useState('');const load=useCallback(()=>{api<ApiOne<Order[]>>(`/academy/admin/orders${status?'?status='+status:''}`).then(r=>setOrders(r.data)).catch(e=>setError(messageFromError(e)));},[status]);useEffect(()=>{load()},[load]);
async function approve(order:Order){if(!window.confirm(`Only approve after verifying receipt of ${inr(order.amountPaise)} from ${order.user.name}. Continue?`))return;try{await api(`/academy/admin/orders/${order.id}/approve`,{method:'POST',body:JSON.stringify({note:'Payment independently verified by administrator'})});setNotice('Payment verified and student access activated.');load()}catch(e){setError(messageFromError(e))}}
async function reject(order:Order){const reason=window.prompt('Reason for rejecting this request:');if(!reason||reason.trim().length<3)return;try{await api(`/academy/admin/orders/${order.id}/reject`,{method:'POST',body:JSON.stringify({reason})});setNotice('Payment request rejected.');load()}catch(e){setError(messageFromError(e))}}
return <><PageTitle kicker="PAYMENTS" title="Offline payment requests" description="Students can submit purchase requests. Verify payment independently before granting access."/>{error&&<Alert message={error} onClose={()=>setError('')}/>} {notice&&<Alert message={notice} success/>}<div className="academy-panel"><label>Status filter <select style={{maxWidth:220,marginLeft:12}} value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option><option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="CANCELLED">Cancelled</option></select></label><div className="academy-table-scroll"><table className="academy-table"><thead><tr><th>Student</th><th>Course</th><th>Amount</th><th>Method</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><strong>{o.user.name}</strong><div className="academy-small">{o.user.directStudent?.studentCode||o.user.email}</div></td><td>{o.course.title}</td><td>{inr(o.amountPaise)}</td><td>{o.paymentMethod||'—'}<div className="academy-small">{o.paymentReference||''}</div></td><td><Badge variant={o.status==='PAID'?'green':o.status==='PENDING'?'amber':'red'}>{o.status}</Badge></td><td>{o.status==='PENDING'?<div className="academy-actions"><button className="academy-small-button" onClick={()=>approve(o)}>Verify & grant</button><button className="academy-small-button academy-danger" onClick={()=>reject(o)}>Reject</button></div>:'—'}</td></tr>)}</tbody></table></div>{!orders.length&&<EmptyState title="No payment records" subtitle="Student requests and manually recorded payments will appear here."/>}</div></>}
