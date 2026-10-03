-- Handy Little Tools – shared list links for DobyToday, PackbyBag and ListbyAisle
-- Run once: Supabase → SQL Editor → New snippet → paste this whole file → Run.
-- Safe to run again.
--
-- In plain English:
--   * When you share a list or project, the site saves a copy here under its share code (the bit after #l= or #page=).
--   * Anyone with the link can open and change that one list – that is what sharing means. Nobody can list or
--     search the shared lists; you need the exact code. Codes are 12 random letters and numbers.
--   * The websites can only use the two functions below: save_list and get_list.

create table if not exists public.shared_lists (
  code        text primary key,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.shared_lists enable row level security;
revoke all on public.shared_lists from anon, authenticated;

-- Save (or update) the shared list with this code.
create or replace function public.save_list(code text, payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
begin
  if code is null or code !~ '^[a-z0-9]{10,14}$' then raise exception 'bad share code'; end if;
  if payload is null or octet_length(payload::text) > 1000000 then raise exception 'list too big'; end if;
  insert into public.shared_lists as s (code, payload, updated_at) values (code, payload, now())
  on conflict on constraint shared_lists_pkey do update set payload = excluded.payload, updated_at = now();
end $$;

-- The shared list with this code, or null.
create or replace function public.get_list(code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
begin
  return (select s.payload from public.shared_lists s where s.code = code);
end $$;

revoke all on function public.save_list(text, jsonb), public.get_list(text) from public;
grant execute on function public.save_list(text, jsonb), public.get_list(text) to anon, authenticated;

-- Tell the website gateway about the new functions straight away.
notify pgrst, 'reload schema';
