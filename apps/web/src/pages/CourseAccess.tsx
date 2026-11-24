import { FormEvent, useEffect, useState } from 'react';
import { Alert, PageTitle } from '../components/UI';
import { api, messageFromError, type ApiList } from '../lib/api';
type Student = { id: string; name: string; email: string; studentCode: string; status: string };
type Course = { id: string; title: string; status: string };
export function AdminAccess() {
  const [search, setSearch] = useState(''); const [students, setStudents] = useState<Student[]>([]); const [student, setStudent] = useState<Student | null>(null);
  const [courses, setCourses] = useState<Course[]>([]); const [courseId, setCourseId] = useState('');
  const [source, setSource] = useState('COMPLIMENTARY'); const [method, setMethod] = useState('UPI'); const [amount, setAmount] = useState(''); const [reference, setReference] = useState(''); const [note, setNote] = useState(''); const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => { api<ApiList<Course>>('/academy/admin/courses?pageSize=100').then(r => setCourses(r.data.filter(c => c.status !== 'ARCHIVED'))).catch(e => setError(messageFromError(e))); }, []);
  async function find(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); setStudent(null); try { const result = await api<ApiList<Student>>(`/academy/admin/students?pageSize=20&q=${encodeURIComponent(search)}`); setStudents(result.data); if (!result.data.length) setError('No matching student found.'); } catch (e) { setError(messageFromError(e)); } finally { setBusy(false); } }
  async function grant(e: FormEvent) { e.preventDefault(); if (!student) return; setBusy(true); setError(''); setNotice(''); try {
    await api('/academy/admin/enrollments', { method: 'POST', body: JSON.stringify({ studentCode: student.studentCode, courseId, source, note, expiresAt: expiry ? new Date(expiry).toISOString() : null,
      ...(source === 'MANUAL_PAYMENT' ? { paymentMethod: method, amountPaise: Math.round(Number(amount) * 100), paymentReference: reference } : {}) }) });
    setNotice(`Course access granted to ${student.name}.`); setStudent(null); setStudents([]);
  } catch (e) { setError(messageFromError(e)); } finally { setBusy(false); } }
  return <><PageTitle kicker="COURSE ACCESS" title="Grant course access" description="Find the student, review their details, then grant access. Learning history stays intact when access is revoked or restored."/>
    {error && <Alert message={error}/>} {notice && <Alert success message={notice}/>}
    <section className="academy-panel"><form className="academy-search" onSubmit={find}><label>Student ID or email<input required value={search} onChange={e => { setSearch(e.target.value); setStudent(null); setStudents([]); }}/></label><button className="primary-button" disabled={busy}>Find student</button></form>
      {students.map(s => <div className="academy-lesson-row" key={s.id}><span style={{ flex: 1 }}><strong>{s.name}</strong> · {s.email} · {s.studentCode} · {s.status}</span><button className="academy-small-button" disabled={busy || s.status !== 'ACTIVE'} onClick={() => setStudent(s)}>Select student</button></div>)}
    </section>
    {student && <section className="academy-panel"><h2>Access for {student.name}</h2><p>{student.email} · {student.studentCode}</p><form className="academy-form-grid" onSubmit={grant}>
      <label>Course<select required value={courseId} onChange={e => setCourseId(e.target.value)}><option value="">Select course</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
      <label>Access reason<select value={source} onChange={e => setSource(e.target.value)}><option value="COMPLIMENTARY">Complimentary / other approved access</option><option value="MANUAL_PAYMENT">Verified offline payment</option></select></label>
      {source === 'MANUAL_PAYMENT' && <><label>Payment method<select value={method} onChange={e => setMethod(e.target.value)}><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label><label>Amount received (₹)<input required type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></label><label>Payment reference<input maxLength={150} value={reference} onChange={e => setReference(e.target.value)}/></label></>}
      <label>Access expiry (optional, local time)<input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)}/></label>
      <label className="academy-wide">Reason / notes<textarea required minLength={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)}/></label>
      <button disabled={busy} className="primary-button">{busy ? 'Granting access…' : 'Confirm course access'}</button>
    </form></section>}
  </>;
}
