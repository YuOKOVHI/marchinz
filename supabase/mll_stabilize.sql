-- MarchinZ MLL stabilization SQL
-- Run this once in Supabase SQL Editor.

begin;

create extension if not exists pgcrypto;

create table if not exists public.mll_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'ユーザー',
  avatar_url text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.mll_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  event_date date not null,
  venue text not null default '',
  role text not null check (role in ('watch', 'perform', 'team_staff', 'ops', 'staff')),
  role_label text not null default '',
  note text not null default '',
  ticket_url text not null default '',
  official_url text not null default '',
  creator_name text not null default '',
  creator_avatar text not null default '',
  created_at timestamptz not null default now()
);

alter table public.mll_profiles
  add column if not exists display_name text not null default 'ユーザー',
  add column if not exists avatar_url text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.mll_logs
  add column if not exists ticket_url text not null default '',
  add column if not exists official_url text not null default '',
  add column if not exists creator_name text not null default '',
  add column if not exists creator_avatar text not null default '',
  add column if not exists role_label text not null default '',
  add column if not exists note text not null default '';

create index if not exists idx_mll_logs_event_date on public.mll_logs(event_date);
create index if not exists idx_mll_logs_user_id on public.mll_logs(user_id);
create index if not exists idx_mll_logs_created_at on public.mll_logs(created_at desc);

alter table public.mll_profiles enable row level security;
alter table public.mll_logs enable row level security;

drop policy if exists "mll_profiles_select_all_authed" on public.mll_profiles;
create policy "mll_profiles_select_all_authed"
on public.mll_profiles
for select
to authenticated
using (true);

drop policy if exists "mll_profiles_update_own" on public.mll_profiles;
create policy "mll_profiles_update_own"
on public.mll_profiles
for all
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "mll_logs_select_all_authed" on public.mll_logs;
create policy "mll_logs_select_all_authed"
on public.mll_logs
for select
to authenticated
using (true);

drop policy if exists "mll_logs_insert_own" on public.mll_logs;
create policy "mll_logs_insert_own"
on public.mll_logs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "mll_logs_update_delete_own" on public.mll_logs;
create policy "mll_logs_update_delete_own"
on public.mll_logs
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
