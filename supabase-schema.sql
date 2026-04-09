create extension if not exists pgcrypto;

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount bigint not null default 0 check (amount >= 0),
  expires_at date not null,
  is_recurring boolean not null default false,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  constraint_name text;
begin
  select c.conname
  into constraint_name
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'coupons'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%amount%';

  if constraint_name is not null then
    execute format('alter table public.coupons drop constraint %I', constraint_name);
  end if;
exception when others then
  null;
end $$;

alter table public.coupons alter column amount set default 0;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coupons_set_updated_at on public.coupons;
create trigger coupons_set_updated_at
before update on public.coupons
for each row
execute function public.set_updated_at();

create table if not exists public.app_settings (
  id text primary key,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row
execute function public.set_updated_at();

alter table public.app_settings enable row level security;

drop policy if exists "public settings select" on public.app_settings;
create policy "public settings select"
on public.app_settings
for select
to public
using (true);

drop policy if exists "public settings insert" on public.app_settings;
create policy "public settings insert"
on public.app_settings
for insert
to public
with check (true);

drop policy if exists "public settings update" on public.app_settings;
create policy "public settings update"
on public.app_settings
for update
to public
using (true)
with check (true);

alter table public.coupons enable row level security;

drop policy if exists "public coupon select" on public.coupons;
create policy "public coupon select"
on public.coupons
for select
to public
using (true);

drop policy if exists "public coupon insert" on public.coupons;
create policy "public coupon insert"
on public.coupons
for insert
to public
with check (true);

drop policy if exists "public coupon update" on public.coupons;
create policy "public coupon update"
on public.coupons
for update
to public
using (true)
with check (true);

drop policy if exists "public coupon delete" on public.coupons;
create policy "public coupon delete"
on public.coupons
for delete
to public
using (true);

insert into storage.buckets (id, name, public)
values ('coupon-images', 'coupon-images', true)
on conflict (id) do nothing;

drop policy if exists "public storage select" on storage.objects;
create policy "public storage select"
on storage.objects
for select
to public
using (bucket_id = 'coupon-images');

drop policy if exists "public storage insert" on storage.objects;
create policy "public storage insert"
on storage.objects
for insert
to public
with check (bucket_id = 'coupon-images');

drop policy if exists "public storage update" on storage.objects;
create policy "public storage update"
on storage.objects
for update
to public
using (bucket_id = 'coupon-images')
with check (bucket_id = 'coupon-images');

drop policy if exists "public storage delete" on storage.objects;
create policy "public storage delete"
on storage.objects
for delete
to public
using (bucket_id = 'coupon-images');
