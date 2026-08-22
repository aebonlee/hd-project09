# AMPS 뉴스레터 결과보고 대시보드 (hd-project09)

> 🌐 **배포 페이지: [https://aebonlee.github.io/hd-project09/](https://aebonlee.github.io/hd-project09/)** · 저장소: https://github.com/aebonlee/hd-project09

HD건설기계 AMPS기획팀(기획: 홍재영)의 글로벌 뉴스레터 성과 통합 보고 대시보드 — 기존 Antigravity 대시보드의 업그레이드 재제작본입니다.

- 현대·디벨론 **브랜드 테마 자동 전환** (디벨론 공식 컬러 가이드 적용)
- **엑셀 업로드만으로 자동 반영** (3시트 양식·샘플 제공: `dashboard_newsletter/templates/`)
- **세계지도 지역별 오픈율**, 클릭 심층 분석, 월별 추이, ALL 브랜드 비교
- **결과 분석 AI 자동 기입** (규칙 기반, LLM 연동 지점 문서화)
- PNG/PDF/엑셀 내보내기

상세 사용법·데이터 양식·이어서 개발하는 법: [dashboard_newsletter/README.md](dashboard_newsletter/README.md)
기획서 원문: [CLAUDE.md](CLAUDE.md) · 개발 과정: [docs/개발일지.md](docs/개발일지.md)

관련 저장소: [hd-project08](https://github.com/aebonlee/hd-project08)(마케팅 업무공유 대시보드·회의록) · [hd-project10](https://github.com/aebonlee/hd-project10)(부품 사진 자동화)

## 실행/테스트

- 배포 페이지 접속 또는 `python3 -m http.server` 후 접속
- `node dashboard_newsletter/test/data.test.js`
