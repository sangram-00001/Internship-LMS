import { useEffect, useState } from 'react';
import { Check, Layers3 } from 'lucide-react';
import { Alert, PageTitle, Skeleton } from '../components/UI';
import { api, messageFromError, type ApiOne } from '../lib/api';

type Plan = { id: string; name: string; monthlyPricePaise: number; studentLimit: number; trainerLimit: number; courseLimit: number };
export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api<ApiOne<Plan[]>>('/platform/plans').then(r => setPlans(r.data)).catch(e => setError(messageFromError(e))).finally(() => setLoading(false)); }, []);
  return <><PageTitle kicker="PLATFORM / BILLING" title="Subscription plans" description="Review your product tiers and the usage limits assigned to each plan."/>
    {error && <Alert message={error}/>} {loading ? <Skeleton/> : <div className="plans-grid">{plans.map((plan, i) => <div className={`plan-card ${i === 1 ? 'featured-plan' : ''}`} key={plan.id}><div className="plan-symbol"><Layers3 size={22}/></div><span className="eyebrow">{i === 1 ? 'POPULAR CHOICE' : 'SUBSCRIPTION TIER'}</span><h2>{plan.name}</h2><p>{plan.name === 'Enterprise' ? 'Contact sales for pricing' : 'A flexible starting point for your customers.'}</p>
      <div className="plan-price">{plan.monthlyPricePaise === 0 ? 'Custom' : `₹${(plan.monthlyPricePaise / 100).toLocaleString('en-IN')}`}<small>{plan.monthlyPricePaise === 0 ? '' : '/ month'}</small></div>
      <div className="plan-divider"/>{[
        `${plan.studentLimit.toLocaleString('en-IN')} students`, `${plan.trainerLimit.toLocaleString('en-IN')} trainers`, `${plan.courseLimit.toLocaleString('en-IN')} courses`, 'Internship management', 'Company workspace',
      ].map(value => <div className="plan-feature" key={value}><Check size={17}/>{value}</div>)}
    </div>)}</div>}
    <div className="info-strip"><Layers3 size={19}/><div><strong>Billing integration is a later phase.</strong><p>Plan entitlements and trial subscriptions work in this starter. Checkout, renewals and plan editing are not yet connected to a payment provider.</p></div></div>
  </>;
}
