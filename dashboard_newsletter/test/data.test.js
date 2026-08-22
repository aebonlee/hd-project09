/* AMPS 뉴스레터 대시보드 — 데이터 계층 단위 테스트 (plain assert)
 * 실행: node test/data.test.js  */
'use strict';
const assert = require('assert');
const NLData = require('../js/data.js');
const NLInsights = require('../js/insights.js');
const SAMPLE = require('../js/sample-data.js');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

console.log('# 정규화');
ok('월 정규화', () => {
  assert.strictEqual(NLData.normalizeMonth('3월'), 3);
  assert.strictEqual(NLData.normalizeMonth(7), 7);
  assert.strictEqual(NLData.normalizeMonth('2025-05'), 5);
  assert.strictEqual(NLData.normalizeMonth('2025년 6월'), 6);
  assert.strictEqual(NLData.normalizeMonth('13'), null);
  assert.strictEqual(NLData.normalizeMonth(''), null);
});
ok('브랜드 정규화', () => {
  assert.strictEqual(NLData.normalizeBrand('Hyundai'), 'HYUNDAI');
  assert.strictEqual(NLData.normalizeBrand('현대'), 'HYUNDAI');
  assert.strictEqual(NLData.normalizeBrand('develon'), 'DEVELON');
  assert.strictEqual(NLData.normalizeBrand('디벨론'), 'DEVELON');
  assert.strictEqual(NLData.normalizeBrand('???'), null);
});
ok('대상/지역 정규화', () => {
  assert.strictEqual(NLData.normalizeAudience('딜러'), '딜러');
  assert.strictEqual(NLData.normalizeAudience('내부 직원'), '내부직원');
  assert.strictEqual(NLData.normalizeAudience('Dealer'), '딜러');
  assert.strictEqual(NLData.normalizeRegion('러시아'), '러시아/CIS');
  assert.strictEqual(NLData.normalizeRegion('터키/이스라엘'), '터키/이스라엘');
  assert.strictEqual(NLData.normalizeRegion('유럽'), 'CNHI');
  assert.strictEqual(NLData.normalizeRegion('화성'), null);
});
ok('숫자 정규화', () => {
  assert.strictEqual(NLData.normalizeNumber('1,234'), 1234);
  assert.strictEqual(NLData.normalizeNumber('87명'), 87);
  assert.strictEqual(NLData.normalizeNumber(''), null);
});

console.log('# 컬럼 자동 매핑');
ok('유사 컬럼명 매핑', () => {
  const { map, missing } = NLData.mapHeaders(
    ['발송월', 'Brand', '구분', '지역명', '수신자 수', '오픈 수', 'Clicks'], 'sends');
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(map.month, 0);
  assert.strictEqual(map.brand, 1);
  assert.strictEqual(map.audience, 2);
  assert.strictEqual(map.region, 3);
  assert.strictEqual(map.recipients, 4);
  assert.strictEqual(map.opens, 5);
  assert.strictEqual(map.clicks, 6);
});
ok('누락 컬럼 감지', () => {
  const { missing } = NLData.mapHeaders(['월', '브랜드', '대상', '지역'], 'sends');
  assert.ok(missing.includes('recipients') && missing.includes('opens') && missing.includes('clicks'));
});
ok('시트명 판별', () => {
  assert.strictEqual(NLData.matchSheetKind('발송실적'), 'sends');
  assert.strictEqual(NLData.matchSheetKind('Sends'), 'sends');
  assert.strictEqual(NLData.matchSheetKind('콘텐츠클릭'), 'contents');
  assert.strictEqual(NLData.matchSheetKind('독자클릭'), 'readers');
  assert.strictEqual(NLData.matchSheetKind('Sheet1'), null);
});

console.log('# 시트 파싱/검증');
ok('정상 행 파싱 + 오류 행 격리', () => {
  const aoa = [
    ['월', '브랜드', '대상', '지역', '수신자수', '오픈수', '클릭수'],
    ['3월', 'HYUNDAI', '딜러', '중남미', '249', '87', '30'],
    ['3월', 'HYUNDAI', '딜러', '외계', '10', '5', '1'],       // 지역 오류
    ['3월', 'HYUNDAI', '딜러', '중동', '10', '99', '1'],      // 오픈>수신
    [],                                                        // 빈 행 무시
  ];
  const res = NLData.parseSheet(aoa, 'sends', '발송실적');
  assert.strictEqual(res.rows.length, 1);
  assert.strictEqual(res.rows[0].recipients, 249);
  assert.strictEqual(res.errors.length, 2);
});
ok('parseWorkbook: 발송실적 필수', () => {
  const res = NLData.parseWorkbook({ Sheet1: [['a']] });
  assert.strictEqual(res.data, null);
  assert.ok(res.errors[0].includes('발송실적'));
});
ok('parseWorkbook: 샘플 데이터 왕복', () => {
  const aoa = [['월', '브랜드', '대상', '지역', '수신자수', '오픈수', '클릭수']]
    .concat(SAMPLE.sends.map(r => [r.month + '월', r.brand, r.audience, r.region, r.recipients, r.opens, r.clicks]));
  const res = NLData.parseWorkbook({ '발송실적': aoa });
  assert.strictEqual(res.errors.length, 0);
  assert.strictEqual(res.data.sends.length, SAMPLE.sends.length);
});

