# My-Anime-Notebook

## Personal planning

The dashboard, weekly planner, streak history, deferred backup list, and milestones are stored locally in the browser. A weekly goal is completed when the selected number of anime are set to `Watched`; unfinished selections move to the deferred backup list when a new week begins. Episode progress remains available as secondary momentum through the `+1 episode` action.

Use **Export backup** on the dashboard to save the library and planning state as JSON. **Import backup** merges anime records by ID and restores the saved plans, deferred titles, milestones, and episode activity.

The Dashboard estimates total and watched hours from API runtimes, using 24 minutes per episode when an API does not provide a runtime. The `+1 episode` action promotes dropped titles to `Watching`; finishing the final episode promotes a Watching title to `Watched` and opens the rating and closing-notes form. Watched titles do not display a `+1 episode` action.

Discovery removes titles already present in the notebook by ID or matching title before rendering results.

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