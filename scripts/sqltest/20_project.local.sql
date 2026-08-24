-- 로컬 검증 전용 — hd-project09 (운영 실행 금지)
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','authenticator'))
     or exists (select 1 from pg_namespace where nspname='graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] 비율 계산 · 값 정합 제약 · 시트 간 불일치'; end $t$;

do $t$
declare v_id bigint; v_r boolean;
begin
  perform public._assert_eq(public.rate(25, 100), 25.00::numeric, '25/100 = 25%');
  -- 분모 0 을 0% 로 표시하면 "성과가 나빴다"로 읽힌다
  perform public._assert(public.rate(0, 0) is null, '분모 0 이면 null (0% 가 아니다)');

  insert into public.campaign (brand, period, name, sent, delivered, opens, clicks, unsubs)
  values ('HYUNDAI','2026-08','8월 뉴스레터', 10000, 9500, 2850, 570, 19)
  on conflict (brand, period, name) do update set sent = excluded.sent
  returning id into v_id;

  perform public._assert_eq((select delivery_rate from public.campaign_view where id=v_id), 95.00::numeric, '도달율 95%');
  perform public._assert_eq((select open_rate     from public.campaign_view where id=v_id), 30.00::numeric, '오픈율은 도달 기준 30%');
  perform public._assert_eq((select click_rate    from public.campaign_view where id=v_id),  6.00::numeric, '클릭율 6%');
  perform public._assert_eq((select click_to_open_rate from public.campaign_view where id=v_id), 20.00::numeric, 'CTOR = 570/2850 = 20%');

  -- 발송수를 고치면 비율이 따라온다. 따로 저장했다면 여기서 어긋난다.
  update public.campaign set sent = 19000 where id=v_id;
  perform public._assert_eq((select delivery_rate from public.campaign_view where id=v_id), 50.00::numeric,
    '발송수를 고치면 도달율이 자동으로 따라온다');
  update public.campaign set sent = 10000 where id=v_id;

  -- 엑셀 열을 잘못 맞추면 실제로 이런 값이 들어온다
  v_r := false;
  begin
    insert into public.campaign (brand, period, name, sent, delivered)
    values ('HYUNDAI','2026-08','잘못된행', 100, 200);
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '도달이 발송보다 많으면 check 제약이 막는다');

  v_r := false;
  begin
    insert into public.campaign (brand, period, name, sent, delivered, opens)
    values ('HYUNDAI','2026-08','잘못된행2', 100, 100, 200);
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '오픈이 도달보다 많으면 막는다 (오픈율 100% 초과 방지)');

  v_r := false;
  begin
    insert into public.campaign (brand, period, name) values ('KIA','2026-08','타사');
  exception when check_violation then v_r := true;
  end;
  perform public._assert(v_r, '정의되지 않은 브랜드는 check 제약이 막는다');

  -- 지역 통계와 캠페인 합계가 어긋나면 드러나야 한다
  insert into public.region_stat (campaign_id, region, sent, opens, clicks)
  values (v_id,'유럽', 4000, 1200, 240), (v_id,'북미', 3000, 900, 180)
  on conflict (campaign_id, region) do nothing;

  perform public._assert_eq((select open_rate from public.region_view where campaign_id=v_id and region='유럽'),
    30.00::numeric, '지역별 오픈율');
  perform public._assert_eq((select diff from public.region_mismatch where id=v_id), 3000::bigint,
    '지역 합계(7,000)와 캠페인 발송(10,000) 차이 3,000 이 드러난다');

  insert into public.region_stat (campaign_id, region, sent, opens)
  values (v_id,'아시아', 3000, 750) on conflict (campaign_id, region) do nothing;
  perform public._assert_eq((select count(*) from public.region_mismatch where id=v_id), 0::bigint,
    '지역 합계가 맞으면 불일치 목록에서 빠진다');

  perform public._assert_eq((select open_rate from public.monthly_trend where brand='HYUNDAI' and period='2026-08'),
    30.00::numeric, '월별 추이에도 오픈율이 잡힌다');

  -- 캠페인을 지우면 부속 자료도 함께
  delete from public.campaign where id=v_id;
  perform public._assert_eq((select count(*) from public.region_stat where campaign_id=v_id), 0::bigint,
    '캠페인을 지우면 지역 통계도 함께 지워진다');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
