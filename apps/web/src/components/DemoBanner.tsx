import { Link } from 'react-router-dom';

/** Every screen is visibly labeled as a demo environment (PRD requirement). */
export function DemoBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-charcoal px-4 py-1.5 text-xs font-bold tracking-widest text-brand">
      <span aria-hidden>🧪</span>
      DEMO ENVIRONMENT — SEEDED DATA, NOT A LIVE CUSTOMER ACCOUNT
      <Link to="/demo" className="rounded-full bg-brand px-2 py-0.5 text-charcoal hover:bg-brand-dark">
        Demo controls
      </Link>
    </div>
  );
}
