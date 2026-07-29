# Connected Care API — Developer Quick-Start

The machine-readable contract lives in [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1 —
import it into Postman, Insomnia, or a code generator). With the API running,
**interactive docs with "Try it out" are served at [`http://localhost:3001/docs`](http://localhost:3001/docs)**.

## Basics

| | |
|---|---|
| Base URL | `http://localhost:3001` |
| Auth | Sign in via `POST /v1/auth/login` → signed token (HS256 JWT, 12 h) bound to your household → `Authorization: Bearer <token>` on every `/v1` endpoint (exceptions: `/v1/health`, `/v1/auth/login`, `/v1/auth/demo-identities`, `/docs`) |
| Tenancy | Enforced per route: a resource outside your token's household claim → `403 forbidden` |
| Success envelope | `{ "data": ... }` (paginated lists add `"pagination"`) |
| Error envelope | `{ "error": { "code", "message", "details?" } }` — validation failures list per-field `details` |
| Timestamps | ISO-8601 UTC |

## Domains at a glance

| Domain | What it owns |
|---|---|
| Auth | Demo sign-in issuing signed tenant tokens (production: a real IdP, same claim contract) |
| Identity & Household | Households (the tenant boundary), pets, device links |
| Device Telemetry | One ingestion envelope for every device type; unknown event types stored + flagged, never rejected |
| Breed Reference | Shared breed profiles + species-generic fallbacks (not tenant-scoped) |
| Pets | Profiles, personal 14-day baselines, daily metric series for trends |
| Insight Engine | Severity-scored, urgency-tiered insights (`info → monitor → attention → urgent → emergency`) + lifecycle (`acknowledge`/`dismiss`/`route`) |
| Containment & Safety | Live boundary geometry, per-pet zone status, collar health, boundary timeline |
| Realtime | SSE stream of new insights |
| AI Agent | Grounded, guardrailed companion Q&A (`mode: claude \| template`) |
| Vet Report | Live shareable veterinary report + digital share records |
| Demo Tier | Seed, reset, and nine live scenario triggers |

## The core loop, in curl

```bash
# 0. Sign in — the token binds every later call to your household
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
  localhost:3001/v1/auth/login -d '{"email":"peter@connectedcare.demo"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["token"])')
AUTH="Authorization: Bearer $TOKEN"

# Who am I? (client bootstrap)
curl -H "$AUTH" localhost:3001/v1/auth/me

# Seed the reference household (idempotent; happens automatically on first boot)
curl -X POST -H "$AUTH" localhost:3001/v1/demo/households

# 1. Ingest a telemetry event — any device type, one envelope.
#    The demo scores synchronously: the response includes any insights produced.
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  localhost:3001/v1/telemetry/events -d '{
    "device_id": "dev_collar_5001",
    "event_type": "heart_rate_reading",
    "occurred_at": "2026-07-28T14:30:00Z",
    "payload": { "bpm": 112, "activity_state": "resting", "boundary_status": "inside" }
  }'

# 2. Household insight rollup (paginated; filter by urgency/pet/date)
curl -H "$AUTH" 'localhost:3001/v1/households/hh_2291/insights?urgency=attention&limit=10'

# 3. Insight lifecycle
curl -X POST -H "$AUTH" localhost:3001/v1/insights/<insightId>/acknowledge

# 4. Trends for charts (rolling 24h buckets; last point is today)
curl -H "$AUTH" 'localhost:3001/v1/pets/pet_5001/metrics?metric=resting_heart_rate&days=14'

# 5. Ask the companion agent (grounded in household data only)
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  localhost:3001/v1/agent/query -d '{"pet_id":"pet_5001","question":"How is Baxter doing?"}'

# 6. Live containment status (Safety Center payload)
curl -H "$AUTH" localhost:3001/v1/households/hh_2291/containment

# 7. Vet report: assemble, then record a digital share
curl -H "$AUTH" localhost:3001/v1/pets/pet_5001/vet-report
curl -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  localhost:3001/v1/pets/pet_5001/vet-report/share \
  -d '{"recipient":"Lincoln Park Veterinary Clinic","method":"portal"}'

# 8. Demo scenarios: list, then trigger one and watch the pipeline work
curl -H "$AUTH" localhost:3001/v1/demo/scenarios
curl -X POST -H "$AUTH" localhost:3001/v1/demo/households/hh_2291/scenarios/urgent_baxter_heart

# 9. Reset to pristine seed state between demo sessions
curl -X POST -H "$AUTH" localhost:3001/v1/demo/households/hh_2291/reset
```

## Realtime: the SSE stream

New insights push over Server-Sent Events — `event: insight` frames with the full
Insight JSON, plus `: ping` heartbeats every 15 s. Browser `EventSource` cannot
set headers, so the session token travels as a `?token=` query parameter; the
server verifies it and streams **only the token's own household**.

```bash
# Terminal 1: watch the stream (token in the query string)
curl -N "localhost:3001/v1/households/hh_2291/stream?token=$TOKEN"

# Terminal 2: trigger a scenario and watch the frame arrive
curl -X POST -H "$AUTH" localhost:3001/v1/demo/households/hh_2291/scenarios/emergency_boundary_breach
```

```js
// Browser
const es = new EventSource(`/v1/households/${me.household_id}/stream?token=${token}`);
es.addEventListener('insight', (e) => {
  const insight = JSON.parse(e.data);
  console.log(insight.urgency, insight.summary);
});
```

## Enums cheat-sheet

| Enum | Values |
|---|---|
| Urgency tiers | `info` · `monitor` · `attention` · `urgent` · `emergency` |
| Insight types | `pet_health` · `pet_safety` · `equipment` |
| Species | `dog` · `cat` · `other` |
| Device types | `containment_collar` · `feeder` · `fountain` |
| Known event types | `boundary_check` · `boundary_event` · `heart_rate_reading` · `activity_session` · `sleep_session` · `drinking_session` · `feeding_session` · `device_health_ping` |
| Pet metrics | `resting_heart_rate` · `walk_minutes` · `water_intake_ml` · `food_intake_g` · `sleep_hours` |
| Share methods | `portal` · `email` · `link` |
| Scenario keys | `info_water_dip` · `monitor_feeder_drift` · `attention_cold_snap` · `attention_fountain_filter` · `urgent_baxter_heart` · `breach_safe_return` · `collar_signal_lost` · `collar_battery_critical` · `emergency_boundary_breach` |

## Demo-tier notes a developer should know

- **Auth is real** — `POST /v1/auth/login` issues a signed HS256 JWT bound to
  the owner's household, and every tenant-scoped route rejects out-of-claim
  resources with `403 forbidden`. Two demo identities exist to prove isolation:
  `peter@connectedcare.demo` (hh_2291) and `sam@connectedcare.demo` (hh_3350).
  Production swaps the login route for a real IdP; the claim contract and
  enforcement are unchanged. Sign the token with `AUTH_SECRET` (a dev default
  is used, with a console warning, when unset).
- **Scoring is synchronous** on ingestion so demo feedback is instant; production
  consumes the event stream asynchronously so scoring can never block a device.
- **The containment endpoint writes on read** ("lazy top-up" of collar
  check-ins) so a seeded database looks live; deterministic and idempotent.
- **Vet reports are never persisted** — assembled live per request; only share
  records (`vet_shares`) persist. Real vet-portal delivery is a v2 integration.
- **Reset** (`POST /v1/demo/households/hh_2291/reset`) restores byte-identical
  seed state, including clearing share history.
