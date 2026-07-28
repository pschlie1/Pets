import { Link } from 'react-router-dom';

/**
 * Every screen is visibly labeled as a demo environment (PRD requirement).
 * Sticky and in-flow (not fixed) so it can never overlap the header, and the
 * long label collapses on small screens instead of wrapping over the nav.
 */
export function DemoBanner() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-charcoal px-4 py-1.5 text-xs font-bold tracking-widest text-brand">
      <span aria-hidden>🧪</span>
      <span className="sm:hidden">DEMO ENVIRONMENT</span>
      <span className="hidden sm:inline">DEMO ENVIRONMENT — SEEDED DATA, NOT A LIVE CUSTOMER ACCOUNT</span>
      <Link to="/demo" className="whitespace-nowrap rounded-full bg-brand px-2 py-0.5 text-charcoal hover:bg-brand-dark">
        Demo controls
      </Link>
    </div>
  );
}