console.log('# 필터/집계');
ok('필터 집계 = 수작업 합계', () => {
  const f = { brand: 'HYUNDAI', months: [7], audiences: ['딜러'], regions: NLData.REGIONS };
  const rows = NLData.filterSends(SAMPLE.sends, f);
  const manual = SAMPLE.sends.filter(r => r.brand === 'HYUNDAI' && r.month === 7 && r.audience === '딜러');
  assert.strictEqual(rows.length, manual.length);
  const t = NLData.totals(rows);
  assert.strictEqual(t.recipients, manual.reduce((s, r) => s + r.recipients, 0));
  assert.strictEqual(t.opens, manual.reduce((s, r) => s + r.opens, 0));
});
ok('빈 선택 = 빈 결과', () => {
  assert.strictEqual(NLData.filterSends(SAMPLE.sends, { brand: 'ALL', months: [], audiences: ['딜러'], regions: NLData.REGIONS }).length, 0);
});
ok('오픈율 계산', () => {
  assert.strictEqual(NLData.rate(50, 200), 25);
  assert.strictEqual(NLData.rate(5, 0), 0);
  const t = NLData.totals([
    { recipients: 100, opens: 30, clicks: 10 },
    { recipients: 100, opens: 20, clicks: 5 }]);
  assert.strictEqual(t.openRate, 25);
  assert.strictEqual(t.clickRate, 7.5);
});
ok('지역별 집계는 REGIONS 순서 유지', () => {
  const arr = NLData.byRegion(NLData.filterSends(SAMPLE.sends, { brand: 'ALL', months: [3, 4, 5, 6, 7], audiences: ['내부직원', '딜러'], regions: NLData.REGIONS }));
  const order = arr.map(r => r.region);
  const expected = NLData.REGIONS.filter(r => order.includes(r));
  assert.deepStrictEqual(order, expected);
});
ok('전월 대비(momDelta)', () => {
  const rows = [
    { month: 6, brand: 'HYUNDAI', audience: '딜러', region: '중동', recipients: 100, opens: 40, clicks: 10 },
    { month: 7, brand: 'HYUNDAI', audience: '딜러', region: '중동', recipients: 100, opens: 50, clicks: 12 },
  ];
  const d = NLData.momDelta(rows, { brand: 'HYUNDAI', months: [7], audiences: ['딜러'], regions: NLData.REGIONS });
  assert.strictEqual(d.curMonth, 7);
  assert.strictEqual(d.prevMonth, 6);
  assert.strictEqual(d.cur.openRate, 50);
  assert.strictEqual(d.prev.openRate, 40);
  // 3월 선택 시 이전 월 없음 → null
  assert.strictEqual(NLData.momDelta(rows, { brand: 'HYUNDAI', months: [6], audiences: ['딜러'], regions: NLData.REGIONS }), null);
});
ok('브랜드 비교 매트릭스', () => {
  const m = NLData.brandGroupMatrix(SAMPLE.sends);
  assert.strictEqual(m.series.length, 2);
  assert.strictEqual(m.series[0].brand, 'HYUNDAI');
  assert.strictEqual(m.series[0].values.length, 3);
  const rm = NLData.brandRegionMatrix(SAMPLE.sends);
  assert.strictEqual(rm.series.length, 2);
  assert.ok(rm.regions.length > 0);
});
ok('지역×브랜드 발송량(100% 스택용)', () => {
  const vm = NLData.brandRegionVolume(SAMPLE.sends);
  assert.strictEqual(vm.series.length, 2);
  assert.deepStrictEqual(vm.regions, NLData.byRegion(SAMPLE.sends).map(r => r.region));
  // 지역별 브랜드 합계 = 지역 전체 수신자수
  vm.regions.forEach((rg, i) => {
    const sum = vm.series.reduce((s, se) => s + se.values[i], 0);
    const expected = NLData.totals(SAMPLE.sends.filter(r => r.region === rg)).recipients;
    assert.strictEqual(sum, expected, rg);
  });
});
ok('콘텐츠 순위/독자 통계', () => {
  const rank = NLData.contentRanking(SAMPLE.contents, { brand: 'HYUNDAI', months: [3, 4, 5, 6, 7] });
  assert.ok(rank.length > 1);
  for (let i = 1; i < rank.length; i++) assert.ok(rank[i - 1].clicks >= rank[i].clicks);
  const rs = NLData.readerStats(SAMPLE.readers, { brand: 'ALL', months: [3, 4, 5, 6, 7] }, 5);
  assert.strictEqual(rs.top.length, 5);
  assert.strictEqual(rs.bins.reduce((s, b) => s + b.count, 0), rs.totalReaders);
  rs.top.forEach(t => assert.ok(t.email.endsWith('@example.com'), '가짜 이메일만 허용'));
});

console.log('# 인사이트 (스모크)');
ok('인사이트 3~5개 생성', () => {
  const f = { brand: 'HYUNDAI', months: [7], audiences: ['딜러'], regions: NLData.REGIONS };
  const list = NLInsights.generateInsights({
    filtered: NLData.filterSends(SAMPLE.sends, f),
    allSends: SAMPLE.sends,
    contents: SAMPLE.contents,
    filter: f
  });
  assert.ok(list.length >= 3 && list.length <= 5, '생성 개수: ' + list.length);
  list.forEach(it => {
    assert.ok(it.title && it.body);
    assert.ok(it.body.length > 20);
  });
  const text = NLInsights.insightsToText(list);
  assert.ok(text.startsWith('01. '));
});
ok('빈 데이터 인사이트', () => {
  const list = NLInsights.generateInsights({ filtered: [], allSends: [], contents: [], filter: {} });
  assert.strictEqual(list.length, 1);
  assert.ok(list[0].body.includes('필터'));
});

console.log('\n' + passed + ' tests passed.');
