/* ============================================================
 * AMPS 뉴스레터 결과보고 대시보드 — UI 계층
 * 필터/테마/차트/지도/업로드/내보내기 (데이터 로직은 js/data.js)
 * ============================================================ */
(function () {
  'use strict';

  const $ = function (sel) { return document.querySelector(sel); };
  const NL = window.NLData;
  const INS = window.NLInsights;

  // ---------- 세계지도 지역 좌표 (viewBox 1000x470 기준) ----------
  const REGION_POS = {
    '본사':        { x: 862, y: 142 },
    '북미':        { x: 218, y: 128 },
    '중남미':      { x: 262, y: 224 },
    '브라질':      { x: 360, y: 295 },
    '아프리카':    { x: 545, y: 248 },
    '중동':        { x: 652, y: 194 },
    '터키/이스라엘': { x: 593, y: 136 },
    '러시아/CIS':  { x: 726, y: 88 },
    '아시아':      { x: 782, y: 205 },
    '인도네시아':  { x: 812, y: 262 },
    '대양주':      { x: 878, y: 336 },
    'CNHI':        { x: 512, y: 108 }   // 유럽 표기
  };

  const BRAND_TITLES = {
    ALL: 'AMPS 통합 뉴스레터 대시보드',
    HYUNDAI: 'HYUNDAI 뉴스레터 대시보드',
    DEVELON: 'DEVELON 뉴스레터 대시보드'
  };

  // ---------- 상태 ----------
  const state = {
    data: JSON.parse(JSON.stringify(window.SAMPLE_DATA || { sends: [], contents: [], readers: [] })),
    dataLabel: '샘플 데이터',
    brand: 'HYUNDAI',
    months: new Set(),
    audiences: new Set(NL.AUDIENCES),
    regions: new Set(NL.REGIONS),
    userMode: null,        // null = 브랜드 기본 명도
    regionView: 'map',     // 'map' | 'gauge'
    comboSend: false
  };

  const charts = {};       // Chart.js 인스턴스 저장

  // ---------- 유틸 ----------
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  /** #rrggbb → rgba(r,g,b,a) — 영역/스택 채움색용 */
  function alpha(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  /** 엑셀 등 외부 유래 문자열의 HTML 이스케이프 (innerHTML 삽입용) */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function pct(v, digits) {
    const d = digits == null ? 1 : digits;
    return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d) + '%';
  }
  function monthsLabel(months) {
    if (!months.length) return '선택된 월 없음';
    const s = months.slice().sort(function (a, b) { return a - b; });
    const contiguous = s.every(function (m, i) { return i === 0 || m === s[i - 1] + 1; });
    if (s.length === 1) return s[0] + '월';
    return contiguous ? s[0] + '~' + s[s.length - 1] + '월' : s.join(',') + '월';
  }
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.style.display = 'none'; }, 2600);
  }
  function getFilter() {
    return {
      brand: state.brand,
      months: Array.from(state.months).sort(function (a, b) { return a - b; }),
      audiences: Array.from(state.audiences),
      regions: Array.from(state.regions)
    };
  }
  function effectiveMode() {
    return state.userMode || (state.brand === 'DEVELON' ? 'dark' : 'light');
  }

  // ---------- 테마 ----------
  function applyTheme() {
    const root = document.documentElement;
    root.dataset.brand = state.brand;
    root.dataset.mode = effectiveMode();
    $('#pageTitle').textContent = BRAND_TITLES[state.brand];
    $('#menuThemeLabel').textContent = effectiveMode() === 'light' ? 'Dark 테마' : 'Light 테마';
  }

  // ---------- 필터 UI ----------
  function checkItem(name, value, checked, label) {
    const lb = document.createElement('label');
    lb.className = 'check-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = value;
    input.checked = checked;
    lb.appendChild(input);
    lb.appendChild(document.createTextNode(label));
    return lb;
  }

  function buildMonthChecks() {
    const box = $('#monthChecks');
    box.innerHTML = '';
    const months = Array.from(new Set(state.data.sends.map(function (r) { return r.month; })))
      .sort(function (a, b) { return a - b; });
    state.months = new Set(months); // 기본 전체 선택
    months.forEach(function (m) {
      const item = checkItem('month', String(m), true, m + '월');
      item.querySelector('input').addEventListener('change', function (e) {
        const v = Number(e.target.value);
        if (e.target.checked) state.months.add(v); else state.months.delete(v);
        renderAll();
      });
      box.appendChild(item);
    });
  }

  function buildStaticChecks() {
    const aBox = $('#audienceChecks');
    NL.AUDIENCES.forEach(function (a) {
      const item = checkItem('audience', a, true, a);
      item.querySelector('input').addEventListener('change', function (e) {
        if (e.target.checked) state.audiences.add(a); else state.audiences.delete(a);
        renderAll();
      });
      aBox.appendChild(item);
    });
    const rBox = $('#regionChecks');
    NL.REGIONS.forEach(function (r) {
      const item = checkItem('region', r, true, r);
      item.querySelector('input').addEventListener('change', function (e) {
        if (e.target.checked) state.regions.add(r); else state.regions.delete(r);
        renderAll();
      });
      rBox.appendChild(item);
    });
    // 전체선택/해제
    document.querySelectorAll('.check-actions button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const all = btn.dataset.mode === 'all';
        const target = btn.dataset.target;
        const boxId = target === 'month' ? '#monthChecks' : '#regionChecks';
        document.querySelectorAll(boxId + ' input').forEach(function (input) {
          input.checked = all;
          const v = target === 'month' ? Number(input.value) : input.value;
          const set = target === 'month' ? state.months : state.regions;
          if (all) set.add(v); else set.delete(v);
        });
        renderAll();
      });
    });
  }

  // ---------- 차트 공통 ----------
  function baseChartDefaults() {
    Chart.defaults.font.family = cssVar('--font-body') || "'Noto Sans KR', sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = cssVar('--text-2');
    Chart.defaults.borderColor = cssVar('--grid');
  }
  function makeChart(id, cfg) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    charts[id] = new Chart(canvas.getContext('2d'), cfg);
    return charts[id];
  }
  function pctTicks() {
    return { callback: function (v) { return v + '%'; } };
  }
  const BAR_OPTS = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 34 };

  // ---------- 렌더링 ----------
  function renderAll() {
    baseChartDefaults();
    const f = getFilter();
    const filtered = NL.filterSends(state.data.sends, f);
    renderKpis(filtered, f);
    renderRegion(filtered, f);
    renderGroupTable(filtered, f);
    renderInsights(filtered, f);
    renderAllSection(f);
    renderClicks(f);
    renderTrend(f);
    renderVolume(f);
  }

  // KPI 카드 4개 (+ 전월 대비 증감)
  function renderKpis(filtered, f) {
    const t = NL.totals(filtered);
    const mom = NL.momDelta(state.data.sends, f);

    function delta(cur, prev, isRate) {
      if (!mom || prev == null) return '<span class="k-delta flat">전월 비교 불가</span>';
      const diff = cur - prev;
      const flat = Math.abs(diff) < (isRate ? 0.05 : 0.5);
      const cls = flat ? 'flat' : diff > 0 ? 'up' : 'down';
      const arrow = flat ? '&#8212;' : diff > 0 ? '&#9650;' : '&#9660;';
      const val = isRate ? Math.abs(Math.round(diff * 10) / 10).toFixed(1) + '%p' : fmt(Math.abs(Math.round(diff)));
      return '<span class="k-delta ' + cls + '">' + arrow + ' ' + val + ' <small>(' + mom.prevMonth + '월 대비)</small></span>';
    }

    const cards = [
      { label: '총 발송 건수 (Total Sent)', value: fmt(t.recipients), desc: '선택 기간/타겟 대상 누적 수신자',
        delta: delta(mom && mom.cur.recipients, mom && mom.prev.recipients, false) },
      { label: '총 오픈 건수 (Total Opens)', value: fmt(t.opens), desc: '메일을 실제로 확인한 고유 반응 수',
        delta: delta(mom && mom.cur.opens, mom && mom.prev.opens, false) },
      { label: '평균 오픈율 (Avg Open Rate)', value: pct(t.openRate), desc: '발송 대비 평균 활성화 비율',
        delta: delta(mom && mom.cur.openRate, mom && mom.prev.openRate, true) },
      { label: '총 클릭 (Total Clicks)', value: fmt(t.clicks) + '<small> (' + pct(t.clickRate) + ')</small>', desc: '본문 링크 클릭 수 (클릭률)',
        delta: delta(mom && mom.cur.clicks, mom && mom.prev.clicks, false) }
    ];
    $('#kpiRow').innerHTML = cards.map(function (c) {
      return '<div class="kpi"><div class="k-label">' + c.label + '</div>' +
        '<div class="k-value">' + c.value + '</div>' +
        '<div class="k-desc">' + c.desc + '</div>' + c.delta + '</div>';
    }).join('');
  }

  // 지역별: 세계지도 or 도넛 게이지
  function renderRegion(filtered, f) {
    $('#regionTitle').textContent = '지역별 뉴스레터 오픈 현황 (' + monthsLabel(f.months) + ')';
    $('#mapView').style.display = state.regionView === 'map' ? '' : 'none';
    $('#gaugeView').style.display = state.regionView === 'gauge' ? '' : 'none';
    $('#tabMap').classList.toggle('active', state.regionView === 'map');
    $('#tabGauge').classList.toggle('active', state.regionView === 'gauge');
    const byRegion = NL.byRegion(filtered);
    if (state.regionView === 'map') renderMap(byRegion);
    else renderGauges(byRegion);
  }

  function renderMap(byRegion) {
    const g = document.getElementById('mapBubbles');
    g.innerHTML = '';
    const color = cssVar('--c-main');
    const maxRecv = Math.max.apply(null, byRegion.map(function (r) { return r.recipients; }).concat([1]));
    const tooltip = $('#mapTooltip');

    byRegion.forEach(function (r) {
      const pos = REGION_POS[r.region];
      if (!pos) return;
      const radius = 9 + Math.sqrt(r.recipients / maxRecv) * 17;      // 크기 = 수신자 수
      const opacity = 0.22 + Math.min(1, r.openRate / 50) * 0.68;     // 농도 = 오픈율
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', 'map-bubble');
      grp.innerHTML =
        '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius.toFixed(1) + '" fill="' + color +
          '" fill-opacity="' + opacity.toFixed(2) + '" stroke="' + color + '"></circle>' +
        '<text class="b-name" x="' + pos.x + '" y="' + (pos.y + radius + 13) + '" text-anchor="middle">' + r.region + '</text>' +
        '<text class="b-rate" x="' + pos.x + '" y="' + (pos.y + radius + 25) + '" text-anchor="middle" fill="' + color + '">' + pct(r.openRate, 0) + '</text>';
      grp.addEventListener('mousemove', function (ev) {
        tooltip.style.display = 'block';
        tooltip.style.left = Math.min(window.innerWidth - 190, ev.clientX + 14) + 'px';
        tooltip.style.top = (ev.clientY + 14) + 'px';
        tooltip.innerHTML = '<b>' + r.region + '</b><br>' +
          '수신 ' + fmt(r.recipients) + '명 · 오픈 ' + fmt(r.opens) + '명 · 클릭 ' + fmt(r.clicks) + '회<br>' +
          '오픈율 <span class="tt-rate">' + pct(r.openRate) + '</span> · 클릭률 ' + pct(r.clickRate);
      });
      grp.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; });
      g.appendChild(grp);
    });
    if (!byRegion.length) {
      g.innerHTML = '<text x="500" y="240" text-anchor="middle" fill="' + cssVar('--muted') + '" font-size="15">현재 필터에 해당하는 지역 데이터가 없습니다.</text>';
    }
    renderMapRank(byRegion);
  }

  // 지도 아래 지역별 오픈율 순위 (지도 데이터의 텍스트 대안)
  function renderMapRank(byRegion) {
    const box = $('#mapRankList');
    if (!byRegion.length) { box.innerHTML = ''; return; }
    const sorted = byRegion.slice().sort(function (a, b) { return b.openRate - a.openRate; });
    const max = Math.max.apply(null, sorted.map(function (r) { return r.openRate; }).concat([1]));
    box.innerHTML = sorted.map(function (r) {
      return '<div class="rank-row" title="' + r.region + ' 오픈 ' + fmt(r.opens) + '/' + fmt(r.recipients) + '명">' +
        '<span class="r-name">' + r.region + '</span>' +
        '<span class="r-bar"><span class="r-fill" style="width:' + Math.round(r.openRate / max * 100) + '%"></span></span>' +
        '<span class="r-val">' + pct(r.openRate, 0) + '</span></div>';
    }).join('');
  }

  function renderGauges(byRegion) {
    const box = $('#gaugeView');
    if (!byRegion.length) {
      box.innerHTML = '<div class="empty-note" style="grid-column:1/-1">현재 필터에 해당하는 지역 데이터가 없습니다.</div>';
      return;
    }
    box.innerHTML = byRegion.map(function (r) {
      const val = Math.max(0, Math.min(100, r.openRate));
      return '<div class="gauge">' +
        '<svg viewBox="0 0 42 42" role="img" aria-label="' + r.region + ' 오픈율 ' + pct(r.openRate) + '">' +
          '<circle class="g-track" cx="21" cy="21" r="15.9" stroke-width="3.6"></circle>' +
          '<circle class="g-arc" cx="21" cy="21" r="15.9" stroke-width="3.6" stroke-dasharray="' + val.toFixed(1) + ' 100" transform="rotate(-90 21 21)"></circle>' +
          '<text class="g-num" x="21" y="25" text-anchor="middle">' + Math.round(val) + '%</text>' +
        '</svg>' +
        '<div class="g-name">' + r.region + '</div>' +
        '<div class="g-sub">(' + fmt(r.opens) + '/' + fmt(r.recipients) + '명)</div>' +
      '</div>';
    }).join('');
  }

  // 그룹별 성과 표
  function renderGroupTable(filtered, f) {
    $('#groupTableTitle').textContent = '그룹별 성과 상세 (' + monthsLabel(f.months) + ' 기준)';
    $('#groupTableHint').textContent = f.brand === 'ALL' ? '브랜드 + 대상 그룹' : '';
    const rows = [];
    if (f.brand === 'ALL') {
      NL.byBrand(filtered).forEach(function (b) {
        rows.push({ name: b.brand === 'HYUNDAI' ? 'Hyundai' : 'Develon', t: b });
      });
    }
    NL.byAudience(filtered).forEach(function (a) {
      rows.push({ name: a.audience === '딜러' ? '딜러 (Dealer)' : '내부직원 (Internal)', t: a });
    });
    const total = NL.totals(filtered);
    let html = '<thead><tr><th>구분</th><th>수신</th><th>오픈</th><th>오픈율</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + r.name + '</td><td>' + fmt(r.t.recipients) + '명</td><td>' + fmt(r.t.opens) + '명</td><td class="rate">' + pct(r.t.openRate, 0) + '</td></tr>';
    });
    html += '<tr class="total"><td>합계 (Total)</td><td>' + fmt(total.recipients) + '명</td><td>' + fmt(total.opens) + '명</td><td class="rate">' + pct(total.openRate, 0) + '</td></tr></tbody>';
    $('#groupTable').innerHTML = html;
  }

  // 결과 분석 (규칙 기반 자동 기입)
  let lastInsights = [];
  function renderInsights(filtered, f) {
    lastInsights = INS.generateInsights({
      filtered: filtered,
      allSends: state.data.sends,
      contents: state.data.contents,
      filter: f
    });
    $('#insightList').innerHTML = lastInsights.map(function (it, i) {
      return '<div class="insight"><h4><span class="no">' + String(i + 1).padStart(2, '0') + '.</span>' + esc(it.title) + '</h4><p>' + esc(it.body) + '</p></div>';
    }).join('');
  }

  // ALL 화면: 브랜드 비교 grouped bar 2종
  function renderAllSection(f) {
    const show = f.brand === 'ALL';
    $('#allSection').style.display = show ? '' : 'none';
    if (!show) {
      ['brandGroupChart', 'brandRegionChart', 'brandShareChart'].forEach(function (id) {
        if (charts[id]) { charts[id].destroy(); delete charts[id]; }
      });
      return;
    }
    // 브랜드 필터 제외한 나머지 필터 적용
    const rows = NL.filterSends(state.data.sends, { brand: 'ALL', months: f.months, audiences: f.audiences, regions: f.regions });
    const cH = cssVar('--c-hyundai');
    const cD = cssVar('--c-develon');

    const gm = NL.brandGroupMatrix(rows);
    makeChart('brandGroupChart', {
      type: 'bar',
      data: {
        labels: gm.categories,
        datasets: gm.series.map(function (s) {
          return Object.assign({ label: s.brand, data: s.values.map(function (v) { return Math.round(v * 10) / 10; }),
            backgroundColor: s.brand === 'HYUNDAI' ? cH : cD, barPercentage: 0.7, categoryPercentage: 0.55 }, BAR_OPTS);
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + c.parsed.y + '%'; } } } },
        scales: { y: { beginAtZero: true, ticks: pctTicks(), grid: { color: cssVar('--grid') } },
          x: { grid: { display: false } } }
      }
    });

    const rm = NL.brandRegionMatrix(rows);
    makeChart('brandRegionChart', {
      type: 'bar',
      data: {
        labels: rm.regions,
        datasets: rm.series.map(function (s) {
          return { label: s.brand, data: s.values.map(function (v) { return Math.round(v * 10) / 10; }),
            backgroundColor: s.brand === 'HYUNDAI' ? cH : cD,
            borderRadius: 4, borderSkipped: 'start', maxBarThickness: 13,
            barPercentage: 0.8, categoryPercentage: 0.66 };
        })
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + c.parsed.x + '%'; } } } },
        scales: { x: { beginAtZero: true, ticks: pctTicks(), grid: { color: cssVar('--grid') } },
          y: { grid: { display: false } } }
      }
    });

    // 지역별 브랜드 발송 비중 (100% 스택)
    const vm = NL.brandRegionVolume(rows);
    const regionTotals = vm.regions.map(function (_, i) {
      return vm.series.reduce(function (s, se) { return s + se.values[i]; }, 0);
    });
    makeChart('brandShareChart', {
      type: 'bar',
      data: {
        labels: vm.regions,
        datasets: vm.series.map(function (s) {
          return { label: s.brand, raw: s.values,
            data: s.values.map(function (v, i) {
              return regionTotals[i] ? Math.round(v / regionTotals[i] * 1000) / 10 : 0;
            }),
            backgroundColor: s.brand === 'HYUNDAI' ? cH : cD,
            stack: 'share', maxBarThickness: 13, barPercentage: 0.8, categoryPercentage: 0.66 };
        })
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: function (c) {
            return c.dataset.label + ': ' + c.parsed.x + '% (' + fmt(c.dataset.raw[c.dataIndex]) + '명)';
          } } } },
        scales: { x: { stacked: true, min: 0, max: 100, ticks: pctTicks(), grid: { color: cssVar('--grid') } },
          y: { stacked: true, grid: { display: false } } }
      }
    });
  }

  // 클릭 심층 분석
  function renderClicks(f) {
    const ranking = NL.contentRanking(state.data.contents, f, 10);
    const rs = NL.readerStats(state.data.readers, f, 5);
    $('#clickTotalBadge').textContent = 'Click Total: ' + fmt(rs.totalClicks) + '회';

    const main = cssVar('--c-main');
    makeChart('contentChart', {
      type: 'bar',
      data: {
        labels: ranking.map(function (r) { return r.content; }),
        datasets: [{ data: ranking.map(function (r) { return r.clicks; }),
          backgroundColor: main, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 16,
          barPercentage: 0.72, categoryPercentage: 0.82 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return '클릭 ' + c.parsed.x + '회'; } } } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: cssVar('--grid') } },
          y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 10.5 },
            callback: function (v) { const s = this.getLabelForValue(v); return s.length > 12 ? s.slice(0, 12) + '…' : s; } } } }
      }
    });
    $('#contentCallout').innerHTML = ranking.length
      ? '<b>&#128161; 콘텐츠 반응 시사점</b><br>' +
        "'" + esc(ranking[0].content) + "'의 클릭 집중도가 가장 높습니다. 콘텐츠 노출 순서가 클릭 전환율에 영향을 미치므로 주력 콘텐츠의 상단 배치를 권장합니다."
      : '현재 필터에 해당하는 콘텐츠 클릭 데이터가 없습니다.';

    const ramps = [cssVar('--ramp-1'), cssVar('--ramp-2'), cssVar('--ramp-3'), cssVar('--ramp-4')];
    makeChart('readerChart', {
      type: 'doughnut',
      data: {
        labels: rs.bins.map(function (b) { return b.label + ' 클릭'; }),
        datasets: [{ data: rs.bins.map(function (b) { return b.count; }),
          backgroundColor: ramps, borderColor: cssVar('--surface'), borderWidth: 2, hoverOffset: 5 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 11, boxHeight: 11, padding: 12 } },
          tooltip: { callbacks: { label: function (c) { return c.label + ': ' + c.parsed + '명'; } } } }
      }
    });

    let html = '<thead><tr><th>이메일 주소 (Email)</th><th>클릭 수</th></tr></thead><tbody>';
    if (rs.top.length) {
      rs.top.forEach(function (r) {
        html += '<tr><td>' + esc(r.email) + '</td><td class="rate">' + fmt(r.clicks) + '회</td></tr>';
      });
    } else {
      html += '<tr><td colspan="2" style="text-align:center;color:var(--muted)">데이터 없음</td></tr>';
    }
    $('#vipTable').innerHTML = html + '</tbody>';
  }

  // 월별 오픈율 동향 (Hyundai vs Develon 라인 + 발송건수 막대 콤보 옵션 — 한 차트에 이중 축)
  function renderTrend(f) {
    // 브랜드 비교 목적이므로 브랜드 필터는 적용하지 않음 (월/대상/지역 필터만)
    const base = NL.filterSends(state.data.sends, { brand: 'ALL', months: null, audiences: f.audiences, regions: f.regions });
    const months = Array.from(new Set(base.map(function (r) { return r.month; }))).sort(function (a, b) { return a - b; });
    const cH = cssVar('--c-hyundai');
    const cD = cssVar('--c-develon');

    function seriesFor(brand, key) {
      return months.map(function (m) {
        const t = NL.totals(base.filter(function (r) { return r.brand === brand && r.month === m; }));
        return key === 'rate' ? Math.round(t.openRate * 10) / 10 : t.recipients;
      });
    }

    const datasets = [
      { label: 'Hyundai', data: seriesFor('HYUNDAI', 'rate'), borderColor: cH, backgroundColor: cH,
        borderWidth: 2, pointRadius: 3.5, pointHoverRadius: 6, tension: 0.3,
        pointBorderColor: cssVar('--surface'), pointBorderWidth: 1.5, yAxisID: 'y', order: 0 },
      { label: 'Develon', data: seriesFor('DEVELON', 'rate'), borderColor: cD, backgroundColor: cD,
        borderWidth: 2, pointRadius: 3.5, pointHoverRadius: 6, tension: 0.3,
        pointBorderColor: cssVar('--surface'), pointBorderWidth: 1.5, yAxisID: 'y', order: 0 }
    ];
    if (state.comboSend) {
      datasets.push(
        Object.assign({ type: 'bar', label: 'Hyundai 발송', data: seriesFor('HYUNDAI', 'sent'),
          backgroundColor: alpha(cH, 0.35), yAxisID: 'y1', order: 1, barPercentage: 0.66, categoryPercentage: 0.6 }, BAR_OPTS),
        Object.assign({ type: 'bar', label: 'Develon 발송', data: seriesFor('DEVELON', 'sent'),
          backgroundColor: alpha(cD, 0.35), yAxisID: 'y1', order: 1, barPercentage: 0.66, categoryPercentage: 0.6 }, BAR_OPTS)
      );
    }
    const scales = {
      y: { ticks: pctTicks(), grid: { color: cssVar('--grid') },
        title: { display: state.comboSend, text: '오픈율', font: { size: 10 } } },
      x: { grid: { display: false } }
    };
    if (state.comboSend) {
      scales.y1 = { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false },
        title: { display: true, text: '발송건수', font: { size: 10 } } };
    }

    makeChart('trendChart', {
      type: 'line',
      data: { labels: months.map(function (m) { return m + '월'; }), datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 3 } },
          tooltip: { callbacks: { label: function (c) {
            return c.dataset.type === 'bar'
              ? c.dataset.label + ': ' + fmt(c.parsed.y) + '건'
              : c.dataset.label + ' 오픈율: ' + c.parsed.y + '%';
          } } } },
        scales: scales
      }
    });
  }

  // 월별 발송·오픈 구성 (스택 영역: 오픈 + 미오픈 = 발송) — 현재 브랜드/대상/지역 필터 적용
  function renderVolume(f) {
    const base = NL.filterSends(state.data.sends, { brand: f.brand, months: null, audiences: f.audiences, regions: f.regions });
    const rows = NL.byMonth(base);
    const main = cssVar('--c-main');
    const rest = cssVar('--ramp-1');
    $('#volumeTitle').textContent = '월별 발송·오픈 구성' + (f.brand === 'ALL' ? '' : ' (' + (f.brand === 'HYUNDAI' ? 'Hyundai' : 'Develon') + ')');
    makeChart('volumeChart', {
      type: 'line',
      data: {
        labels: rows.map(function (r) { return r.month + '월'; }),
        datasets: [
          { label: '오픈', data: rows.map(function (r) { return r.opens; }),
            borderColor: main, backgroundColor: alpha(main, 0.55), fill: true,
            borderWidth: 1.5, pointRadius: 2.5, tension: 0.3 },
          { label: '미오픈', data: rows.map(function (r) { return r.recipients - r.opens; }),
            borderColor: rest, backgroundColor: alpha(rest, 0.5), fill: true,
            borderWidth: 1.5, pointRadius: 2.5, tension: 0.3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: {
            label: function (c) { return c.dataset.label + ': ' + fmt(c.parsed.y) + '명'; },
            footer: function (items) {
              const total = items.reduce(function (s, it) { return s + it.parsed.y; }, 0);
              return '발송 합계: ' + fmt(total) + '명';
            }
          } } },
        scales: { y: { stacked: true, beginAtZero: true, grid: { color: cssVar('--grid') } },
          x: { grid: { display: false } } }
      }
    });
  }

  // ---------- 엑셀 업로드 ----------
  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      let wb;
      try {
        wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      } catch (err) {
        showModal('엑셀 파일을 읽을 수 없습니다', '<div class="m-section err"><ul><li>' + (err.message || err) + '</li></ul></div>');
        return;
      }
      const sheets = {};
      wb.SheetNames.forEach(function (name) {
        sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      });
      const res = NL.parseWorkbook(sheets);
      let body = '';
      if (res.data) {
        body += '<div class="m-section"><h4>&#9989; 반영 완료 — ' + esc(file.name) + '</h4><ul>' +
          '<li>발송실적 ' + res.data.sends.length + '행</li>' +
          '<li>콘텐츠클릭 ' + res.data.contents.length + '행</li>' +
          '<li>독자클릭 ' + res.data.readers.length + '행</li></ul></div>';
        body += mappingReport(res.mappings);
        if (res.warnings.length) {
          body += '<div class="m-section warn"><h4>&#9888; 경고 (해당 행/분석만 제외)</h4><ul>' +
            res.warnings.slice(0, 15).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') +
            (res.warnings.length > 15 ? '<li>… 외 ' + (res.warnings.length - 15) + '건</li>' : '') + '</ul></div>';
        }
        state.data = res.data;
        state.dataLabel = file.name;
        $('#dataBadge').textContent = '현재: ' + file.name;
        buildMonthChecks();
        renderAll();
        toast('엑셀 데이터가 대시보드에 반영되었습니다.');
      } else {
        body += '<div class="m-section err"><h4>&#10060; 업로드 실패 — 데이터가 반영되지 않았습니다</h4><ul>' +
          res.errors.map(function (er) { return '<li>' + esc(er) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="m-section"><h4>양식 안내</h4><ul>' +
          '<li>시트: <b>발송실적</b>(필수) — 월/브랜드/대상/지역/수신자수/오픈수/클릭수</li>' +
          '<li><b>콘텐츠클릭</b> — 월/브랜드/콘텐츠명/클릭수</li>' +
          '<li><b>독자클릭</b> — 월/브랜드/이메일/클릭수</li>' +
          '<li>양식 파일: templates/뉴스레터_업로드양식.xlsx</li></ul></div>';
      }
      showModal('엑셀 업로드 결과', body);
    };
    reader.readAsArrayBuffer(file);
  }

  function mappingReport(mappings) {
    const kindNames = { sends: '발송실적', contents: '콘텐츠클릭', readers: '독자클릭' };
    const fieldNames = { month: '월', brand: '브랜드', audience: '대상', region: '지역',
      recipients: '수신자수', opens: '오픈수', clicks: '클릭수', content: '콘텐츠명', email: '이메일' };
    let html = '<div class="m-section"><h4>컬럼 자동 매핑 결과</h4><table class="mapping-tbl"><tr><th>시트</th><th>표준 컬럼</th><th>인식된 헤더</th></tr>';
    Object.keys(mappings).forEach(function (kind) {
      Object.keys(mappings[kind]).forEach(function (field) {
        html += '<tr><td>' + kindNames[kind] + '</td><td>' + fieldNames[field] + '</td><td>' + esc(mappings[kind][field]) + '</td></tr>';
      });
    });
    return html + '</table></div>';
  }

  function showModal(title, bodyHtml) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#uploadModal').classList.add('open');
  }

  // ---------- 내보내기 ----------
  const CHART_TITLES = {
    brandGroupChart: '브랜드_그룹별_오픈율_비교',
    brandRegionChart: '지역별_브랜드_오픈율_비교',
    brandShareChart: '지역별_브랜드_발송_비중',
    contentChart: '콘텐츠_선호도_순위',
    readerChart: '독자별_클릭_빈도_분포',
    trendChart: '월별_오픈율_동향',
    volumeChart: '월별_발송_오픈_구성'
  };

  function exportPngs() {
    const bg = cssVar('--surface');
    let count = 0;
    Object.keys(charts).forEach(function (id) {
      const chart = charts[id];
      if (!chart || !chart.canvas || chart.canvas.offsetParent === null) return;
      const src = chart.canvas;
      const tmp = document.createElement('canvas');
      tmp.width = src.width; tmp.height = src.height;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(src, 0, 0);
      const a = document.createElement('a');
      a.href = tmp.toDataURL('image/png');
      a.download = 'AMPS뉴스레터_' + (CHART_TITLES[id] || id) + '.png';
      a.click();
      count++;
    });
    toast(count
      ? count + '개 차트를 PNG로 저장했습니다. 전체 화면 캡처는 [PDF 인쇄/저장]을 이용하세요.'
      : '저장할 차트가 없습니다.');
  }

  function exportExcel() {
    const f = getFilter();
    const filtered = NL.filterSends(state.data.sends, f);
    if (!filtered.length) { toast('현재 필터에 해당하는 데이터가 없습니다.'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(NL.sendsToAoa(filtered)), '발송실적(필터)');
    const regionAoa = [['지역', '수신자수', '오픈수', '클릭수', '오픈율(%)', '클릭률(%)']];
    NL.byRegion(filtered).forEach(function (r) {
      regionAoa.push([r.region, r.recipients, r.opens, r.clicks,
        Math.round(r.openRate * 10) / 10, Math.round(r.clickRate * 10) / 10]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(regionAoa), '지역별요약');
    const name = 'AMPS뉴스레터_' + (f.brand === 'ALL' ? '전체' : f.brand) + '_' + monthsLabel(f.months).replace(/[~,]/g, '-') + '.xlsx';
    XLSX.writeFile(wb, name);
    toast('필터 결과를 엑셀로 저장했습니다.');
  }

  function copyInsights() {
    const text = INS.insightsToText(lastInsights);
    function done() { toast('결과 분석 텍스트가 복사되었습니다.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
    document.body.removeChild(ta);
  }

  // ---------- 이벤트 바인딩 ----------
  function bindEvents() {
    $('#brandSelect').addEventListener('change', function (e) {
      state.brand = e.target.value;
      state.userMode = null;              // 브랜드 기본 명도로 리셋
      applyTheme();
      renderAll();
    });
    $('#tabMap').addEventListener('click', function () { state.regionView = 'map'; renderAll(); });
    $('#tabGauge').addEventListener('click', function () { state.regionView = 'gauge'; renderAll(); });
    $('#comboToggle').addEventListener('change', function (e) { state.comboSend = e.target.checked; renderTrend(getFilter()); });

    // 메뉴
    const menu = $('#menuDropdown');
    $('#btnMenu').addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && e.target !== $('#btnMenu')) menu.classList.remove('open');
    });
    $('#menuTheme').addEventListener('click', function () {
      state.userMode = effectiveMode() === 'light' ? 'dark' : 'light';
      applyTheme();
      renderAll();
      menu.classList.remove('open');
    });
    $('#menuPng').addEventListener('click', function () { menu.classList.remove('open'); exportPngs(); });
    $('#menuPdf').addEventListener('click', function () { menu.classList.remove('open'); window.print(); });
    $('#menuExcel').addEventListener('click', function () { menu.classList.remove('open'); exportExcel(); });
    $('#menuUpload').addEventListener('click', function () { menu.classList.remove('open'); $('#fileInput').click(); });

    // 업로드
    $('#btnUpload').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });
    $('#modalClose').addEventListener('click', function () { $('#uploadModal').classList.remove('open'); });
    $('#uploadModal').addEventListener('click', function (e) {
      if (e.target === $('#uploadModal')) $('#uploadModal').classList.remove('open');
    });

    // 샘플 데이터 복원
    $('#btnSample').addEventListener('click', function () {
      state.data = JSON.parse(JSON.stringify(window.SAMPLE_DATA));
      state.dataLabel = '샘플 데이터';
      $('#dataBadge').textContent = '현재: 샘플 데이터';
      buildMonthChecks();
      renderAll();
      toast('샘플 데이터를 불러왔습니다.');
    });

    $('#btnCopyInsights').addEventListener('click', copyInsights);
  }

  // ---------- 시작 ----------
  function init() {
    applyTheme();
    buildMonthChecks();
    buildStaticChecks();
    bindEvents();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
