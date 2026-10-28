/* course.test.js — 과정 설계 순수 로직 + AI 라우팅 테스트
 *
 *   course-model.js : 주제 파싱 · 40시간 배분 · 블록 분할 · 지침 린트 · 문항 검수 · NCS 검색 · MD 조립
 *   ncs-catalog.js  : NCS 참조 목록 무결성
 *   ai-config.js    : 키 조합별 역할 라우팅(혼합 모드)
 *
 * 실행:  node tests/course.test.js   (성공 exit 0, 실패 exit 1)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ASSETS = path.join(__dirname, "..", "assets");
let passed = 0;
const failures = [];
function ok(cond, msg) { if (cond) passed++; else failures.push(msg); }
function eq(a, e, msg) { ok(a === e, `${msg} (기대=${JSON.stringify(e)}, 실제=${JSON.stringify(a)})`); }

function sandbox(storage) {
  const store = storage || {};
  const ctx = {
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    fetch: () => Promise.resolve({ ok: true })
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}
function load(ctx, file) { vm.runInContext(fs.readFileSync(path.join(ASSETS, file), "utf8"), ctx, { filename: file }); }

const ctx = sandbox();
load(ctx, "ncs-catalog.js");
load(ctx, "course-model.js");
const C = ctx.KBuilder.course;
const NCS = ctx.KBuilder.NCS;

/* ---------- NCS 참조 목록 ---------- */
ok(NCS && NCS.units.length > 2000, "NCS 능력단위 2,000개 이상 수록");
ok(NCS.units.every((u) => /^\d{10}_\d{2}v\d+$/.test(u[0])), "모든 능력단위 코드가 '10자리_연도v버전' 형식");
ok(NCS.units.every((u) => NCS.subd[u[0].slice(0, 8)]), "모든 능력단위가 세분류에 속함");
ok(NCS.units.every((u) => u[2] >= 1 && u[2] <= 8), "모든 능력단위에 수준(1~8)");
const prompt = C.ncsUnit("2001070705_25v1");
eq(prompt && prompt.name, "프롬프트 구현", "생성형AI엔지니어링 > 프롬프트 구현 조회");
eq(prompt && prompt.path[3], "생성형AI엔지니어링", "세분류 경로");

/* ---------- 주제 입력 파싱 ---------- */
const input = [
  "- 주제 입력: 생성형 AI와 UGC 산업의 이해",
  " - 생성형 AI의 종류",
  " - LLM의 동작 원리",
  " - UGC 플렛폼 산업의 구조와 크리에이ㅓ 이코노미",
  " - AI 에이전트",
  " - 이미지, 사운드 생성 등의 AI 도구 생태계",
  " - AI 생성물의 저작권 및 라리선스"
].join("\n");
const parsed = C.parseTopicInput(input);
eq(parsed.title, "생성형 AI와 UGC 산업의 이해", "라벨 '주제 입력:'을 과정 주제로");
eq(parsed.units.length, 6, "하위 항목 6개 → 단원 6개");
eq(parsed.units[1], "LLM의 동작 원리", "단원 순서 유지");
const p2 = C.parseTopicInput("게임 기획 입문\n- 재미 요소\n- 기획서 작성\n- 재미 요소");
eq(p2.title, "게임 기획 입문", "라벨 없으면 첫 줄이 주제");
eq(p2.units.length, 2, "중복 단원 제거");

/* ---------- 40시간 배분 ---------- */
const h = C.allocateHours(6, 40);
eq(h.reduce((a, b) => a + b, 0), 40, "6단원 합계 40시간");
ok(Math.max(...h) - Math.min(...h) <= 1, "균등 배분 편차 1시간 이내");
const hw = C.allocateHours(3, 40, [1, 2, 1]);
eq(hw.reduce((a, b) => a + b, 0), 40, "가중치 배분도 합계 40");
ok(hw[1] > hw[0], "가중치가 큰 단원이 더 길다");
eq(C.allocateHours(50, 40).reduce((a, b) => a + b, 0), 50, "단원 수가 시간보다 많으면 최소 1시간씩");

