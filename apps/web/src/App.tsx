import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DemoBanner } from './components/DemoBanner';
import { Toast } from './components/Toast';
import { Chat } from './pages/Chat';
import { Dashboard } from './pages/Dashboard';
import { DemoPanel } from './pages/DemoPanel';
import { Equipment } from './pages/Equipment';
import { Insights } from './pages/Insights';
import { PetDetail } from './pages/PetDetail';
import { SafetyCenter } from './pages/SafetyCenter';
import { VetReport } from './pages/VetReport';
import { AuthProvider, useAuth } from './state/AuthContext';
import { HouseholdProvider, useHousehold } from './state/HouseholdContext';

function Nav() {
  const { insights, containment } = useHousehold();
  const unseen = insights.filter((i) => i.acknowledged_status === 'unseen').length;
  const safetyAlert = containment !== null && containment.overall !== 'all_safe';
  const link = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-extrabold transition sm:px-4 ${
      isActive ? 'bg-brand text-brand-ink' : 'text-white hover:bg-white/10'
    }`;

  return (
    // The brand's signature navy header band, straight from petsafe.com.
    <nav className="bg-navy print:hidden">
      <div className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-3">
      <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2 text-lg font-extrabold text-white sm:mr-3">
        <span className="grid h-9 w-11 place-items-center rounded-xl bg-brand text-lg shadow-sm" aria-hidden>
          🐾
        </span>
        <span className="hidden whitespace-nowrap md:inline">Connected Care</span>
      </NavLink>
      <NavLink to="/" end className={link}>
        Home
      </NavLink>
      <NavLink to="/safety" className={link}>
        Safety
        {safetyAlert && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-tier-emergency align-middle" />}
      </NavLink>
      <NavLink to="/insights" className={link}>
        Insights
        {unseen > 0 && (
          <span className="ml-1.5 rounded-full bg-brand px-1.5 text-xs text-brand-ink">{unseen}</span>
        )}
      </NavLink>
      <NavLink to="/equipment" className={link}>
        Equipment
      </NavLink>
      </div>
    </nav>
  );
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const { owner, error } = useAuth();
  if (error) {
    return (
      <p className="p-10 text-center text-sm text-tier-urgent">
        Couldn't sign in to the demo: {error}
      </p>
    );
  }
  if (!owner) return <p className="p-10 text-center text-sm text-gray-400">Signing in to the demo…</p>;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <SignedInGate />
    </AuthProvider>
  );
}

function SignedInGate() {
  return (
    <SignedIn>
      <AppShell />
    </SignedIn>
  );
}

function AppShell() {
  return (
    <HouseholdProvider>
      <BrowserRouter>
        <DemoBanner />
        <div>
          <Nav />
          <main className="mx-auto max-w-4xl px-4 pb-16 pt-5">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/safety" element={<SafetyCenter />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/equipment" element={<Equipment />} />
              <Route path="/pets/:petId" element={<PetDetail />} />
              <Route path="/pets/:petId/vet-report" element={<VetReport />} />
              <Route path="/pets/:petId/chat" element={<Chat />} />
              <Route path="/demo" element={<DemoPanel />} />
            </Routes>
          </main>
        </div>
        <Toast />
      </BrowserRouter>
    </HouseholdProvider>
  );
}
