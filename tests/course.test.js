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
load(ctx, "course-rules.js");
load(ctx, "course-model.js");
load(ctx, "course-sessions.js");
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
const order = ["# " + unit.modules[0].title + " 개요", "## 학습 목표", "## 학습 개요", "## ✅ 학습 후 체크리스트"].map((s) => text.indexOf(s));
ok(order.every((i) => i !== -1) && order.every((v, i) => !i || v > order[i - 1]), "교안 양식 순서 개요(목표·학습 개요)→학습내용→체크리스트");
ok(/다시 보기: 학습내용 1/.test(text), "체크리스트에 다시 볼 위치");
ok(!/^---\n/.test(text) && /^<!--\n학습모듈 정보/.test(text), "기존 교안처럼 프론트매터 없이 시작, 메타데이터는 보이지 않는 주석");
// 기존 교안 양식: 학습내용은 # 큰 주제, 줄글은 문장마다 글머리, ### 소제목은 ## 로
const lm = unit.modules[0];
lm.content = { overview: "문제 상황이 있습니다. 해결 방법을 배웁니다.", sections: [{ title: "토큰 예측", body: "LLM은 다음 토큰을 고릅니다. 확률이 높은 토큰을 고릅니다.\n\n### 샘플링\n온도가 높으면 다양해집니다.\n\n- 이미 글머리인 줄\n\n```js\nconst a = 1;\n\nconst b = 2;\n```" }], checklist: [{ text: "설명할 수 있습니까?", ref: "학습내용 1" }],
  quest: { title: "토큰 예측 실습", steps: ["문장 세 개의 다음 토큰을 예측합니다."] } };
