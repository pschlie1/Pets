import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type PetDetailData } from '../api/client';

interface Message {
  role: 'owner' | 'agent';
  text: string;
  mode?: 'claude' | 'template';
}

const SUGGESTED = [
  (name: string) => `How is ${name} doing?`,
  (name: string) => `Is the fence keeping ${name} safe?`,
  (name: string) => `How is ${name}'s heart rate trending?`,
  (name: string) => `Is ${name} drinking enough water?`,
  (name: string) => `How are ${name}'s walks lately?`,
];

export function Chat() {
  const { petId } = useParams<{ petId: string }>();
  const [pet, setPet] = useState<PetDetailData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (petId) void api.getPet(petId).then(setPet);
  }, [petId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ask = async (question: string) => {
    if (!petId || !question.trim() || busy) return;
    setMessages((m) => [...m, { role: 'owner', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const reply = await api.askAgent(petId, question);
      setMessages((m) => [...m, { role: 'agent', text: reply.answer, mode: reply.mode }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'agent', text: "I hit a snag reaching the household data — please try that again in a moment.", mode: 'template' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!pet) return <p className="p-8 text-gray-400">Fetching…</p>;

  return (
    <div className="mx-auto flex h-[calc(100vh-11rem)] max-w-2xl flex-col">
      <Link to={`/pets/${pet.id}`} className="mb-2 inline-block text-sm font-bold text-gray-400 hover:text-charcoal">
        ← Back to {pet.name}
      </Link>
      <header className="flex items-center gap-3 rounded-t-2xl bg-card p-4 shadow-sm">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand text-xl" aria-hidden>
          {pet.species === 'dog' ? '🐶' : '🐱'}
        </span>
        <div>
          <h1 className="font-extrabold">Ask about {pet.name}</h1>
          <p className="text-xs text-gray-500">Grounded in your household's device data — not a diagnosis.</p>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-card/50 p-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-center text-sm text-gray-400">Try one of these:</p>
            {SUGGESTED.map((fn) => (
              <button
                key={fn(pet.name)}
                onClick={() => void ask(fn(pet.name))}
                className="block w-full rounded-2xl bg-card p-3 text-left text-sm font-semibold shadow-sm hover:bg-cream"
              >
                {fn(pet.name)}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'owner' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm ${
                m.role === 'owner' ? 'bg-navy text-white' : 'bg-card'
              }`}
            >
              {m.text}
              {m.role === 'agent' && (
                <span className="mt-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {m.mode === 'claude' ? '✨ Claude live' : '🔌 Offline mode — grounded template'}
                </span>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-gray-400">Thinking…</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex gap-2 rounded-b-2xl bg-card p-3 shadow-sm"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask anything about ${pet.name}…`}
          className="flex-1 rounded-full border border-black/10 px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-brand px-5 py-2.5 font-extrabold text-brand-ink disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
