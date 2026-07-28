import { getDb } from '../connection';
import { resetAll } from './index';

const db = getDb();
resetAll(db);
const events = db.prepare('SELECT COUNT(*) AS n FROM telemetry_events').get() as { n: number };
const baselines = db.prepare('SELECT COUNT(*) AS n FROM pet_baselines').get() as { n: number };
console.log(`Seeded: ${events.n} telemetry events, ${baselines.n} baselines.`);
