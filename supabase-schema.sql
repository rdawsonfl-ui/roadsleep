-- RoadSleep Database Schema
-- Run this in your Supabase SQL editor

-- Interstates
create table if not exists interstates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,  -- e.g. "I-95", "I-10"
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Exits
create table if not exists exits (
  id uuid primary key default gen_random_uuid(),
  interstate_id uuid references interstates(id) on delete cascade,
  direction text not null check (direction in ('N','S','E','W')),
  exit_label text,           -- e.g. "Exit 42"
  mile_marker numeric(6,1) not null,
  city text,
  state text,
  created_at timestamptz default now()
);

-- Hotels
create table if not exists hotels (
  id uuid primary key default gen_random_uuid(),
  exit_id uuid references exits(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  price_min integer,          -- nightly rate low
  price_max integer,          -- nightly rate high
  amenities text[] default '{}',  -- ['truck_parking','pets','24hr_checkin','wifi','pool']
  availability_badge text check (availability_badge in ('available','limited','full')),
  featured boolean default false,
  photo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table interstates enable row level security;
alter table exits enable row level security;
alter table hotels enable row level security;

-- Public read access (no auth needed for the app)
create policy "Public read interstates" on interstates for select using (true);
create policy "Public read exits" on exits for select using (true);
create policy "Public read hotels" on hotels for select using (true);

-- Admin write access (service role key used in API routes)
create policy "Admin insert interstates" on interstates for insert with check (true);
create policy "Admin update interstates" on interstates for update using (true);
create policy "Admin delete interstates" on interstates for delete using (true);

create policy "Admin insert exits" on exits for insert with check (true);
create policy "Admin update exits" on exits for update using (true);
create policy "Admin delete exits" on exits for delete using (true);

create policy "Admin insert hotels" on hotels for insert with check (true);
create policy "Admin update hotels" on hotels for update using (true);
create policy "Admin delete hotels" on hotels for delete using (true);

-- Indexes for fast mile marker searches
create index if not exists exits_interstate_direction_idx on exits(interstate_id, direction);
create index if not exists exits_mile_marker_idx on exits(mile_marker);
create index if not exists hotels_exit_id_idx on hotels(exit_id);
create index if not exists hotels_featured_idx on hotels(featured);

-- Seed some sample interstates
insert into interstates (name) values
  ('I-4'),('I-10'),('I-75'),('I-95'),('I-40'),
  ('I-80'),('I-70'),('I-20'),('I-30'),('I-85')
on conflict (name) do nothing;