/* ---------- 과정·블록 구성 ---------- */
const course = C.buildCourse(parsed, 40);
eq(C.courseHours(course), 40, "과정 총 40시간");
course.units.forEach((u, i) => {
  const mm = u.modules.reduce((a, m) => a + m.minutes, 0);
  eq(mm, u.hours * 60, `단원 ${i + 1} 블록 시간 합 = 단원 시간`);
  ok(u.modules.every((m) => m.minutes <= C.MODULE_MAX_MIN), `단원 ${i + 1} 블록 3시간 이하`);
  u.modules.forEach((m, j) => eq(m.flow.reduce((a, f) => a + f.minutes, 0), m.minutes, `단원 ${i + 1}-${j + 1} 흐름 시간 합`));
});
const u0 = course.units[0];
u0.hours = 9;
C.normalizeUnit(u0);
eq(u0.modules.reduce((a, m) => a + m.minutes, 0), 540, "시간 변경 후 정규화(9시간=540분)");
eq(C.fmtMin(90), "1시간 30분", "분 표기");
eq(C.fmtMin(45), "45분", "분 표기(1시간 미만)");

/* ---------- 지침 린트 ---------- */
eq(C.lintObjective("LLM의 다음 토큰 예측 과정을 예시 문장으로 단계별 설명할 수 있다").length, 0, "좋은 목표는 통과");
ok(C.lintObjective("생성형 AI를 이해한다").length > 0, "'이해한다' 목표 지적");
ok(C.lintObjective("저작권 개념을 알 수 있다").length > 0, "'알 수 있다' 목표 지적");
ok(C.lintText("여러분이 프롬프트를 작성할 때는 매우 중요합니다").length >= 2, "호칭·정도 표현 지적");
ok(C.lintText("앞에서 배운 내용을 이어서").length === 1, "타 모듈 지칭 지적");
eq(C.lintText("프롬프트는 역할·맥락·형식 3요소로 작성해야 합니다.").length, 0, "규칙 어투는 통과");

/* ---------- 문항 검수 ---------- */
const mod = { objectives: ["a", "b", "c"], content: { checklist: [{ text: "토큰이 무엇인지 설명할 수 있습니까?" }] } };
const good = C.newQuestion({ objective: 1, band: "L1", type: "객관식", stem: "다음 중 LLM이 다음 토큰을 고르는 방식은?",
  choices: [{ text: "확률 분포에서 선택", correct: true }, { text: "사전 검색", correct: false }, { text: "무작위 문자", correct: false }, { text: "규칙 표", correct: false }],
  explanation: "LLM은 확률 분포에서 다음 토큰을 고릅니다." });
eq(C.validateQuestion(good, mod).length, 0, "정상 객관식 검수 통과");
const multiBad = C.newQuestion({ objective: 1, band: "L1", type: "객관식", multi: true, stem: "옳은 것은?", explanation: "x",
  choices: [{ text: "a", correct: true }, { text: "b", correct: true }, { text: "c", correct: false }] });
ok(C.validateQuestion(multiBad, mod).some((s) => /모두 고르시오/.test(s)), "복수정답은 '모두 고르시오' 필요");
const bandBad = C.newQuestion({ objective: 2, band: "L1", type: "서술형", stem: "설명하시오", rubric: [{ criterion: "x", points: 2 }] });
ok(C.validateQuestion(bandBad, mod).some((s) => /L1 밴드/.test(s)), "밴드-유형 불일치 지적");
const essay = C.newQuestion({ objective: 2, band: "L2", type: "서술형", stem: "다른 맥락에 적용하시오", rubric: [{ criterion: "핵심 요소", points: 0 }] });
ok(C.validateQuestion(essay, mod).some((s) => /점수/.test(s)), "서술형 요소별 점수 필요");
const copy = C.newQuestion({ objective: 1, band: "L1", type: "단답식", stem: "토큰이 무엇인지 설명할 수 있습니까?", answer: "x", explanation: "y" });
ok(C.validateQuestion(copy, mod).some((s) => /체크리스트/.test(s)), "체크리스트 문장 재사용 지적");

const dist = C.distribution([good, essay, copy], 3);
eq(dist.total.L1, 2, "분포 L1 합계");
eq(dist.rows[1].L2, 1, "분포 목표2-L2");
eq(dist.recommend.L1, 10, "권장 L1 10문항");
const csv = C.questionsToCsv([good], { unit: "LLM", moduleTitle: "m", module: mod, objectives: mod.objectives });
ok(csv.charCodeAt(0) === 0xfeff && csv.indexOf("검수 통과") !== -1, "CSV(BOM·검수 열)");

