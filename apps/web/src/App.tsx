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
import { HouseholdProvider, useHousehold } from './state/HouseholdContext';

function Nav() {
  const { insights, containment } = useHousehold();
  const unseen = insights.filter((i) => i.acknowledged_status === 'unseen').length;
  const safetyAlert = containment !== null && containment.overall !== 'all_safe';
  const link = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-extrabold transition sm:px-4 ${
      isActive ? 'bg-charcoal text-white' : 'hover:bg-black/5'
    }`;

  return (
    <nav className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-3">
      <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2 text-lg font-extrabold sm:mr-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-lg shadow-sm" aria-hidden>
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
          <span className="ml-1.5 rounded-full bg-brand px-1.5 text-xs text-charcoal">{unseen}</span>
        )}
      </NavLink>
      <NavLink to="/equipment" className={link}>
        Equipment
      </NavLink>
    </nav>
  );
}

export default function App() {
  return (
    <HouseholdProvider>
      <BrowserRouter>
        <DemoBanner />
        <div>
          <Nav />
          <main className="mx-auto max-w-4xl px-4 pb-16">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/safety" element={<SafetyCenter />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/equipment" element={<Equipment />} />
              <Route path="/pets/:petId" element={<PetDetail />} />
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
