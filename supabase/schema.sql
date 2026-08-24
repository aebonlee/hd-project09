-- ============================================================================
-- hd-project09 — AMPS 뉴스레터 결과보고 대시보드
-- Supabase(Postgres) 운영 스키마 + RLS · 재실행 안전
--
--  이 스키마는 **수강생 본인의 Supabase 프로젝트**에 올리는 것을 전제로 합니다.
--  프로젝트가 본인 것이라 테이블 이름에 접두사를 붙이지 않았습니다.
--  (여러 앱을 한 프로젝트에 몰아 쓸 계획이면 이름 충돌을 먼저 확인하세요.)
--
--  이 스키마의 요점은 **비율을 저장하지 않는 것**입니다.
--  오픈율·클릭율을 따로 저장하면 발송수를 고치는 순간 셋이 어긋나는데,
--  그 어긋남은 보고서에만 조용히 나타납니다. 전부 계산으로 둡니다.
-- ============================================================================

create table if not exists public.campaign (
  id          bigint generated always as identity primary key,
  brand       text not null check (brand in ('HYUNDAI','DEVELON','ALL')),
  period      text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  name        text not null,
  sent        int not null default 0 check (sent >= 0),
  delivered   int not null default 0 check (delivered >= 0),
  opens       int not null default 0 check (opens >= 0),
  clicks      int not null default 0 check (clicks >= 0),
  unsubs      int not null default 0 check (unsubs >= 0),
  bounces     int not null default 0 check (bounces >= 0),
  -- 엑셀에서 열을 잘못 맞추면 실제로 이런 값이 들어온다.
  -- 도달이 발송보다 많거나, 오픈이 도달보다 많으면 오픈율이 100%를 넘는다.
  constraint campaign_delivered_le_sent check (delivered <= sent),
  constraint campaign_opens_le_delivered check (opens <= delivered),
  constraint campaign_clicks_le_opens check (clicks <= opens),
  updated_at  timestamptz not null default now(),
  -- ⚠ 프런트 upsert 는 onConflict 를 이 조합으로 지정할 것.
  constraint campaign_uniq unique (brand, period, name)
);
create index if not exists campaign_period_idx on public.campaign (period desc);

create table if not exists public.region_stat (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null references public.campaign(id) on delete cascade,
  region      text not null,
  country     text,
  sent        int not null default 0 check (sent >= 0),
  opens       int not null default 0 check (opens >= 0),
  clicks      int not null default 0 check (clicks >= 0),
  constraint region_opens_le_sent check (opens <= sent),
  constraint region_uniq unique (campaign_id, region)
);

create table if not exists public.link_stat (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null references public.campaign(id) on delete cascade,
  label       text not null,
  url         text,
  clicks      int not null default 0 check (clicks >= 0),
  constraint link_uniq unique (campaign_id, label)
);

create table if not exists public.analysis (
  id          bigint generated always as identity primary key,
  campaign_id bigint not null references public.campaign(id) on delete cascade,
  body        text not null,
  source      text not null default 'rule' check (source in ('rule','llm','manual')),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  constraint analysis_one unique (campaign_id)
);

create table if not exists public.log (
  id        bigint generated always as identity primary key,
  ran_at    timestamptz not null default now(),
  kind      text not null,
  detail    text,
  processed int not null default 0,
  failed    int not null default 0,
  actor     uuid default auth.uid()
);
create index if not exists log_ran_at_idx on public.log (ran_at desc);

create table if not exists public.admin (
  user_id uuid primary key, email text, created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 함수
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.admin a where a.user_id = auth.uid());
$fn$;

-- 분모가 0 이면 0% 가 아니라 null 이다. 0% 로 표시하면 "성과가 나빴다"로 읽힌다.
create or replace function public.rate(p_part numeric, p_whole numeric)
returns numeric language sql immutable set search_path = public as $fn$
  select case when coalesce(p_whole, 0) = 0 then null
              else round(p_part * 100.0 / p_whole, 2) end;
$fn$;

create or replace function public.touch()
returns trigger language plpgsql set search_path = public as $fn$
begin new.updated_at := now(); return new; end;
$fn$;

drop trigger if exists campaign_touch on public.campaign;
create trigger campaign_touch before update on public.campaign
  for each row execute function public.touch();

-- ----------------------------------------------------------------------------
-- 뷰
-- ----------------------------------------------------------------------------

create or replace view public.campaign_view as
select c.*,
       public.rate(c.delivered, c.sent)      as delivery_rate,
       public.rate(c.opens,     c.delivered) as open_rate,
       public.rate(c.clicks,    c.delivered) as click_rate,
       -- CTOR — 연 사람 중 누른 비율. 콘텐츠 품질을 보는 지표라 따로 낸다.
       public.rate(c.clicks,    c.opens)     as click_to_open_rate,
       public.rate(c.unsubs,    c.delivered) as unsub_rate,
       (select count(*) from public.region_stat r where r.campaign_id = c.id) as region_count
from public.campaign c;

create or replace view public.region_view as
select r.*, c.brand, c.period, c.name as campaign_name,
       public.rate(r.opens,  r.sent) as open_rate,
       public.rate(r.clicks, r.sent) as click_rate
from public.region_stat r
join public.campaign c on c.id = r.campaign_id;

create or replace view public.monthly_trend as
select brand, period,
       count(*)        as campaigns,
       sum(sent)       as sent,
       sum(delivered)  as delivered,
       sum(opens)      as opens,
       sum(clicks)     as clicks,
       public.rate(sum(opens),  sum(delivered)) as open_rate,
       public.rate(sum(clicks), sum(delivered)) as click_rate
from public.campaign
group by brand, period;

-- 지역 합계가 캠페인 합계와 어긋나는 경우 — 엑셀 시트 사이 불일치를 드러낸다
create or replace view public.region_mismatch as
select c.id, c.brand, c.period, c.name,
       c.sent as campaign_sent, coalesce(sum(r.sent), 0) as region_sent,
       c.sent - coalesce(sum(r.sent), 0) as diff
from public.campaign c
left join public.region_stat r on r.campaign_id = c.id
group by c.id, c.brand, c.period, c.name, c.sent
having c.sent <> coalesce(sum(r.sent), 0);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.campaign    enable row level security;
alter table public.region_stat enable row level security;
alter table public.link_stat   enable row level security;
alter table public.analysis    enable row level security;
alter table public.log         enable row level security;
alter table public.admin       enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['campaign','region_stat','link_stat','analysis']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read',   t);
    execute format('drop policy if exists %I on public.%I', t || '_write',  t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end;
$rls$;

drop policy if exists log_read  on public.log;
drop policy if exists log_write on public.log;
create policy log_read  on public.log for select to authenticated using (true);
create policy log_write on public.log for insert to authenticated with check (true);

drop policy if exists admin_read on public.admin;
create policy admin_read on public.admin for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 함수 실행 권한 (§3.7)
-- ----------------------------------------------------------------------------

revoke all on function public.is_admin()                from public, anon;
revoke all on function public.rate(numeric, numeric)    from public, anon;
revoke all on function public.touch()                   from public, anon;

grant execute on function public.is_admin()             to authenticated;
grant execute on function public.rate(numeric, numeric) to authenticated;
grant execute on function public.touch()                to authenticated;
