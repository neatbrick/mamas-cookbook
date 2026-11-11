-- Run this in Supabase Dashboard > SQL Editor.
create table if not exists public.recipes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.recipes enable row level security;

drop policy if exists "Users can read their own recipes" on public.recipes;
create policy "Users can read their own recipes" on public.recipes
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own recipes" on public.recipes;
create policy "Users can insert their own recipes" on public.recipes
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own recipes" on public.recipes;
create policy "Users can update their own recipes" on public.recipes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own recipes" on public.recipes;
create policy "Users can delete their own recipes" on public.recipes
  for delete using (auth.uid() = user_id);
