/* pipeline.smoke.js — 순수 로직 파이프라인 스모크 테스트
 *
 * 브라우저 없이 Node + vm 으로 빌더의 핵심 모듈을 로드하고
 * parse → infer(classify) → render 파이프라인이 끊김 없이 동작하는지 검증한다.
 *
 *   parser.js      : window.KBuilder.parseDoc / parseDeck / classify  (순수 로직, DOM 불필요)
 *   render-doc.js  : window.KBuilder.buildDoc                          (최소 DOM 셰임으로 구동)
 *   render-deck.js : window.KBuilder.buildDeck                         (최소 DOM 셰임으로 구동)
 *   sample-data.js : window.KBuilder.samples.{doc,deck}               (내장 샘플)
 *
 * 실행:  node tests/pipeline.smoke.js
 * 성공 시 exit 0, 실패 시 exit 1.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ASSETS = path.join(__dirname, "..", "assets");
let passed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failures.push(msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} (기대=${JSON.stringify(expected)}, 실제=${JSON.stringify(actual)})`);
}

/* ----------------------------------------------------------------
 * 최소 DOM 셰임 — 렌더러가 호출하는 메서드만 충족시킨다.
 * mount 에 설정된 innerHTML(문자열)을 그대로 보관해 검증에 사용한다.
 * ---------------------------------------------------------------- */
