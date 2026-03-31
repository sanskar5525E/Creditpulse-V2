-- ============================================================
-- CreditPulse — Supabase Database Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- CUSTOMERS table
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  name          text not null,
  phone         text not null,
  credit_limit  numeric default 30000,
  created_at    timestamptz default now()
);

-- TRANSACTIONS table
create table if not exists public.transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  customer_id   uuid references public.customers(id) on delete cascade not null,
  type          text check (type in ('payment', 'sale')) not null,
  amount        numeric not null check (amount > 0),
  created_at    timestamptz default now()
);

-- Row Level Security (RLS) — users only see their own data
alter table public.customers    enable row level security;
alter table public.transactions enable row level security;

-- Policies: customers
create policy "Users see own customers"
  on public.customers for select
  using (auth.uid() = user_id);

create policy "Users insert own customers"
  on public.customers for insert
  with check (auth.uid() = user_id);

create policy "Users delete own customers"
  on public.customers for delete
  using (auth.uid() = user_id);

create policy "Users update own customers"
  on public.customers for update
  using (auth.uid() = user_id);

-- Policies: transactions
create policy "Users see own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Users insert own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "Users delete own transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);

-- Indexes for speed
create index if not exists idx_customers_user    on public.customers(user_id);
create index if not exists idx_transactions_user on public.transactions(user_id);
create index if not exists idx_transactions_cust on public.transactions(customer_id);