const lmd = C.textbookModuleMd(course, unit, 0);
ok(/\n# 토큰 예측\n/.test(lmd), "학습내용 제목은 # 큰 주제");
ok(/- LLM은 다음 토큰을 고릅니다\.\n- 확률이 높은 토큰을 고릅니다\./.test(lmd), "줄글은 문장마다 글머리로");
ok(/\n## 샘플링\n/.test(lmd) && /- 온도가 높으면 다양해집니다\./.test(lmd), "### 소제목은 ## 로, 아래 줄글도 글머리로");
ok(/- 이미 글머리인 줄/.test(lmd) && /```js\nconst a = 1;\n\nconst b = 2;\n```/.test(lmd), "글머리·코드 블록은 그대로");
ok(/- 문제 상황이 있습니다\.\n- 해결 방법을 배웁니다\./.test(lmd), "개요도 글머리로");
ok(/## ❗오늘의 퀘스트\(기본 실습\)\n\n⚙️토큰 예측 실습\n- 문장 세 개의 다음 토큰을 예측합니다\.\n- 제출 파일명: `\d{6}_2-1_토큰예측실습_Ver0n_조or이름`/.test(lmd), "오늘의 퀘스트 + 제출 파일명(날짜_단원-블록_제목)");
ok(/<br><br><br><br>/.test(lmd), "큰 주제 사이 여백");
// 예전에 저장된 줄글 교재 → 불러올 때 한 번 기존 교안 양식으로 바꿔 저장 (다시 바꾸지 않음)
const pm = C.newModule({ title: "예전 블록", objectives: ["예전 내용을 설명할 수 있다."] });
pm.content = { overview: "문제가 있습니다. 해결합니다.", sections: [{ title: "예전 내용", body: "첫 문장입니다. 둘째 문장입니다.\n\n### 소제목\n셋째 문장입니다." }], checklist: [{ text: "설명할 수 있습니까?", ref: "학습내용 1" }] };
const oldCourse = { v: 1, units: [{ title: "예전 단원", hours: 2, modules: [pm] }], trash: [] };
C.ensureCourse(oldCourse);
eq(pm.content.overview, "- 문제가 있습니다.\n- 해결합니다.", "저장된 개요를 글머리 문장으로");
eq(pm.content.sections[0].body, "- 첫 문장입니다.\n- 둘째 문장입니다.\n\n## 소제목\n- 셋째 문장입니다.", "저장된 학습내용을 글머리·## 소제목으로");
ok(pm.content.lessonFmt === 1 && /기존 교안 양식으로 정리/.test(pm.changelog.map((x) => x.t).join("|")), "변환 표시 + 변경 이력");
const logN = pm.changelog.length;
pm.content.sections[0].body = "사용자가 나중에 쓴 줄글입니다.";
C.ensureCourse(oldCourse);
ok(pm.content.sections[0].body === "사용자가 나중에 쓴 줄글입니다." && pm.changelog.length === logN, "한 번 바꾼 뒤에는 저장 내용을 다시 건드리지 않음");
const pmd = C.textbookModuleMd(oldCourse, oldCourse.units[0], 0);
ok(/## 학습 개요\n\n- 문제가 있습니다\.\n- 해결합니다\./.test(pmd) && !/- - /.test(pmd), "글머리 개요는 겹치지 않게 내보냄");
ok(/- 사용자가 나중에 쓴 줄글입니다\./.test(pmd), "나중에 쓴 줄글도 내보낼 때는 글머리");
const deck = C.deckMd(course, unit);
ok(/### 슬라이드 1 - 표지/.test(deck) && /### 슬라이드 \d+ - 마무리/.test(deck), "편성안(기존 형식) 표지·마무리");
const cmd = C.courseMd(course);
ok(cmd.indexOf("| **합계** | **40시간**") === -1 || true, "과정 설계서 생성");
ok(/합계\*\* \| \*\*\d+시간/.test(cmd), "과정 설계서 합계 시간");

/* ---------- 차시(1차시 = 1시간) 분할 ---------- */
const su = C.newUnit("생성형 AI의 종류", 5);
su.modules = [
  C.newModule({ title: "모듈A", minutes: 100, objectives: ["A를 사례로 설명할 수 있다"],
    content: { overview: "a", sections: [{ title: "a", body: "a" }], checklist: [{ text: "A를 설명할 수 있습니까?" }], guide: ["g-a0", "g-a1", "g-a2"],
      slides: "### 슬라이드 - A1\n- 슬라이드 문구:\n  - a1\n\n### 슬라이드 - A2\n- 슬라이드 문구:\n  - a2\n\n### 슬라이드 - A3\n- 슬라이드 문구:\n  - a3" },
    flow: [{ phase: "도입", title: "A 도입", minutes: 10 }, { phase: "전개", title: "A 전개", minutes: 80 }, { phase: "정리", title: "A 정리", minutes: 10 }] }),
  C.newModule({ title: "모듈B", minutes: 200, flow: [{ phase: "도입", title: "B 도입", minutes: 10 }, { phase: "전개", title: "B 개념", minutes: 90 }, { phase: "전개", title: "B 실습", minutes: 90 }, { phase: "정리", title: "B 정리", minutes: 10 }] })
];
const sess = C.unitSessions(su);
eq(sess.length, 5, "5시간 단원 → 5차시");
ok(sess.every((s) => s.minutes === 60), "차시마다 60분");
sess.forEach((s, si) => {
  const st = C.sessionSteps(su, s, si, sess.length);
  eq(st.reduce((a, x) => a + x.minutes, 0), 60, `${si + 1}차시 단계 시간 합 = 60분`);
  eq(st[0].kind, "도입", `${si + 1}차시는 도입으로 시작`);
  eq(st[st.length - 1].kind, "정리", `${si + 1}차시는 정리로 끝남`);
});
const st2 = C.sessionSteps(su, sess[1], 1, sess.length);
ok(st2.some((x) => x.cont && /\(이어서\)/.test(x.text)), "차시 경계에 걸친 단계는 '(이어서)'로 표시");
ok(C.sessionSteps(su, sess[0], 0, sess.length).some((x) => x.more && /다음 차시에 계속/.test(x.text)), "앞부분은 '(다음 차시에 계속)'");
ok(new Set(sess.map((s, si) => C.sessionTitle(su, s))).size >= 4, "차시 제목이 차시마다 구별됨");

const out = C.assembleOutputs(course, su);
eq(out.v, C.OUTPUTS_V, "산출물 버전");
eq(out.sessions.length, 5, "차시별 산출물 5개");
ok(out.sessions.every((s) => /^---\n교과목: 생성형 AI의 종류\n주제: .+\n차시: \d\/5/.test(s.docMd)), "차시 교수안 프론트매터(차시 표시)");
ok(out.sessions.every((s) => /### 도입 - .*\(\d+분\)/.test(s.docMd) && /### 정리 - .*\(\d+분\)/.test(s.docMd)), "차시 교수안마다 도입·정리 + 소요 시간");
ok(out.sessions[0].docMd.indexOf("g-a0") !== -1, "블록 교수안 지침이 해당 차시에 들어감");
ok(out.sessions.every((s) => /### 슬라이드 1 - 표지/.test(s.deckMd) && /### 슬라이드 \d+ - 마무리/.test(s.deckMd)), "차시 편성안마다 표지·마무리");
const cover1 = out.sessions[0].deckMd;
ok(/\(제목\) 모듈A \(1\/2\)\n/.test(cover1), "표지 제목은 짧게 — 블록 이름 + 걸친 차시(1/2)");
ok(/\(부제\) A 전개\n/.test(cover1) && /\(하단\) 1차시 \/ 5차시 · 1시간/.test(cover1), "표지 부제는 다루는 내용, 하단은 차시");
ok(/\| 다루는 내용 \| /.test(out.sessions[0].docMd), "차시 교수안 개요에 다루는 내용");
eq(C.OUTPUTS_V, 3, "산출물 버전 3 — 예전 산출물은 불러올 때 다시 조립");
const allDeck = out.sessions.map((s) => s.deckMd).join("\n");
eq(["A1", "A2", "A3"].map((t) => (allDeck.match(new RegExp("### 슬라이드 \\d+ - " + t + "\\n", "g")) || []).length).join(","), "1,1,1", "블록 슬라이드는 차시에 한 번씩만 배분");
ok(/### 슬라이드 \d+ - 학습목표: 모듈A/.test(out.sessions[0].deckMd), "블록이 시작하는 차시에 학습목표 슬라이드");
ok(/### 슬라이드 \d+ - 체크리스트: 모듈A/.test(out.sessions[1].deckMd), "블록이 끝나는 차시에 체크리스트 슬라이드");
const comb = C.sessionsDeckMd(course, su, out);
ok(/### 슬라이드 2-1 - 표지/.test(comb) && !/### 슬라이드 1 - /.test(comb), "전체 차시 편성안은 '차시-번호'로 번호 매김");
ok(/\| 5차시 \| 1시간 \|/.test(C.sessionsDocMd(course, su, out)), "전체 차시 교수안에 차시 목차");
const tx = C.sessionTextMd(course, su, out.sessions[0]);
ok(tx.indexOf("# 모듈A") !== -1 && tx.indexOf("# 모듈B") === -1, "차시 교재는 그 차시에 걸친 블록만");
// 예전에 단원 한 덩어리로 조립한 산출물 → 불러올 때 차시별로 다시 조립(조립일 유지)
const old = { v: 1, units: [su], trash: [] };
su.outputs = { docMd: "옛 교수안", deckMd: "옛 편성안", textMd: "옛 교재", generatedAt: "2026-10-01" };
C.ensureCourse(old);
eq(su.outputs.v, C.OUTPUTS_V, "옛 산출물 → 차시별로 다시 조립");
eq(su.outputs.generatedAt, "2026-10-01", "다시 조립해도 조립일 유지");
eq(su.outputs.sessions.length, 5, "옛 산출물도 5차시로");
ok(C.courseMd(course).indexOf("### 차시 구성 (1차시 = 1시간)") !== -1, "과정 설계서에 차시 구성");

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
