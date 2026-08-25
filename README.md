# My-Anime-Notebook

## Supabase setup

The app uses `anime_library` for shared persistence and falls back to browser storage if the table is unavailable. Run this once in the Supabase SQL Editor:

```sql
create table if not exists public.anime_library (
	id uuid primary key,
	title text not null,
	cover text default '',
	status text not null default 'Watching',
	current_episode integer not null default 0,
	total_episodes integer not null default 1,
	rating integer not null default 0,
	notes text default '',
	episode_notes jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);

alter table public.anime_library enable row level security;

create policy "anime notebook public access"
on public.anime_library
for all to anon
using (true)
with check (true);

alter table public.anime_library
add column if not exists vip boolean not null default false;

alter table public.anime_library
add column if not exists rewatch boolean not null default false;
```