import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, X, LoaderCircle } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand brand-official${compact ? ' brand-compact' : ''}`}><img className="brand-logo" src="/brand/aspireedge-20261125.jpg" alt="Aspireedge" width="1080" height="1080"/></div>;
}
export function Badge({ children, variant = 'neutral' }: { children: ReactNode; variant?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot"/>{children}</span>;
}
export function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="empty-state"><div className="empty-visual">✦</div><h3>{title}</h3><p>{subtitle}</p></div>;
}
export function Alert({ message, success = false, onClose }: { message: string; success?: boolean; onClose?: () => void }) {
  return <div className={`alert ${success ? 'alert-success' : 'alert-error'}`}>
    {success ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}<span>{message}</span>
    {onClose && <button className="icon-button" type="button" aria-label="Dismiss" onClick={onClose}><X size={17}/></button>}
  </div>;
}
export function Spinner() { return <LoaderCircle className="spin" size={25} aria-label="Loading"/>; }
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2><p>Complete the details below to continue.</p></div>
      <button type="button" className="icon-button" onClick={close} aria-label="Close dialog"><X size={20}/></button></div>
      {children}
    </section>
  </div>;
}
export function PageTitle({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{kicker}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-title-action">{action}</div>}</div>;
}
export function StatCard({ title, value, icon, tone = 'indigo', footer }: { title: string; value: number | string; icon: ReactNode; tone?: 'indigo'|'aqua'|'amber'|'violet'; footer?: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><div className={`stat-icon ${tone}`}>{icon}</div></div>
    <div className="stat-value">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</div>
    <div className="stat-footer">{footer || 'Live platform data'}</div></div>;
}
export function Skeleton() { return <div className="skeleton-list">{Array.from({ length: 4 }, (_, i) => <div className="skeleton-row" key={i}/>)}</div>; }
export function initials(value: string) { return value.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || 'A'; }
export function formatDate(value?: string | null) { return value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
export function statusVariant(status: string): 'neutral'|'green'|'amber'|'red'|'blue' {
  if (['ACTIVE','PUBLISHED','ONGOING','COMPLETED'].includes(status)) return 'green';
  if (['DRAFT','TRIAL'].includes(status)) return 'amber';
  if (['SUSPENDED','ARCHIVED','EXPIRED','CANCELLED'].includes(status)) return 'red';
  return 'neutral';
}
