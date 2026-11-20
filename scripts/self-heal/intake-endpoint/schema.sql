-- Gente self-healing intake. Apply once to the Supabase project that holds tabmate_support.
-- The app never talks to Supabase directly: it posts to /api/gente-diagnostics on the website,
-- which inserts with the publishable key. Row level security lets that key insert and nothing else;
-- the pipeline reads with the service key, in CI only.

create table if not exists public.gente_diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  version text not null,
  platform text not null,
  codes text[] not null default '{}',
  signatures text[] not null default '{}',
  bundle jsonb not null
);
create index if not exists gente_diagnostics_created on public.gente_diagnostics (created_at desc);
create index if not exists gente_diagnostics_signatures on public.gente_diagnostics using gin (signatures);

create table if not exists public.gente_health (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  version text not null,
  channel text not null,
  platform text not null,
  event text not null check (event in ('launch', 'crash', 'setup_ok', 'setup_fail')),
  install_id uuid not null
);
create index if not exists gente_health_version on public.gente_health (version, event);

alter table public.gente_diagnostics enable row level security;
alter table public.gente_health enable row level security;
drop policy if exists "website inserts reports" on public.gente_diagnostics;
create policy "website inserts reports" on public.gente_diagnostics for insert to anon with check (true);
drop policy if exists "website inserts health" on public.gente_health;
create policy "website inserts health" on public.gente_health for insert to anon with check (true);

-- What the staged rollout reads: per version, distinct installs per event (one install that
-- crashes ten times counts once, so one broken computer cannot roll back a release by itself).
create or replace view public.gente_version_metrics as
select
  version,
  count(distinct install_id) filter (where event = 'launch') as launches,
  count(distinct install_id) filter (where event = 'crash') as crashes,
  count(distinct install_id) filter (where event = 'setup_ok') as setup_ok,
  count(distinct install_id) filter (where event = 'setup_fail') as setup_fail
from public.gente_health
group by version;
revoke all on public.gente_version_metrics from anon, authenticated;