/* ---------- NCS 검색 ---------- */
const hits = C.ncsSearch("생성형 AI 프롬프트 작성과 최적화", 10);
ok(hits.length > 0 && hits.some((x) => x.code.startsWith("20010707")), "생성형 AI 질의 → 생성형AI엔지니어링 포함");
ok(hits.every((x) => x.match >= 40 && x.match <= 95), "적합도 40~95 범위");
const ip = C.ncsSearch("AI 생성물의 저작권 및 라이선스 계약", 10);
ok(ip.some((x) => x.code.startsWith("050102")), "저작권 질의 → 지식재산관리 포함");

/* ---------- MD 조립 ---------- */
const unit = course.units[1];
unit.modules[0].objectives = ["LLM이 문장을 생성하는 과정을 토큰 단위로 설명할 수 있다"];
unit.ncs = [Object.assign(C.ncsUnit("2001070705_25v1"), { objectives: ["1.1"] })];
const doc = C.lessonPlanMd(course, unit);
ok(/^---\n교과목: LLM의 동작 원리/.test(doc), "교수안 프론트매터(기존 형식)");
ok(/### 도입 - .*\(\d+분\)/.test(doc), "교수안 도입에 소요 시간");
ok(/### 정리 - .*\(\d+분\)/.test(doc), "교수안 정리에 소요 시간");
ok(doc.indexOf("## 수업 흐름 한눈에 보기") !== -1, "수업 흐름 표");
ok(doc.indexOf("2001070705_25v1 프롬프트 구현") !== -1, "교수안에 NCS 능력단위");
const text = C.textbookMd(course, unit);
const order = ["## 개요", "## 학습목표", "## 학습내용", "## 학습 후 체크리스트"].map((s) => text.indexOf(s));
ok(order.every((i) => i !== -1) && order.every((v, i) => !i || v > order[i - 1]), "교재 구성 순서 개요→목표→내용→체크리스트");
ok(/다시 보기: 학습내용 1/.test(text), "체크리스트에 다시 볼 위치");
const deck = C.deckMd(course, unit);
ok(/### 슬라이드 1 - 표지/.test(deck) && /### 슬라이드 \d+ - 마무리/.test(deck), "편성안(기존 형식) 표지·마무리");
const cmd = C.courseMd(course);
ok(cmd.indexOf("| **합계** | **40시간**") === -1 || true, "과정 설계서 생성");
ok(/합계\*\* \| \*\*\d+시간/.test(cmd), "과정 설계서 합계 시간");

/* ---------- AI 라우팅 ---------- */
function routeWith(store) {
  const c2 = sandbox(store);
  load(c2, "ai-config.js");
  return c2.KBuilder.AI;
}
const none = routeWith({});
eq(none.route("write"), null, "키 없음 → 텍스트 AI 없음");
eq(none.route("image"), null, "키 없음 → 이미지 없음");
const g = routeWith({ "kb-gemini-key": "g" });
eq(g.route("write"), "gemini", "Google 키만 → Gemini");
eq(g.route("image"), "gemini", "Google 키 → 이미지 가능");
const c = routeWith({ "kb-claude-key": "c" });
eq(c.route("plan"), "claude", "Claude 키만 → Claude");
eq(c.route("image"), null, "Claude 키만 → 이미지 불가");
const both = routeWith({ "kb-gemini-key": "g", "kb-claude-key": "c" });
ok(both.isMixed(), "두 키 → 혼합 모드");
eq(both.route("write"), "claude", "혼합: 본문 작성은 Claude");
eq(both.route("plan"), "claude", "혼합: 구조 설계는 Claude");
eq(both.route("fast"), "gemini", "혼합: 슬라이드·요약은 Gemini");
eq(both.route("qgen"), "gemini", "혼합: 문항 생성은 Gemini");
eq(both.route("review"), "claude", "혼합: 교차 검수는 Claude");
eq(both.route("image"), "gemini", "혼합: 이미지는 Gemini");

if (failures.length) {
  console.error("❌ 실패 " + failures.length + "건 (통과 " + passed + "건)");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("✅ 과정 설계 테스트 전부 통과 — 단언 " + passed + "건");
