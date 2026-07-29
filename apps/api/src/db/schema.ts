/**
 * Connected Care SQLite schema — the data tier's single source of truth.
 * Inlined as a constant so the API needs no runtime filesystem read (which
 * keeps serverless bundles self-contained).
 */
export const SCHEMA_SQL = `
-- Connected Care — SQLite schema (demo data tier)
-- Adapted from the production Postgres DDL (schema-connectedcare.sql).
--
-- PRODUCTION NOTE: Postgres enums become TEXT + CHECK constraints here.
-- PRODUCTION NOTE: JSONB columns become TEXT holding JSON; parsed in the repository layer.
-- PRODUCTION NOTE: TIMESTAMPTZ becomes ISO-8601 UTC TEXT (sorts lexicographically).
-- PRODUCTION NOTE: Row-Level Security policies (tenant isolation by household_id) and
--   monthly partitioning of telemetry_events exist in the Postgres schema and are
--   enforced at the API service layer in this demo instead.

CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    location_city TEXT NOT NULL,
    location_state TEXT NOT NULL,
    location_zip TEXT NOT NULL,
    climate_zone TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_households_zip ON households(location_zip) WHERE deleted_at IS NULL;

-- Shared reference data, not tenant-scoped (read by every household).
CREATE TABLE IF NOT EXISTS breed_profiles (
    id TEXT PRIMARY KEY,
    species TEXT NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
    breed_name TEXT,
    size_class TEXT NOT NULL,
    resting_hr_low INTEGER NOT NULL,
    resting_hr_high INTEGER NOT NULL,
    common_conditions TEXT NOT NULL DEFAULT '[]',
    is_generic_fallback INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_breed_species ON breed_profiles(species);
CREATE UNIQUE INDEX IF NOT EXISTS idx_breed_species_generic
    ON breed_profiles(species) WHERE is_generic_fallback = 1;

CREATE TABLE IF NOT EXISTS pets (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    species TEXT NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
    breed_id TEXT REFERENCES breed_profiles(id),
    breed_reference_confidence TEXT NOT NULL DEFAULT 'low' CHECK (breed_reference_confidence IN ('high', 'low')),
    date_of_birth TEXT,
    weight_lbs REAL,
    sex TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pets_household ON pets(household_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    device_type TEXT NOT NULL CHECK (device_type IN ('containment_collar', 'feeder', 'fountain')),
    model TEXT,
    assignment_mode TEXT NOT NULL CHECK (assignment_mode IN ('dedicated', 'shared')),
    has_pet_attribution INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'low_battery', 'offline', 'needs_service')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_household ON devices(household_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS device_pet_links (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    unlinked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_pet_active
    ON device_pet_links(device_id, pet_id) WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_device_pet_pet ON device_pet_links(pet_id);

CREATE TABLE IF NOT EXISTS pet_baselines (
    pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    mean REAL NOT NULL,
    stdev REAL NOT NULL,
    window_days INTEGER NOT NULL DEFAULT 14,
    sample_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'insufficient_data' CHECK (status IN ('insufficient_data', 'established')),
    last_computed TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (pet_id, metric)
);

-- PRODUCTION NOTE: partitioned by month on occurred_at in Postgres; single table here.
CREATE TABLE IF NOT EXISTS telemetry_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    pet_id TEXT REFERENCES pets(id),
    device_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    schema_version INTEGER NOT NULL DEFAULT 1,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Set when an unknown event_type arrives: stored + flagged for schema review, never rejected.
    flagged_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_household_time ON telemetry_events(household_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_pet_metric_time ON telemetry_events(pet_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry_events(device_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    pet_id TEXT REFERENCES pets(id),
    device_id TEXT REFERENCES devices(id),
    insight_type TEXT NOT NULL CHECK (insight_type IN ('pet_health', 'pet_safety', 'equipment')),
    metric TEXT NOT NULL,
    severity_score REAL NOT NULL,
    urgency TEXT NOT NULL CHECK (urgency IN ('info', 'monitor', 'attention', 'urgent', 'emergency')),
    summary TEXT NOT NULL DEFAULT '',
    recommended_action TEXT NOT NULL DEFAULT '',
    generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    acknowledged_status TEXT NOT NULL DEFAULT 'unseen' CHECK (acknowledged_status IN ('unseen', 'seen', 'acknowledged', 'dismissed')),
    acknowledged_at TEXT,
    routed_to_associate INTEGER NOT NULL DEFAULT 0,
    narration_mode TEXT NOT NULL DEFAULT 'template' CHECK (narration_mode IN ('claude', 'template')),
    -- Dedupe key: one insight per subject+metric+day, upgraded in place if severity rises.
    dedupe_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_insights_household_time ON insights(household_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_pet ON insights(pet_id) WHERE pet_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_dedupe ON insights(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Owners: the identity → tenant binding. An authenticated owner's token
-- carries their household_id claim, which every tenant-scoped endpoint
-- enforces. PRODUCTION NOTE: a real IdP owns credentials; this table only
-- maps identities to households.
CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Vet sharing: a share is a recorded hand-off of the live report, not a
-- stored snapshot. insight_ids is TEXT-holding-JSON (parsed in the route).
CREATE TABLE IF NOT EXISTS vet_shares (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    pet_id TEXT NOT NULL REFERENCES pets(id),
    recipient TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('portal', 'email', 'link')),
    insight_ids TEXT NOT NULL DEFAULT '[]',
    shared_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_vet_shares_pet ON vet_shares(pet_id, shared_at DESC);

-- Consumable replacement orders placed from equipment insights (demo commerce:
-- an order is recorded and confirmed, never fulfilled).
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    sku TEXT NOT NULL,
    label TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed')),
    eta_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_household ON orders(household_id, created_at DESC);

-- Shared by location, not tenant-scoped.
CREATE TABLE IF NOT EXISTS environmental_context (
    id TEXT PRIMARY KEY,
    location_zip TEXT NOT NULL,
    date TEXT NOT NULL,
    temperature_low_f REAL,
    temperature_high_f REAL,
    conditions TEXT,
    UNIQUE (location_zip, date)
);
`;
