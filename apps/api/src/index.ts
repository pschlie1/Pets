import { buildApp } from './app';
import { getDb } from './db/connection';
import { REF, seedAll } from './db/seed';

const db = getDb();

// First boot with an empty database: seed the reference household so the
// demo is walk-up ready. (The demo panel's reset endpoint reseeds on demand.)
const seeded = db.prepare(`SELECT id FROM households WHERE id = ?`).get(REF.householdId);
if (!seeded) {
  console.log('Empty database — seeding the reference household…');
  seedAll(db);
}

const { app } = buildApp(db);
const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`Connected Care API tier listening on http://localhost:${port}`);
  console.log(`Agents: ${process.env.ANTHROPIC_API_KEY ? 'Claude API live' : 'offline template mode (set ANTHROPIC_API_KEY for live agents)'}`);
});
