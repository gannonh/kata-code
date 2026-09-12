import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE routines (id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, next_due_at TEXT NOT NULL, record TEXT NOT NULL)`;
  yield* sql`CREATE INDEX routines_due ON routines(state, next_due_at)`;
  yield* sql`CREATE TABLE routine_runs (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id), occurrence_key TEXT NOT NULL,
    admitted_at INTEGER NOT NULL,
    stage TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
    owner TEXT, generation INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
    submission_consumed INTEGER NOT NULL DEFAULT 0 CHECK(submission_consumed IN (0,1)),
    thread_id TEXT NOT NULL UNIQUE, message_id TEXT NOT NULL UNIQUE, command_id TEXT NOT NULL UNIQUE,
    intent_event TEXT, event_cursor INTEGER NOT NULL DEFAULT 0, record TEXT NOT NULL,
    UNIQUE(routine_id, occurrence_key)
  )`;
  yield* sql`CREATE UNIQUE INDEX routine_active_slot ON routine_runs(routine_id) WHERE active = 1`;
  yield* sql`CREATE INDEX routine_history ON routine_runs(routine_id, admitted_at DESC, id DESC)`;
  yield* sql`CREATE TABLE routine_changes (
    cursor INTEGER PRIMARY KEY AUTOINCREMENT,
    environment_id TEXT NOT NULL,
    kind TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX routine_changes_environment ON routine_changes(environment_id, cursor)`;
  yield* sql`CREATE TABLE routine_provider_events (
    event_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    provider_turn_id TEXT NOT NULL,
    initial_message_id TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    observed_at INTEGER NOT NULL,
    UNIQUE(thread_id, provider_turn_id)
  )`;
  yield* sql`CREATE INDEX routine_provider_events_thread ON routine_provider_events(thread_id, provider_turn_id)`;
  yield* sql`CREATE INDEX routine_provider_events_initial_message ON routine_provider_events(thread_id, initial_message_id)`;
  yield* sql`CREATE TABLE routine_scheduler (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, generation INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, observed_at INTEGER NOT NULL DEFAULT 0)`;
  yield* sql`INSERT INTO routine_scheduler(id) VALUES (1)`;
  // A process registers its worker identity even while another process owns
  // the admission lease. This lets a live follower take over without being
  // mistaken for a freshly restarted server; a new process has no row yet
  // and therefore records elapsed due occurrences as downtime.
  yield* sql`CREATE TABLE routine_scheduler_workers (
    owner TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`;
  // The orchestration command path uses this singleton row to take SQLite's
  // writer lock before reading the command receipt and deciding an event.
  // That keeps two live server processes from deciding against the same stale
  // in-memory read model during a takeover.
  yield* sql`CREATE TABLE orchestration_dispatch_lock (
    id INTEGER PRIMARY KEY CHECK(id=1)
  )`;
  yield* sql`INSERT INTO orchestration_dispatch_lock(id) VALUES (1)`;
});
