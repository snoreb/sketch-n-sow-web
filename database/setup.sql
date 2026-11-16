begin;

create table if not exists public.sketch_n_sow_drawings (
    garden_id text not null,
    id text not null,
    sketch jsonb not null,
    created_at timestamptz not null default now(),
    primary key (garden_id, id),
    check (length(garden_id) between 1 and 80),
    check (length(id) between 1 and 160),
    check (jsonb_typeof(sketch) = 'object' and sketch ? 'id' and sketch->>'id' = id)
);

alter table public.sketch_n_sow_drawings enable row level security;
revoke all on public.sketch_n_sow_drawings from public, anon, authenticated;
grant select, insert, update on public.sketch_n_sow_drawings to service_role;

commit;where
