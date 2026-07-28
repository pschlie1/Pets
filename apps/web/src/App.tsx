import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DemoBanner } from './components/DemoBanner';
import { Toast } from './components/Toast';
import { Chat } from './pages/Chat';
import { Dashboard } from './pages/Dashboard';
import { DemoPanel } from './pages/DemoPanel';
import { Equipment } from './pages/Equipment';
import { Insights } from './pages/Insights';
import { PetDetail } from './pages/PetDetail';
import { HouseholdProvider, useHousehold } from './state/HouseholdContext';

function Nav() {
  const { insights } = useHousehold();
  const unseen = insights.filter((i) => i.acknowledged_status === 'unseen').length;
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-4 py-1.5 text-sm font-extrabold transition ${
      isActive ? 'bg-charcoal text-white' : 'hover:bg-black/5'
    }`;

  return (
    <nav className="mx-auto flex max-w-4xl items-center gap-1 px-4 py-3">
      <NavLink to="/" className="mr-3 flex items-center gap-2 text-lg font-extrabold">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-lg shadow-sm" aria-hidden>
          🐾
        </span>
        Connected Care
      </NavLink>
      <NavLink to="/" end className={link}>
        Home
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
        <div className="pt-8">
          <Nav />
          <main className="mx-auto max-w-4xl px-4 pb-16">
            <Routes>
              <Route path="/" element={<Dashboard />} />
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
