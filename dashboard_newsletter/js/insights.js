/* ============================================================
 * AMPS 뉴스레터 대시보드 — 결과 분석 자동 기입 (규칙 기반)
 * 필터된 데이터에서 3~5개의 인사이트 문단을 생성한다.
 * LLM 연동은 README의 "LLM 어댑터 지점" 참고 — 이 모듈은 규칙 기반만 포함.
 * ============================================================ */
(function (root, factory) {
  const dep = (typeof module !== 'undefined' && module.exports)
    ? require('./data.js')
    : root.NLData;
  const mod = factory(dep);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.NLInsights = mod;
})(typeof self !== 'undefined' ? self : this, function (NLData) {
  'use strict';

  function pct(v) { return (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  function num(v) { return Number(v || 0).toLocaleString('ko-KR'); }

  /**
   * 인사이트 생성.
   * @param {Object} args
   *   filtered  : 필터 적용된 발송실적 rows
   *   allSends  : 전체 발송실적 rows (전월 비교용)
   *   contents  : 콘텐츠클릭 rows (없으면 [])
   *   filter    : { brand, months, audiences, regions }
   * @returns {Array<{title:string, body:string}>} 3~5개
   */
  function generateInsights(args) {
    const filtered = args.filtered || [];
    const contents = args.contents || [];
    const filter = args.filter || {};
    const out = [];
    if (!filtered.length) {
      return [{ title: '데이터 없음', body: '현재 필터 조건에 해당하는 발송 실적이 없습니다. 월/지역/대상 필터를 확인해 주세요.' }];
    }

    const total = NLData.totals(filtered);
    const regions = NLData.byRegion(filtered)
      .filter(function (r) { return r.recipients >= 3; }); // 극소 표본 지역은 순위에서 제외
    const sorted = regions.slice().sort(function (a, b) { return b.openRate - a.openRate; });

    // 1) 최고 오픈율 지역 (상위 1~2개)
    if (sorted.length) {
      const best = sorted[0];
      const second = sorted[1];
      let body = best.region + ' 지역의 오픈율이 ' + pct(best.openRate) +
        ' (' + num(best.opens) + '/' + num(best.recipients) + '명)로 가장 높아 이번 기간의 핵심 참여 지역으로 나타났습니다.';
      if (second && second.openRate >= total.openRate) {
        body += ' ' + second.region + '(' + pct(second.openRate) + ') 역시 평균(' + pct(total.openRate) + ')을 상회하며 견고한 반응을 보였습니다.';
      }
      out.push({ title: (second && second.openRate >= total.openRate ? best.region + ' 및 ' + second.region + ' 반응 최고' : best.region + ' 반응 최고'), body });
    }

    // 2) 전월 대비 변화
    const mom = NLData.momDelta(args.allSends || filtered, filter);
    if (mom && mom.prev.recipients > 0 && mom.cur.recipients > 0) {
      const diff = mom.cur.openRate - mom.prev.openRate;
      const dir = diff >= 0.5 ? '상승' : diff <= -0.5 ? '하락' : '유지';
      let body = mom.curMonth + '월 오픈율은 ' + pct(mom.cur.openRate) + '로 전월(' + mom.prevMonth + '월 ' + pct(mom.prev.openRate) + ') 대비 ' +
        (dir === '유지' ? '큰 변동 없이 유지되었습니다.' : Math.abs(Math.round(diff * 10) / 10).toFixed(1) + '%p ' + dir + '했습니다.');
      if (dir === '하락') body += ' 발송 시점·제목(Subject) 개선과 콘텐츠 구성 재검토를 권장합니다.';
      if (dir === '상승') body += ' 최근 적용한 콘텐츠 구성이 유효했던 것으로 판단되며 동일 전략 유지를 권장합니다.';
      out.push({ title: '전월 대비 오픈율 ' + dir, body });
    }

    // 3) 수신 규모 대비 기여 (가장 큰 모수 지역)
    if (regions.length >= 2) {
      const biggest = regions.slice().sort(function (a, b) { return b.recipients - a.recipients; })[0];
      const share = NLData.rate(biggest.opens, total.opens);
      out.push({
        title: biggest.region + ' 지역의 기여도',
        body: '수신 인원이 가장 많은 ' + biggest.region + '(' + num(biggest.recipients) + '명)이 전체 오픈의 ' + pct(share) +
          '를 차지하며 오픈율 ' + pct(biggest.openRate) + '를 기록, 전체 평균 오픈율(' + pct(total.openRate) + ')을 ' +
          (biggest.openRate >= total.openRate ? '견인하고 있습니다.' : '소폭 끌어내리고 있어 모수 대비 참여 제고가 필요합니다.')
      });
    }

    // 4) 저조 지역 제고 제안 (평균의 70% 미만)
    const weak = sorted.filter(function (r) { return r.openRate < total.openRate * 0.7; }).slice(-2).reverse();
    if (weak.length) {
      out.push({
        title: '일부 지역 참여도 제고 필요',
        body: weak.map(function (r) { return r.region + '(' + pct(r.openRate) + ')'; }).join('와 ') +
          ' 지역은 평균(' + pct(total.openRate) + ') 대비 오픈율이 저조합니다. 해당 지역 딜러 대상 맞춤형 푸시 메일, 현지어 제목, 지역 밀착형 콘텐츠 구성이 권장됩니다.'
      });
    }

    // 5) 콘텐츠 클릭 시사점
    const ranking = NLData.contentRanking(contents, filter, 3);
    if (ranking.length) {
      const top = ranking[0];
      out.push({
        title: "콘텐츠 시사점 — '" + top.content + "' 클릭 집중",
        body: "'" + top.content + "'(" + num(top.clicks) + '회)이 콘텐츠 클릭 1위를 기록했습니다.' +
          (ranking[1] ? " 이어 '" + ranking[1].content + "'(" + num(ranking[1].clicks) + '회)가 뒤를 이었습니다.' : '') +
          ' 콘텐츠 노출 순서가 클릭 전환에 큰 영향을 미치므로, 차월에도 주력 콘텐츠를 뉴스레터 상단에 배치하는 전략을 권장합니다.'
      });
    }

    return out.slice(0, 5);
  }

  /** 복사 버튼용 일반 텍스트 변환 */
  function insightsToText(list) {
    return (list || []).map(function (it, i) {
      return String(i + 1).padStart(2, '0') + '. ' + it.title + '\n' + it.body;
    }).join('\n\n');
  }

  return { generateInsights, insightsToText };
});
