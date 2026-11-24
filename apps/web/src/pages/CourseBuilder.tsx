import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, PageTitle, Skeleton } from '../components/UI';
import { api, messageFromError, type ApiOne } from '../lib/api';

type Lesson = { id: string; title: string; kind: 'TEXT' | 'VIDEO' | 'PDF' | 'LINK'; content: string | null; contentUrl: string | null; isPreview: boolean; position: number; archivedAt: string | null };
type Module = { id: string; title: string; position: number; archivedAt: string | null; lessons: Lesson[] };
type FullCourse = { id: string; title: string; instructor: string | null; learningObjectives: string[]; thumbnailUrl: string | null; modules: Module[] };
type Draft = { id?: string; moduleId: string; title: string; kind: Lesson['kind']; content: string; contentUrl: string; isPreview: boolean };
export function AdminCourseBuilder() {
  const { id } = useParams();
  const [course, setCourse] = useState<FullCourse | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = useCallback(async () => { const r = await api<ApiOne<FullCourse>>(`/academy/admin/courses/${id}`); setCourse(r.data); }, [id]);
  useEffect(() => { void load().catch(e => setError(messageFromError(e))); }, [load]);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(messageFromError(e)); } finally { setBusy(false); } }
  async function update(path: string, body: unknown) { await api(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  async function upload(file: File) {
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose a file smaller than 50 MB.');
    return (await api<ApiOne<{ url: string; mime: string }>>(`/media/courses/${id}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })).data;
  }
  function reorder(items: { id: string }[], index: number, direction: number, path: string) {
    const ids = items.map(item => item.id); const destination = index + direction;
    if (destination < 0 || destination >= ids.length) return;
    [ids[index], ids[destination]] = [ids[destination]!, ids[index]!];
    void run(() => update(path, { ids }));
  }
  async function saveLesson(e: FormEvent) {
    e.preventDefault(); if (!draft || !course) return;
    await run(async () => {
      const { id: lessonId, moduleId, ...fields } = draft;
      await api(lessonId ? `/academy/admin/lessons/${lessonId}` : `/academy/admin/modules/${moduleId}/lessons`, {
        method: lessonId ? 'PATCH' : 'POST', body: JSON.stringify({ ...fields, content: fields.content || null, contentUrl: fields.contentUrl || null,
          ...(!lessonId ? { position: course.modules.find(m => m.id === moduleId)?.lessons.length || 0 } : {}) }),
      }); setDraft(null);
    });
  }
  return <><PageTitle kicker="COURSE BUILDER" title={course?.title || 'Course content'} description="Arrange the curriculum, upload resources, and manage previews. Archived content retains its learning history." action={<Link to="/admin/courses" className="academy-small-button">All courses</Link>}/>
    {error && <Alert message={error}/>} {!course ? <Skeleton/> : <>
      <section className="academy-panel"><h2>Course information</h2>
        <form key={`${course.instructor}-${course.learningObjectives.join('|')}`} className="auth-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(() => update(`/academy/admin/courses/${id}`, { instructor: String(data.get('instructor')), learningObjectives: String(data.get('objectives')).split('\n').map(v => v.trim()).filter(Boolean) })); }}>
          <label>Instructor<input name="instructor" maxLength={120} defaultValue={course.instructor || ''}/></label>
          <label>Learning objectives (one per line)<textarea name="objectives" rows={4} defaultValue={course.learningObjectives.join('\n')}/></label>
          <button className="primary-button" disabled={busy}>Save course information</button>
        </form>
        <label>Upload thumbnail (PNG or JPEG)<input disabled={busy} type="file" accept="image/png,image/jpeg" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { const asset = await upload(file); await update(`/academy/admin/courses/${id}`, { thumbnailUrl: asset.url }); }); }}/></label>
        {course.thumbnailUrl && <img src={course.thumbnailUrl} alt="Course thumbnail" style={{ width: 240, maxWidth: '100%', borderRadius: 12 }}/>}
      </section>
      <section className="academy-panel"><form className="academy-inline-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const title = String(new FormData(form).get('title')); void run(async () => { await api(`/academy/admin/courses/${id}/modules`, { method: 'POST', body: JSON.stringify({ title, position: course.modules.length }) }); form.reset(); }); }}>
        <label>New module<input name="title" required minLength={2} maxLength={180}/></label><button className="primary-button" disabled={busy}>Add module</button>
      </form></section>
      {course.modules.map((module, index) => <section className="academy-panel" key={module.id}>
        <form className="academy-inline-form" onSubmit={e => { e.preventDefault(); const title = String(new FormData(e.currentTarget).get('title')); void run(() => update(`/academy/admin/modules/${module.id}`, { title })); }}>
          <label>Module {index + 1}{module.archivedAt ? ' · Archived' : ''}<input name="title" defaultValue={module.title} key={module.title} required minLength={2} maxLength={180}/></label>
          <button className="academy-small-button" disabled={busy}>Save title</button>
        </form>
        <div className="academy-actions"><button className="academy-small-button" disabled={busy || index === 0} onClick={() => reorder(course.modules, index, -1, `/academy/admin/courses/${id}/module-order`)}>Move module up</button><button className="academy-small-button" disabled={busy || index === course.modules.length - 1} onClick={() => reorder(course.modules, index, 1, `/academy/admin/courses/${id}/module-order`)}>Move module down</button>
          <button className="academy-small-button" disabled={busy} onClick={() => void run(() => update(`/academy/admin/modules/${module.id}/archive`, { archived: !module.archivedAt }))}>{module.archivedAt ? 'Restore module' : 'Archive module'}</button></div>
        {module.lessons.map((lesson, lessonIndex) => <div className="academy-lesson-row" key={lesson.id}>
          <span style={{ flex: 1 }}>{lesson.title} · {lesson.kind}{lesson.isPreview ? ' · Preview' : ''}{lesson.archivedAt ? ' · Archived' : ''}</span>
          <button className="academy-small-button" disabled={busy} onClick={() => setDraft({ ...lesson, moduleId: module.id, content: lesson.content || '', contentUrl: lesson.contentUrl || '' })}>Edit lesson</button>
          <button className="academy-small-button" disabled={busy || lessonIndex === 0} aria-label={`Move ${lesson.title} up`} onClick={() => reorder(module.lessons, lessonIndex, -1, `/academy/admin/modules/${module.id}/lesson-order`)}>↑</button>
          <button className="academy-small-button" disabled={busy || lessonIndex === module.lessons.length - 1} aria-label={`Move ${lesson.title} down`} onClick={() => reorder(module.lessons, lessonIndex, 1, `/academy/admin/modules/${module.id}/lesson-order`)}>↓</button>
          <button className="academy-small-button" disabled={busy} onClick={() => void run(() => update(`/academy/admin/lessons/${lesson.id}/archive`, { archived: !lesson.archivedAt }))}>{lesson.archivedAt ? 'Restore' : 'Archive'}</button>
        </div>)}
        <button disabled={busy || !!module.archivedAt} className="primary-button" onClick={() => setDraft({ moduleId: module.id, title: '', kind: 'TEXT', content: '', contentUrl: '', isPreview: false })}>Add lesson</button>
      </section>)}
    </>}
    {draft && <div className="modal-backdrop"><section className="modal-panel academy-form-modal" role="dialog" aria-modal="true" aria-label="Lesson editor">
      <h2>{draft.id ? 'Edit lesson' : 'Add lesson'}</h2><form className="auth-form" onSubmit={saveLesson}>
        <label>Lesson title<input required minLength={2} maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <label>Type<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Lesson['kind'] })}><option>TEXT</option><option>VIDEO</option><option>PDF</option><option>LINK</option></select></label>
        <label>Written content<textarea rows={4} maxLength={25000} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })}/></label>
        <label>Resource URL<input type="url" value={draft.contentUrl} onChange={e => setDraft({ ...draft, contentUrl: e.target.value })}/></label>
        <label>Upload PDF or video (maximum 50 MB)<input type="file" accept="application/pdf,video/mp4,video/webm" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { const asset = await upload(file); setDraft({ ...draft, contentUrl: asset.url, kind: asset.mime === 'application/pdf' ? 'PDF' : 'VIDEO' }); }); }}/></label>
        <label><input type="checkbox" checked={draft.isPreview} onChange={e => setDraft({ ...draft, isPreview: e.target.checked })}/> Public preview</label>
        <div className="academy-actions"><button className="academy-small-button" disabled={busy} type="button" onClick={() => setDraft(null)}>Cancel</button><button disabled={busy} className="primary-button">Save lesson</button></div>
      </form></section></div>}
  </>;
}