function Stub(html) {
  this._html = html || "";
  this.style = {};
  this.dataset = {};
  this.textContent = "";
  this.clientWidth = 1920;
  this.clientHeight = 1080;
  this.classList = {
    contains: function () { return false; },
    add: function () {}, remove: function () {}, toggle: function () {}
  };
}
Object.defineProperty(Stub.prototype, "innerHTML", {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); }
});
Stub.prototype.setAttribute = function () {};
Stub.prototype.removeAttribute = function () {};
Stub.prototype.getAttribute = function () { return null; };
Stub.prototype.addEventListener = function () {};
Stub.prototype.removeEventListener = function () {};
Stub.prototype.focus = function () {};
Stub.prototype.appendChild = function () {};
Stub.prototype.insertBefore = function () {};
Stub.prototype.closest = function () { return null; };
Stub.prototype.scrollTo = function () {};
// 같은 문서를 공유하는 자식 스텁을 돌려준다 → 그 안에서 .slide 개수를 셀 수 있게.
Stub.prototype.querySelector = function () { return new Stub(this._html); };
Stub.prototype.querySelectorAll = function (sel) {
  if (/\.slide\b/.test(sel)) {
    const n = (this._html.match(/class="slide /g) || []).length;
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(new Stub());
    return arr;
  }
  return [];
};

function makeSandbox() {
  const ctx = {};
  ctx.window = ctx;             // window === global (모듈이 둘 다 참조)
  ctx.addEventListener = function () {};       // window.addEventListener / 전역 addEventListener
  ctx.removeEventListener = function () {};
  ctx.document = {
    createElement: function () { return new Stub(); },
    getElementById: function () { return new Stub(); },
    querySelector: function () { return new Stub(); },
    querySelectorAll: function () { return []; },
    body: new Stub(), head: new Stub()
  };
  ctx.requestAnimationFrame = function () { return 0; }; // fit() 가 첫 호출에 성공하므로 재귀 없음
  ctx.cancelAnimationFrame = function () {};
  ctx.ResizeObserver = function (cb) {
    this.observe = function () {}; this.unobserve = function () {}; this.disconnect = function () {};
  };
  ctx.localStorage = {
    _m: {},
    getItem: function (k) { return this._m[k] || null; },
    setItem: function (k, v) { this._m[k] = String(v); }
  };
  ctx.console = console;
  return ctx;
}

function loadInto(ctx, file) {
  const code = fs.readFileSync(path.join(ASSETS, file), "utf8");
  vm.runInContext(code, ctx, { filename: file });
}

/* ----------------------------------------------------------------
 * 1) 모듈 로드
 * ---------------------------------------------------------------- */
const ctx = vm.createContext(makeSandbox());
["parser.js", "render-doc.js", "render-deck.js", "sample-data.js", "ai-config.js", "generate.js"].forEach(function (f) {
  loadInto(ctx, f);
});

const K = ctx.window.KBuilder;
ok(!!K, "window.KBuilder 노출됨");
["parseDoc", "parseDeck", "classify", "buildDoc", "buildDeck", "samples"].forEach(function (name) {
  ok(K && K[name] != null, `KBuilder.${name} 존재`);
});

/* ----------------------------------------------------------------
 * 2) classify(infer) — 제목 → 슬라이드 종류 추론
 * ---------------------------------------------------------------- */
eq(K.classify("표지"), "cover", "classify 표지→cover");
eq(K.classify("목차"), "toc", "classify 목차→toc");
eq(K.classify("[활동] 자기소개"), "activity", "classify 활동→activity");
eq(K.classify("정리 - 책임감과 시작"), "closing", "classify 정리→closing");
eq(K.classify("이 기회를 잘 쓰자"), "closing", "classify 기회를잘→closing");
eq(K.classify("게임을 구성하는 핵심 요소"), "content", "classify 일반→content");

/* ----------------------------------------------------------------
 * 3) parseDeck — 편성안 MD → 슬라이드 구조
 * ---------------------------------------------------------------- */
const deck = K.parseDeck(K.samples.deck);
eq(deck.slides.length, 18, "편성안 샘플 슬라이드 18장");
eq(deck.slides[0].kind, "cover", "1번 슬라이드 = 표지");
eq(deck.slides[1].kind, "toc", "2번 슬라이드 = 목차");
eq(deck.slides[17].kind, "closing", "18번 슬라이드 = 마무리");
ok(deck.slides.some(function (s) { return s.kind === "activity"; }), "활동 슬라이드 1개 이상");
ok(deck.meta["교과목"] === "오리엔테이션 & 나의 목표 찾기", "편성안 프론트매터 교과목 파싱");
// 필드 파싱: 핵심 메시지·문구 수집
const s3 = deck.slides[2];
ok(s3.lines.length > 0, "3번 슬라이드 문구 수집됨");
ok(!!s3.key, "3번 슬라이드 핵심 메시지 수집됨");

/* ----------------------------------------------------------------
 * 4) parseDoc — 교수안 MD → 블록 트리
 * ---------------------------------------------------------------- */
const doc = K.parseDoc(K.samples.doc);
eq(doc.title, "교수안 - 목표설정과 자기소개", "교수안 제목 파싱");
ok(doc.meta["주제"] === "목표설정과 자기소개", "교수안 프론트매터 주제 파싱");
ok(doc.meta["소요"] === "6시수(약 360분)", "교수안 프론트매터 소요 파싱");
const types = doc.blocks.reduce(function (m, b) { m[b.type] = (m[b.type] || 0) + 1; return m; }, {});
ok((types.table || 0) >= 3, "표 블록 3개 이상 (개요·흐름·GROW 등)");
ok((types.callout || 0) >= 1, "콜아웃 블록 1개 이상 (멘트 예시)");
ok((types.labelpara || 0) >= 1, "라벨 문단 1개 이상 (강사 활동/설명)");
ok((types.heading || 0) >= 5, "헤딩 블록 5개 이상");

/* ----------------------------------------------------------------
 * 5) buildDoc / buildDeck — 렌더 단계까지 끊김 없이 동작
 * ---------------------------------------------------------------- */
const docMount = new Stub();
K.buildDoc(doc, docMount);
ok(/doc-hero/.test(docMount.innerHTML), "교안 문서: 히어로 표지 렌더");
ok(/doc-table/.test(docMount.innerHTML), "교안 문서: 표 렌더");
ok(/doc-callout/.test(docMount.innerHTML), "교안 문서: 멘트 말풍선 콜아웃 렌더");

const deckMount = new Stub();
const ctrl = K.buildDeck(deck, deckMount);
ok(/deck-viewport/.test(deckMount.innerHTML), "슬라이드: 뷰포트 마운트");
eq((deckMount.innerHTML.match(/class="slide /g) || []).length, 18, "슬라이드 18장 렌더");
ok(/cover-title/.test(deckMount.innerHTML), "슬라이드: 표지 타이틀 렌더");
ok(ctrl && typeof ctrl.goTo === "function", "덱 컨트롤러(goTo) 반환");
eq(ctrl.count, 18, "덱 컨트롤러 슬라이드 수 = 18");

/* ----------------------------------------------------------------
 * 6) 범용성 — 임의의 동일 구조 MD 도 동작
 * ---------------------------------------------------------------- */
const customDeck = [
  "---", "교과목: 테스트 과목", "주제: 범용성 점검", "---", "",
  "## 슬라이드 편성", "",
  "### 슬라이드 1 - 표지",
  "- 슬라이드 문구:",
  "  - (제목) 범용 동작 확인",
  "### 슬라이드 2 - 내용 한 장",
  "- 슬라이드 문구:",
  "  - 첫째 항목",
  "  - 둘째 항목",
  "- 핵심 메시지: 구조만 같으면 어떤 MD든 동작한다",
  "### 슬라이드 3 - 마무리",
  "- 슬라이드 문구:",
  "  - (큰 문구) 끝!"
].join("\n");
const cd = K.parseDeck(customDeck);
eq(cd.slides.length, 3, "임의 MD: 슬라이드 3장 파싱");
eq(cd.slides[0].kind, "cover", "임의 MD: 표지 추론");
eq(cd.slides[2].kind, "closing", "임의 MD: 마무리 추론");
const cdMount = new Stub();
K.buildDeck(cd, cdMount);
eq((cdMount.innerHTML.match(/class="slide /g) || []).length, 3, "임의 MD: 3장 렌더");

/* ----------------------------------------------------------------
 * 7) AI 생성 백엔드 배선 (Supabase 엣지 펑션 slide-gemini)
 * ---------------------------------------------------------------- */
ok(K.AI && typeof K.AI.endpoint === "string", "ai-config: AI.endpoint 노출");
ok(/^https:\/\/.+\/functions\/v1\/slide-gemini$/.test(K.AI.endpoint || ""), "ai-config: slide-gemini 엔드포인트 형식");
eq(K.AI && K.AI.model, "gemini-2.5-pro", "ai-config: 기본 모델 = gemini-2.5-pro");
ok(Array.isArray(K.AI.models) && K.AI.models.length >= 2, "ai-config: 선택 가능한 모델 2개 이상");
ok(K.AI.models.every(function (m) { return m.id && m.label; }), "ai-config: 각 모델에 id·label 존재");
ok(K.AI.models.some(function (m) { return m.id === K.AI.model; }), "ai-config: 기본 모델이 목록에 포함");
ok(K.AI.models.every(function (m) { return /gemini-2\.5/.test(m.id); }), "ai-config: 모든 모델 2.5 계열(thinking 지원)");
ok(typeof K.generateFromSource === "function", "generate.js: generateFromSource 노출");
ok(typeof K.splitSections === "function", "generate.js: splitSections 노출");
const secOut = K.splitSections(
  "# 제목\n\n## 학습 목표\n- 목표\n\n## 1. 첫 섹션\n첫 섹션 본문입니다. 충분히 길게 작성한 설명 문장입니다.\n\n## 2. 둘째 섹션\n둘째 섹션 본문도 충분히 깁니다. 설명을 이어서 적습니다."
);
ok(secOut.sections.length >= 2, "splitSections: 소스 원고를 2개 이상 섹션으로 분리");

/* ----------------------------------------------------------------
 * 8) 인라인 마크다운: 덱에서 **굵게**가 <strong>으로 (원문 ** 노출 방지)
 * ---------------------------------------------------------------- */
const mdDeck = K.parseDeck([
  "## 슬라이드 편성", "",
  "### 슬라이드 1 - 표지", "- 슬라이드 문구:", "  - (제목) 제목",
  "### 슬라이드 2 - 개념", "- 슬라이드 문구:",
  "  - **시스템**: 게임의 뼈대 / **콘텐츠**: 게임의 살 / **UI**: 소통",
  "  - 일반 항목 **강조** 포함",
  "- 핵심 메시지: **중요** 메시지"
].join("\n"));
const mdMount = new Stub();
K.buildDeck(mdDeck, mdMount);
ok(/<strong>시스템<\/strong>/.test(mdMount.innerHTML), "덱: 칩 **굵게** → <strong> 변환");
ok(!/\*\*시스템\*\*/.test(mdMount.innerHTML), "덱: 칩에 ** 원문이 노출되지 않음");
ok(/<strong>강조<\/strong>/.test(mdMount.innerHTML), "덱: 본문 **굵게** → <strong>");
ok(/<strong>중요<\/strong>/.test(mdMount.innerHTML), "덱: 핵심 메시지 **굵게** → <strong>");

/* ----------------------------------------------------------------
 * 9) 이미지 잘림 방지: 슬롯은 contain + frame=fit (cover 미사용)
 * ---------------------------------------------------------------- */
ok(!/fit="cover"/.test(deckMount.innerHTML), "덱: 이미지 슬롯에 cover(잘림) 미사용");
ok(/frame="fit"/.test(deckMount.innerHTML), "덱: 내용 슬라이드 이미지 슬롯 frame=fit");

/* ----------------------------------------------------------------
 * 결과 출력
 * ---------------------------------------------------------------- */
if (failures.length) {
  console.error("\n❌ 스모크 테스트 실패 (" + failures.length + "건):");
  failures.forEach(function (f) { console.error("   • " + f); });
  console.error("\n통과 " + passed + " / 실패 " + failures.length);
  process.exit(1);
} else {
  console.log("✅ 스모크 테스트 전부 통과 — 단언 " + passed + "건");
  console.log("   parse → infer(classify) → render 파이프라인 정상 (교수안 문서 + 슬라이드 18장).");
  process.exit(0);
}
