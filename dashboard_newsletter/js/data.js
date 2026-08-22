/* ============================================================
 * AMPS 뉴스레터 대시보드 — 데이터 계층 (순수 함수, Node 테스트 가능)
 * 정규화 / 컬럼 자동 매핑 / 필터 / 집계 로직만 담당 (DOM 접근 없음)
 * ============================================================ */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.NLData = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 상수 ----------
  const REGIONS = ['본사', '중남미', '아프리카', '중동', '러시아/CIS', '아시아',
    '대양주', '터키/이스라엘', 'CNHI', '브라질', '인도네시아', '북미'];
  const BRANDS = ['HYUNDAI', 'DEVELON'];
  const AUDIENCES = ['내부직원', '딜러'];

  // ---------- 정규화 ----------
  function normStr(v) {
    return String(v == null ? '' : v).trim();
  }

  // 월: 3 / "3" / "3월" / "03" / "2025-03" / "2025년 3월" → 3
  function normalizeMonth(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const n = Math.round(v);
      return n >= 1 && n <= 12 ? n : null;
    }
    const s = normStr(v);
    let m = s.match(/(\d{1,2})\s*월/);            // "3월", "2025년 3월"
    if (!m) m = s.match(/^\d{4}[-./](\d{1,2})/);  // "2025-03"
    if (!m) m = s.match(/^(\d{1,2})$/);           // "3", "03"
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 12 ? n : null;
  }

  function normalizeBrand(v) {
    const s = normStr(v).toUpperCase();
    if (!s) return null;
    if (s.includes('HYUNDAI') || s.includes('현대') || s === 'H' || s === 'HCE') return 'HYUNDAI';
    if (s.includes('DEVELON') || s.includes('디벨론') || s === 'D' || s.includes('두산')) return 'DEVELON';
    return null;
  }

  function normalizeAudience(v) {
    const s = normStr(v).toLowerCase();
    if (!s) return null;
    if (s.includes('딜러') || s.includes('dealer')) return '딜러';
    if (s.includes('내부') || s.includes('직원') || s.includes('임직원') ||
        s.includes('internal') || s.includes('staff')) return '내부직원';
    return null;
  }

  const REGION_ALIASES = {
    '본사': '본사', 'hq': '본사', '한국': '본사', '국내': '본사',
    '중남미': '중남미', 'latam': '중남미', '중미': '중남미',
    '아프리카': '아프리카', 'africa': '아프리카',
    '중동': '중동', 'middleeast': '중동', 'me': '중동',
    '러시아/cis': '러시아/CIS', '러시아cis': '러시아/CIS', '러시아': '러시아/CIS', 'cis': '러시아/CIS',
    '아시아': '아시아', 'asia': '아시아', '동남아': '아시아',
    '대양주': '대양주', 'oceania': '대양주', '호주': '대양주',
    '터키/이스라엘': '터키/이스라엘', '터키이스라엘': '터키/이스라엘', '터키': '터키/이스라엘', '이스라엘': '터키/이스라엘',
    'cnhi': 'CNHI', '유럽': 'CNHI', 'europe': 'CNHI',
    '브라질': '브라질', 'brazil': '브라질',
    '인도네시아': '인도네시아', 'indonesia': '인도네시아',
    '북미': '북미', 'northamerica': '북미', 'na': '북미', '미주': '북미'
  };

  function normalizeRegion(v) {
    const s = normStr(v);
    if (!s) return null;
    if (REGIONS.indexOf(s) >= 0) return s;
    const key = s.toLowerCase().replace(/[\s()]/g, '');
    return REGION_ALIASES[key] || null;
  }

  function normalizeNumber(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const s = normStr(v).replace(/[,\s명건회원]/g, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // ---------- 컬럼(헤더) 자동 매핑 ----------
  // 유사 표기를 허용: 헤더를 소문자·공백/괄호 제거 후 별칭과 비교(완전일치 → 포함 순)
  const HEADER_ALIASES = {
    sends: {
      month:      ['월', 'month', '발송월', '기준월'],
      brand:      ['브랜드', 'brand'],
      audience:   ['대상', '내부/딜러', '내부딜러', '구분', 'audience', '타겟', 'target'],
      region:     ['지역', 'region', '지역명', '권역'],
      recipients: ['수신자수', '수신자', '수신', '발송수', '발송건수', 'recipients', 'sent', '발송'],
      opens:      ['오픈수', '오픈', 'opens', 'open', '오픈건수'],
      clicks:     ['클릭수', '클릭', 'clicks', 'click', '클릭건수']
    },
    contents: {
      month:   ['월', 'month', '발송월'],
      brand:   ['브랜드', 'brand'],
      content: ['콘텐츠명', '콘텐츠', '컨텐츠명', '컨텐츠', 'content', '제목', '기사명', 'title'],
      clicks:  ['클릭수', '클릭', 'clicks', 'click']
    },
    readers: {
      month:  ['월', 'month', '발송월'],
      brand:  ['브랜드', 'brand'],
      email:  ['이메일', '이메일주소', 'email', '메일', 'e-mail', '메일주소'],
      clicks: ['클릭수', '클릭', 'clicks', 'click']
    }
  };

  const SHEET_ALIASES = {
    sends:    ['발송실적', '발송', '발송데이터', 'sends', 'send', 'performance', '실적'],
    contents: ['콘텐츠클릭', '콘텐츠', '컨텐츠클릭', 'contents', 'content', '콘텐츠별'],
    readers:  ['독자클릭', '독자', 'readers', 'reader', '독자별', 'vip']
  };

  function normHeader(h) {
    return normStr(h).toLowerCase().replace(/[\s()\[\]_·.-]/g, '');
  }

  // 시트명 → sends/contents/readers 판별
  function matchSheetKind(name) {
    const n = normHeader(name);
    if (!n) return null;
    for (const kind of Object.keys(SHEET_ALIASES)) {
      for (const alias of SHEET_ALIASES[kind]) {
        if (n === normHeader(alias) || n.includes(normHeader(alias))) return kind;
      }
    }
    return null;
  }

  /**
   * 헤더 행 → { map:{field:colIndex}, missing:[field] }
   */
  function mapHeaders(headerRow, kind) {
    const spec = HEADER_ALIASES[kind];
    const normed = (headerRow || []).map(normHeader);
    const map = {};
    const missing = [];
    for (const field of Object.keys(spec)) {
      let idx = -1;
      // 1순위: 완전 일치
      for (const alias of spec[field]) {
        const a = normHeader(alias);
        const i = normed.indexOf(a);
        if (i >= 0 && !used(map, i)) { idx = i; break; }
      }
      // 2순위: 포함 일치
      if (idx < 0) {
        outer:
        for (const alias of spec[field]) {
          const a = normHeader(alias);
          for (let i = 0; i < normed.length; i++) {
            if (normed[i] && normed[i].includes(a) && !used(map, i)) { idx = i; break outer; }
          }
        }
      }
      if (idx >= 0) map[field] = idx; else missing.push(field);
    }
    return { map, missing };
  }

  function used(map, i) {
    return Object.keys(map).some(function (k) { return map[k] === i; });
  }

  /**
   * AOA(배열의 배열, 1행=헤더) → 정규화 레코드.
   * 반환: { rows, errors:[문자열], mapped:{field:헤더명} }
   */
  function parseSheet(aoa, kind, sheetLabel) {
    const label = sheetLabel || kind;
    const errors = [];
    if (!aoa || !aoa.length) return { rows: [], errors: [label + ' 시트가 비어 있습니다.'], mapped: {} };
    const header = aoa[0];
    const { map, missing } = mapHeaders(header, kind);
    if (missing.length) {
      return {
        rows: [], mapped: {},
        errors: [label + ' 시트에서 필수 컬럼을 찾지 못했습니다: ' + missing.map(fieldLabel).join(', ')]
      };
    }
    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const raw = aoa[r];
      if (!raw || raw.every(function (c) { return c == null || normStr(c) === ''; })) continue;
      const rowNo = r + 1;
      const month = normalizeMonth(raw[map.month]);
      const brand = normalizeBrand(raw[map.brand]);
      if (month == null) { errors.push(label + ' ' + rowNo + '행: 월 값을 인식할 수 없습니다 ("' + normStr(raw[map.month]) + '")'); continue; }
      if (brand == null) { errors.push(label + ' ' + rowNo + '행: 브랜드 값을 인식할 수 없습니다 ("' + normStr(raw[map.brand]) + '")'); continue; }

      if (kind === 'sends') {
        const audience = normalizeAudience(raw[map.audience]);
        const region = normalizeRegion(raw[map.region]);
        const recipients = normalizeNumber(raw[map.recipients]);
        const opens = normalizeNumber(raw[map.opens]);
        const clicks = normalizeNumber(raw[map.clicks]);
        if (audience == null) { errors.push(label + ' ' + rowNo + '행: 대상(내부직원/딜러) 값을 인식할 수 없습니다 ("' + normStr(raw[map.audience]) + '")'); continue; }
        if (region == null) { errors.push(label + ' ' + rowNo + '행: 지역 값을 인식할 수 없습니다 ("' + normStr(raw[map.region]) + '")'); continue; }
        if (recipients == null || recipients < 0) { errors.push(label + ' ' + rowNo + '행: 수신자수가 숫자가 아닙니다.'); continue; }
        if (opens == null || opens < 0) { errors.push(label + ' ' + rowNo + '행: 오픈수가 숫자가 아닙니다.'); continue; }
        if (opens > recipients) { errors.push(label + ' ' + rowNo + '행: 오픈수(' + opens + ')가 수신자수(' + recipients + ')보다 큽니다.'); continue; }
        rows.push({ month, brand, audience, region, recipients, opens, clicks: clicks == null ? 0 : clicks });
      } else if (kind === 'contents') {
        const content = normStr(raw[map.content]);
        const clicks = normalizeNumber(raw[map.clicks]);
        if (!content) { errors.push(label + ' ' + rowNo + '행: 콘텐츠명이 비어 있습니다.'); continue; }
        if (clicks == null || clicks < 0) { errors.push(label + ' ' + rowNo + '행: 클릭수가 숫자가 아닙니다.'); continue; }
        rows.push({ month, brand, content, clicks });
      } else { // readers
        const email = normStr(raw[map.email]);
        const clicks = normalizeNumber(raw[map.clicks]);
        if (!email || email.indexOf('@') < 0) { errors.push(label + ' ' + rowNo + '행: 이메일 형식이 아닙니다 ("' + email + '")'); continue; }
        if (clicks == null || clicks < 0) { errors.push(label + ' ' + rowNo + '행: 클릭수가 숫자가 아닙니다.'); continue; }
        rows.push({ month, brand, email, clicks });
      }
    }
    const mapped = {};
    Object.keys(map).forEach(function (f) { mapped[f] = normStr(header[map[f]]); });
    return { rows, errors, mapped };
  }

  function fieldLabel(f) {
    return ({ month: '월', brand: '브랜드', audience: '대상', region: '지역',
      recipients: '수신자수', opens: '오픈수', clicks: '클릭수',
      content: '콘텐츠명', email: '이메일' })[f] || f;
  }

  /**
   * 통합 파서: { 시트명: AOA } → { data:{sends,contents,readers}, errors, warnings, mappings }
   * 발송실적 시트는 필수, 나머지는 선택.
   */
  function parseWorkbook(sheets) {
    const found = { sends: null, contents: null, readers: null };
    const names = { sends: null, contents: null, readers: null };
    Object.keys(sheets || {}).forEach(function (name) {
      const kind = matchSheetKind(name);
      if (kind && found[kind] == null) { found[kind] = sheets[name]; names[kind] = name; }
    });
    const errors = [];
    const warnings = [];
    const mappings = {};
    if (!found.sends) {
      return { data: null, errors: ["'발송실적' 시트를 찾을 수 없습니다. (시트명: 발송실적 / Sends 등)"], warnings, mappings };
    }
    const data = { sends: [], contents: [], readers: [] };
    (['sends', 'contents', 'readers']).forEach(function (kind) {
      if (!found[kind]) {
        if (kind !== 'sends') warnings.push("'" + kindLabel(kind) + "' 시트가 없어 해당 분석은 표시되지 않습니다.");
        return;
      }
      const res = parseSheet(found[kind], kind, names[kind]);
      data[kind] = res.rows;
      mappings[kind] = res.mapped;
      res.errors.forEach(function (e) {
        // 필수 컬럼 누락은 오류, 개별 행 문제는 경고(해당 행만 제외)로 취급
        (res.rows.length === 0 && kind === 'sends' ? errors : warnings).push(e);
      });
    });
    if (data.sends.length === 0 && errors.length === 0) errors.push('발송실적 시트에 유효한 데이터 행이 없습니다.');
    return { data: errors.length ? null : data, errors, warnings, mappings };
  }

  function kindLabel(k) {
    return ({ sends: '발송실적', contents: '콘텐츠클릭', readers: '독자클릭' })[k] || k;
  }

  // ---------- 필터 ----------
  /**
   * filter: { brand:'ALL'|'HYUNDAI'|'DEVELON', months:[3..], audiences:[..], regions:[..] }
   * months/audiences/regions 가 비어있으면 "아무것도 선택 안 함" = 빈 결과.
   */
  function filterSends(rows, f) {
    f = f || {};
    return (rows || []).filter(function (r) {
      if (f.brand && f.brand !== 'ALL' && r.brand !== f.brand) return false;
      if (f.months && f.months.indexOf(r.month) < 0) return false;
      if (f.audiences && f.audiences.indexOf(r.audience) < 0) return false;
      if (f.regions && f.regions.indexOf(r.region) < 0) return false;
      return true;
    });
  }

  function filterSimple(rows, f) { // contents / readers (월·브랜드만 적용)
    f = f || {};
    return (rows || []).filter(function (r) {
      if (f.brand && f.brand !== 'ALL' && r.brand !== f.brand) return false;
      if (f.months && f.months.indexOf(r.month) < 0) return false;
      return true;
    });
  }

  // ---------- 집계 ----------
  function rate(part, whole) {
    return whole > 0 ? (part / whole) * 100 : 0;
  }

  function totals(rows) {
    let recipients = 0, opens = 0, clicks = 0;
    (rows || []).forEach(function (r) {
      recipients += r.recipients; opens += r.opens; clicks += r.clicks;
    });
    return {
      recipients, opens, clicks,
      openRate: rate(opens, recipients),
      clickRate: rate(clicks, recipients)
    };
  }

  function groupTotals(rows, keyFn) {
    const map = new Map();
    (rows || []).forEach(function (r) {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    const out = new Map();
    map.forEach(function (v, k) { out.set(k, totals(v)); });
    return out;
  }

  /** REGIONS 순서 유지, 데이터 있는 지역만 */
  function byRegion(rows) {
    const g = groupTotals(rows, function (r) { return r.region; });
    return REGIONS.filter(function (rg) { return g.has(rg); })
      .map(function (rg) { return Object.assign({ region: rg }, g.get(rg)); });
  }

  function byMonth(rows) {
    const g = groupTotals(rows, function (r) { return r.month; });
    return Array.from(g.keys()).sort(function (a, b) { return a - b; })
      .map(function (m) { return Object.assign({ month: m }, g.get(m)); });
  }

  function byAudience(rows) {
    const g = groupTotals(rows, function (r) { return r.audience; });
    return AUDIENCES.filter(function (a) { return g.has(a); })
      .map(function (a) { return Object.assign({ audience: a }, g.get(a)); });
  }

  function byBrand(rows) {
    const g = groupTotals(rows, function (r) { return r.brand; });
    return BRANDS.filter(function (b) { return g.has(b); })
      .map(function (b) { return Object.assign({ brand: b }, g.get(b)); });
  }

  /** ALL 화면용: 브랜드 × (전체/내부직원/딜러) 오픈율 */
  function brandGroupMatrix(rows) {
    const cats = ['전체', '내부직원', '딜러'];
    const out = { categories: cats, series: [] };
    BRANDS.forEach(function (b) {
      const brows = rows.filter(function (r) { return r.brand === b; });
      out.series.push({
        brand: b,
        values: cats.map(function (c) {
          const sub = c === '전체' ? brows : brows.filter(function (r) { return r.audience === c; });
          return totals(sub).openRate;
        })
      });
    });
    return out;
  }

  /** ALL 화면용: 지역 × 브랜드 오픈율 */
  function brandRegionMatrix(rows) {
    const regions = REGIONS.filter(function (rg) {
      return rows.some(function (r) { return r.region === rg; });
    });
    return {
      regions,
      series: BRANDS.map(function (b) {
        return {
          brand: b,
          values: regions.map(function (rg) {
            return totals(rows.filter(function (r) { return r.brand === b && r.region === rg; })).openRate;
          })
        };
      })
    };
  }

  /**
   * 전월 대비 증감: 선택 필터의 최근 월 vs 그 직전 월(데이터 존재 기준).
   * 반환 { curMonth, prevMonth, cur:{...}, prev:{...} } — 비교 불가 시 null.
   */
  function momDelta(allRows, f) {
    const base = filterSends(allRows, { brand: f.brand, audiences: f.audiences, regions: f.regions });
    const monthsAvail = Array.from(new Set(base.map(function (r) { return r.month; }))).sort(function (a, b) { return a - b; });
    const selected = (f.months || monthsAvail).filter(function (m) { return monthsAvail.indexOf(m) >= 0; });
    if (!selected.length) return null;
    const curMonth = Math.max.apply(null, selected);
    const prevCandidates = monthsAvail.filter(function (m) { return m < curMonth; });
    if (!prevCandidates.length) return null;
    const prevMonth = Math.max.apply(null, prevCandidates);
    return {
      curMonth, prevMonth,
      cur: totals(base.filter(function (r) { return r.month === curMonth; })),
      prev: totals(base.filter(function (r) { return r.month === prevMonth; }))
    };
  }

  /** 콘텐츠 선호도 순위 (클릭수 합계 내림차순) */
  function contentRanking(contents, f, limit) {
    const map = new Map();
    filterSimple(contents, f).forEach(function (r) {
      map.set(r.content, (map.get(r.content) || 0) + r.clicks);
    });
    const arr = Array.from(map.entries())
      .map(function (e) { return { content: e[0], clicks: e[1] }; })
      .sort(function (a, b) { return b.clicks - a.clicks; });
    return limit ? arr.slice(0, limit) : arr;
  }

  /** 독자별 클릭: Top N + 빈도 구간 분포 */
  function readerStats(readers, f, topN) {
    const map = new Map();
    filterSimple(readers, f).forEach(function (r) {
      map.set(r.email, (map.get(r.email) || 0) + r.clicks);
    });
    const arr = Array.from(map.entries())
      .map(function (e) { return { email: e[0], clicks: e[1] }; })
      .sort(function (a, b) { return b.clicks - a.clicks; });
    const bins = [
      { label: '1~2회', min: 1, max: 2, count: 0 },
      { label: '3~5회', min: 3, max: 5, count: 0 },
      { label: '6~10회', min: 6, max: 10, count: 0 },
      { label: '10회 초과', min: 11, max: Infinity, count: 0 }
    ];
    arr.forEach(function (r) {
      for (const b of bins) { if (r.clicks >= b.min && r.clicks <= b.max) { b.count++; break; } }
    });
    return { top: arr.slice(0, topN || 5), bins, totalReaders: arr.length, totalClicks: arr.reduce(function (s, r) { return s + r.clicks; }, 0) };
  }

  // ---------- 내보내기용 ----------
  /** 필터 결과를 업로드 양식과 동일한 AOA 로 변환 */
  function sendsToAoa(rows) {
    const aoa = [['월', '브랜드', '대상', '지역', '수신자수', '오픈수', '클릭수', '오픈율(%)']];
    (rows || []).forEach(function (r) {
      aoa.push([r.month + '월', r.brand, r.audience, r.region, r.recipients, r.opens, r.clicks,
        Math.round(rate(r.opens, r.recipients) * 10) / 10]);
    });
    return aoa;
  }

  return {
    REGIONS, BRANDS, AUDIENCES,
    normalizeMonth, normalizeBrand, normalizeAudience, normalizeRegion, normalizeNumber,
    matchSheetKind, mapHeaders, parseSheet, parseWorkbook,
    filterSends, filterSimple,
    rate, totals, byRegion, byMonth, byAudience, byBrand,
    brandGroupMatrix, brandRegionMatrix, momDelta,
    contentRanking, readerStats, sendsToAoa
  };
});
