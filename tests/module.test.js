/* module.test.js — 학습모듈 작업(「콘텐츠 업무 설계」 5·6장) 로직 테스트
 *
 *   course-rules.js : 교재·문항 자동 검수, 단어 단위 비교, 코드 언어 추출
 *   course-model.js : 학습모듈 기본값·보정, 학습목표 삭제(번호 당김·문항 보존/삭제), 목표 없음 문항 처리
 *   course-ai-tb.js : 교재 초안·고정 칸·자동 수정 1회·부분 수정·NCS 요소 추천·이미지 글자 옮기기
 *   course-ai.js    : 문항 생성 프롬프트(기존 문항 중복 회피) · 정규화 · 검수 지적 문항 자동 수정
 * AI 호출(K.ai.call)은 프롬프트에 맞춘 가짜 응답으로 대체한다.
 *
 * 실행:  node tests/module.test.js   (성공 exit 0, 실패 exit 1)
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

const store = {};
const ctx = {
  console, setTimeout, Promise,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
};
ctx.window = ctx;
vm.createContext(ctx);
["ncs-catalog.js", "course-rules.js", "course-model.js", "course-sessions.js", "course-ai.js", "course-ai-tb.js", "course-ncs.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(ASSETS, f), "utf8"), ctx, { filename: f }));
const K = ctx.KBuilder;
const C = K.course, R = K.courseRules, TB = K.courseTB, AI = K.courseAI;

/* ---------- 가짜 AI ---------- */
let handler = () => "";
let calls = [];
let canUse = true;
K.ai = {
  call(prompt, opts) { calls.push({ prompt, opts: opts || {} }); return Promise.resolve().then(() => handler(prompt, opts || {}, calls.length)); },
  parseJson(t) {
    const s = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    return JSON.parse(s);
  },
  available: () => canUse,
  providerFor: () => "claude",
  providerLabel: () => "Claude"
};
function J(o) { return JSON.stringify(o); }
function reset(h) { calls = []; handler = h; }

const GOOD_TB = {
  overview: "요청마다 응답 형식이 달라지는 챗봇에서는 후처리 코드가 자주 실패합니다. 출력 형식을 고정하는 방법이 필요합니다.",
  objectives: ["시스템 프롬프트로 응답 역할과 형식을 고정한 지시문을 작성할 수 있다.", "출력 예시를 포함한 지시문으로 표 형식 응답을 받아 검증할 수 있다."],
  sections: [{ title: "역할 고정", body: "시스템 프롬프트는 대화 전체에 적용되는 지시입니다. 역할과 금지 사항을 먼저 씁니다." },
    { title: "형식 지정", body: "원하는 출력 예시를 함께 주면 형식이 안정됩니다.\n\n```python\nprint('ok')\n```" }],
  checklist: [{ text: "시스템 프롬프트에 역할과 형식을 고정할 수 있습니다.", ref: "학습내용 1" }, { text: "예시로 표 형식 응답을 받을 수 있습니다.", ref: "학습내용 2" }],
  illustrationIdeas: [{ section: 1, description: "지시문 상자에서 표 모양 응답이 나오는 그림" }, { section: 9, description: "범위 밖 번호" }]
};

(async () => {
  /* ================= 검수 규칙 ================= */
  const goodMod = { objectives: GOOD_TB.objectives, content: { overview: GOOD_TB.overview, sections: GOOD_TB.sections, checklist: GOOD_TB.checklist } };
  eq(R.lintTextbook(goodMod).filter((x) => x.sev === "bad").length, 0, "규칙을 지킨 교재는 필수 위반 없음");
  const badMod = JSON.parse(J(goodMod));
  badMod.objectives[0] = "프롬프트를 이해한다";
  badMod.content.overview = "앞에서 배운 내용처럼 여러분은 쉽게 할 수 있습니다.";
  badMod.content.checklist[1].ref = "";
  const I = R.lintTextbook(badMod);
  ok(I.some((x) => x.sev === "bad" && /수 있다/.test(x.msg)), "학습목표 어미 위반(필수)");
  ok(I.some((x) => x.sev === "bad" && /다른 학습모듈/.test(x.msg)), "'앞에서' → 다른 모듈 지칭(필수)");
  ok(I.some((x) => /호칭/.test(x.msg)) && I.some((x) => /당연하지 않은/.test(x.msg)), "'여러분'·'쉽게' 권장 위반");
  ok(I.some((x) => x.where === "체크리스트 2" && /다시 볼/.test(x.msg)), "체크리스트 다시 볼 곳 누락");
  const mis = JSON.parse(J(goodMod)); mis.content.sections.pop();
  ok(R.lintTextbook(mis).some((x) => /1:1/.test(x.msg)), "학습목표·학습내용 1:1 불일치");
  ok(/<del>b<\/del><ins>x<\/ins>/.test(R.wordDiff("a b c", "a x c")), "단어 단위 비교 표시");
  ok(R.wordDiff("<b>", "<i>").indexOf("<b>") === -1, "비교 결과는 HTML 이스케이프");
  eq(R.codeLangs(goodMod).join(","), "Python", "학습내용 코드 블록 언어 추출");

  /* ================= 모델: 학습모듈 · 목표 삭제 ================= */
  const nm = C.newModule({ title: "모듈" });
  ok(nm.status === "작성중" && Array.isArray(nm.tools) && nm.ncs && nm.changelog.length === 1, "새 학습모듈 기본값(상태·툴·NCS·이력)");
  const legacy = { v: 1, units: [{ id: "u1", title: "단원", hours: 1, modules: [{ id: "mx", title: "옛 모듈", minutes: 60, objectives: ["a"], flow: [], content: { overview: "", sections: [], checklist: ["설명할 수 있습니다."] }, questions: [] }] }] };
  C.ensureCourse(legacy);
  ok(Array.isArray(legacy.trash) && legacy.units[0].modules[0].status === "작성중", "예전 과정 보정(휴지통·상태)");
  eq(legacy.units[0].modules[0].content.checklist[0].ref, "학습내용 1", "예전 체크리스트에 다시 볼 곳 채움");

  function sample3() {
    const m = C.newModule({ title: "세 목표", objectives: ["목표 하나를 할 수 있다", "목표 둘을 할 수 있다", "목표 셋을 할 수 있다"] });
    m.content = { overview: "o", sections: [{ title: "s1", body: "" }, { title: "s2", body: "" }, { title: "s3", body: "" }],
      checklist: [{ text: "c1", ref: "학습내용 1" }, { text: "c2", ref: "학습내용 2" }, { text: "c3", ref: "학습내용 3" }] };
    m.questions = [1, 2, 3, 2].map((o, i) => C.newQuestion({ objective: o, stem: "q" + i }));
    m.ills = [{ id: "a", placement: 0 }, { id: "b", placement: 1 }, { id: "c", placement: 2 }];
    m.ncs.recs = [{ covers: [0, 2] }, { covers: [1] }];
    return m;
  }
  const d1 = C.deleteObjective(sample3(), 1, "keep");
  eq(d1.objectives.length, 2, "목표 삭제 → 2개");
  eq(d1.content.sections.map((s) => s.title).join(","), "s1,s3", "학습내용 세트 삭제");
  eq(d1.content.checklist[1].ref, "학습내용 2", "체크리스트 다시 볼 곳 번호 당김");
  eq(d1.questions.map((q) => q.objective).join(","), "1,,2,", "문항 연결 해제(목표 없음)·뒤 번호 당김");
  eq(d1.ills.map((x) => x.placement).join(","), "0,,1", "삽화 배치 해제·번호 당김");
  eq(J(d1.ncs.recs.map((r) => r.covers)), "[[0,1],[]]", "NCS 추천의 목표 대응 번호 당김");
  ok(/학습목표 2 삭제.*연결 해제/.test(d1.changelog[d1.changelog.length - 1].t), "변경 이력 기록");
  const d2 = C.deleteObjective(sample3(), 1, "delete");
  eq(d2.questions.length, 2, "문항도 함께 삭제");
  const dist = C.distribution(d1.questions, 2);
  eq(dist.rows[0].L1 + dist.rows[1].L1, 2, "목표 없음 문항은 분포에서 제외");
  const csv = C.questionsToCsv(d1.questions, { objectives: d1.objectives, module: d1 }).split("\r\n");
  ok(/^q_?[^,]*,,,,,/.test(csv[2].replace(/^﻿/, "")) || csv[2].split(",")[3] === "", "CSV: 목표 없음 문항은 목표번호·학습목표 비움");
  ok(R.lintQuestion(d1.questions[1], d1).some((x) => /학습목표가 없습니다/.test(x.msg)), "목표 없음 문항은 검수에서 지적");

  /* ================= 교재 AI ================= */
  const course = C.ensureCourse(C.buildCourse({ title: "생성형 AI 활용", units: ["프롬프트 설계"] }, 4, { target: "비전공 입문자", tool: "ChatGPT 웹" }));
  const unit = course.units[0];
  const m = unit.modules[0];
  m.title = "프롬프트 형식 고정"; m.objectives = ["형식을 고정할 수 있다"]; m.content = null;
  m.tools = [{ name: "ChatGPT", version: "2026-10" }]; m.prereqs = [{ id: null, name: "프롬프트 기초" }];

  const tb0 = TB.tbOf(m);
  ok(TB.isEmpty(tb0) && tb0.sections.length === 1 && tb0.checklist.length === 1, "빈 교재 객체 — 목표 수에 맞춘 칸");

  // (a) 초안: 바로 통과하면 1회 호출
  reset(() => J(GOOD_TB));
  let r = await AI.draftTextbook(course, unit, m, { notes: "출력 형식 고정", n: 2, level: "비전공 입문", length: "짧게 (약 400자)" });
  eq(calls.length, 1, "검수 통과 초안은 다시 고쳐 받지 않음");
  const p0 = calls[0].prompt;
  ok(/\[교재 작성 규칙/.test(p0) && /학습목표 수: 정확히 2개/.test(p0) && /프롬프트 형식 고정/.test(p0), "초안 프롬프트: 규칙·목표 수·모듈 이름");
  ok(/ChatGPT 2026-10/.test(p0) && /본문에 버전 번호를 쓰지 말 것/.test(p0), "초안 프롬프트: 툴·버전은 메타데이터");
  ok(/선행 학습모듈\(메타데이터 전용, 본문에서 언급 금지\): 프롬프트 기초/.test(p0), "초안 프롬프트: 선행 모듈 이름(언급 금지)");
  ok(/블록 설계에서 정한 학습목표/.test(p0) && /형식을 고정할 수 있다/.test(p0), "빈 교재면 블록 설계의 학습목표를 넘김");
  ok(/비전공 입문/.test(p0) && /짧게/.test(p0), "학습자 수준·분량 반영");
  eq(r.tb.objectives.length, 2, "초안 목표 2개");
  eq(r.ideas.length, 2, "삽화 아이디어");
  eq(r.ideas[1].section, 1, "삽화 아이디어 학습내용 번호는 범위 안으로");

  // (b) 검수에 걸리면 한 번 더 고쳐 받기 → 나아지면 교체
  const BAD = JSON.parse(J(GOOD_TB));
  BAD.objectives[0] = "프롬프트를 이해한다";
  BAD.overview = "앞에서 본 것처럼 여러분은 형식을 정해야 합니다.";
  reset((p, o, n) => (n === 1 ? J(BAD) : J(GOOD_TB)));
  r = await AI.draftTextbook(course, unit, m, { notes: "x", n: 2 });
  eq(calls.length, 2, "검수 지적 → 자동 수정 1회");
  ok(/\[지적된 문제\]/.test(calls[1].prompt) && /학습목표 1/.test(calls[1].prompt), "수정 요청에 지적 목록");
  eq(r.tb.objectives[0], GOOD_TB.objectives[0], "나아진 수정본으로 교체");
  // (c) 나아지지 않으면 원본 유지
  reset(() => J(BAD));
  r = await AI.draftTextbook(course, unit, m, { notes: "x", n: 2 });
  eq(r.tb.objectives[0], "프롬프트를 이해한다", "나아지지 않은 수정본은 버림");

  // (d) 고정 칸은 한 글자도 바뀌지 않음
  TB.applyTB(m, JSON.parse(J({ overview: GOOD_TB.overview, objectives: GOOD_TB.objectives, sections: GOOD_TB.sections, checklist: GOOD_TB.checklist })));
  const base = TB.tbOf(m);
  const CHANGED = JSON.parse(J(GOOD_TB));
  CHANGED.overview = "다른 개요입니다."; CHANGED.objectives[0] = "다른 목표를 작성할 수 있다."; CHANGED.sections[1].body = "새 본문입니다.";
  reset(() => J(CHANGED));
  r = await AI.draftTextbook(course, unit, m, { base, notes: "x", n: 2, locks: ["ov", "o0"] });
  eq(r.tb.overview, base.overview, "고정한 개요 유지");
  eq(r.tb.objectives[0], base.objectives[0], "고정한 학습목표 1 유지");
  eq(r.tb.sections[1].body, "새 본문입니다.", "고정하지 않은 칸은 새로 씀");
  ok(/\[고정\] 개요/.test(calls[0].prompt) && /\[다시 작성\] 학습목표 2/.test(calls[0].prompt), "프롬프트에 고정/다시 작성 표시");
  // (e) 고정 칸 번호가 목표 수보다 크면 목표 수를 늘림
  const THREE = JSON.parse(J(GOOD_TB));
  THREE.objectives.push("세 번째 목표를 작성할 수 있다."); THREE.sections.push({ title: "t3", body: "본문입니다." }); THREE.checklist.push({ text: "세 번째를 할 수 있습니다.", ref: "학습내용 3" });
  reset(() => J(THREE));
  r = await AI.draftTextbook(course, unit, m, { base, n: 2, locks: ["c2"] });
  ok(r.raised && r.n === 3 && /정확히 3개/.test(calls[0].prompt), "고정 칸이 학습목표 3번까지 → 3개로 생성");
  // (f) 한도 초과
  try { await AI.draftTextbook(course, unit, m, { notes: "가".repeat(120000), n: 2 }); ok(false, "한도 초과는 거절해야 함"); }
  catch (e) { ok(/한도/.test(e.message), "프롬프트 한도 초과 안내"); }

  // 부분 수정: 드래그한 부분
  const tbS = TB.tbOf(m);
  const at = tbS.overview.indexOf("후처리 코드");
  reset(() => J({ replacement: "결과 파싱" }));
  const sel = { field: "overview", i: 0, start: at, end: at + "후처리 코드".length, text: "후처리 코드", before: "", after: "", label: "개요" };
  let nx = await AI.editTextbook(course, unit, m, tbS, { sel, ins: "쉬운 말로" });
  ok(nx.overview.indexOf("결과 파싱가 자주") !== -1 && nx.overview.indexOf("후처리 코드") === -1, "드래그한 부분만 교체");
  ok(/【여기를 고침】/.test(calls[0].prompt) && /쉬운 말로/.test(calls[0].prompt), "선택 영역 프롬프트");
  // 부분 수정: 칸 고르기
  reset(() => J({ obj0: "새 목표를 작성할 수 있다.", ck1: { text: "새 점검 문장입니다." }, c0: { body: "새 본문" } }));
  nx = await AI.editTextbook(course, unit, m, tbS, { keys: ["obj0", "ck1", "c0"], ins: "다듬기" });
  eq(nx.objectives[0], "새 목표를 작성할 수 있다.", "고른 목표 칸 교체");
  eq(nx.checklist[1].ref, tbS.checklist[1].ref, "응답에 없는 하위 값(다시 볼 곳)은 유지");
  eq(nx.sections[0].title, tbS.sections[0].title, "응답에 없는 제목은 유지");
  eq(nx.objectives[1], tbS.objectives[1], "고르지 않은 칸은 그대로");
  // 규칙 위반 수정안
  const four = JSON.parse(J(base));
  four.objectives.push("넷", "다섯");
  reset(() => J(THREE));
  const fx = await AI.fixTextbook(course, unit, m, four, []);
  ok(fx.issues.length > 0 && fx.tb.objectives.length === 3, "수정안: 지적 목록 + 목표 3개 이하");
  ok(/핵심 3개로 줄입니다/.test(calls[0].prompt), "수정안 프롬프트: 4개 이상이면 3개로");

  // NCS 능력단위요소 추천
  const pick = K.NCS.units.find((u) => /프롬프트/.test(u[1]))[0];
  K.ncsRef.saveUnit({ code: pick, elements: [{ code: pick + ".1", name: "프롬프트 작성하기" }], verified: true });
  reset(() => J({ recs: [
    { unitCode: "", elementCode: pick + ".1", elementName: "프롬프트 작성하기", fit: 60, covers: [0], reason: "r1" },
    { unitCode: pick, unitName: "", fit: 92, covers: [0, 1], reason: "r2" },
    { unitCode: "", unitName: "목록 밖 후보", fit: 30, covers: [], reason: "r3" }], note: "메모" }));
  const rec = await AI.recommendElements(course, unit, m);
  eq(rec.recs[0].fit, 92, "적합도 내림차순");
  ok(rec.recs[0].unitName && rec.recs[0].unitName.length > 0, "능력단위명 비면 참조 목록에서 채움");
  eq(rec.recs[1].unitCode, pick, "요소 코드에서 능력단위 코드 유추");
  eq(rec.note, "메모", "추천 메모");
  ok(/\[참조 목록\]/.test(calls[0].prompt) && calls[0].prompt.indexOf(pick + ".1|프롬프트 작성하기") !== -1, "등록한 요소가 참조 목록에 들어감");
  eq(calls[0].opts.role, "plan", "NCS 추천은 plan 역할");
  canUse = false;
  const kw = await AI.recommendElements(course, unit, m);
  ok(kw.recs.length > 0 && /키워드/.test(kw.recs[0].reason), "AI 없으면 키워드 후보");
  canUse = true;

  // 이미지 글자 옮기기: 4장씩
  reset((p, o) => J(o.images.map((x, i) => "page" + x.data)));
  const pages = [1, 2, 3, 4, 5].map((n) => ({ n, image: { mime: "image/png", data: String(n) } }));
  const tr = await AI.transcribeImages(pages);
  eq(calls.length, 2, "5쪽 → 2번에 나눠 읽기");
  eq(tr.map((x) => x.text).join(","), "page1,page2,page3,page4,page5", "쪽 순서대로 글자");

  /* ================= 문항 생성 ================= */
  m.questions = [C.newQuestion({ objective: 1, stem: "기존 문항 XYZ 상황에서 고르시오.", choices: [{ text: "a", correct: true }] })];
  const qOk = { stem: "고객센터 챗봇이 표로 답하게 하려면 어떤 지시가 가장 적절한가요?", choices: [{ text: "예시 표를 함께 준다", correct: true }, { text: "아무 지시 없이 묻는다", correct: false }, { text: "답을 길게 쓰라고 한다", correct: false }, { text: "형식을 매번 바꾸라고 한다", correct: false }], explanation: "e" };
  const qBad = { stem: "다음 중 옳은 것은?", choices: [{ text: "가", correct: false }, { text: "가", correct: false }, { text: "나", correct: false }], explanation: "" };
  const qFixed = { no: 1, stem: "응답 형식이 흔들릴 때 먼저 할 일은 무엇인가요?", choices: [{ text: "출력 예시를 준다", correct: true }, { text: "온도를 최대로 올린다", correct: false }, { text: "질문을 짧게 줄인다", correct: false }, { text: "역할을 지운다", correct: false }], explanation: "e" };
  reset((p, o, n) => (n === 1 ? J([qOk, qBad]) : J([qFixed])));
  const qs = await AI.generateQuestions(course, unit, 0, { objective: 1, band: "L1", type: "객관식", multi: false, count: 2 });
  eq(calls.length, 2, "지적 문항이 있으면 한 번 더 고쳐 받기");
  ok(/이미 있는 문항 — 중복 금지/.test(calls[0].prompt) && /기존 문항 XYZ/.test(calls[0].prompt), "기존 문항을 넘겨 중복 회피");
  ok(/자동 검수 기준/.test(calls[0].prompt) && /정답이 될 수 있는 보기는 정확히 하나/.test(calls[0].prompt), "자기 점검 체크리스트");
  ok(/\[고칠 문항과 지적\]/.test(calls[1].prompt), "수정 요청 프롬프트");
  eq(qs.length, 2, "문항 2개");
  eq(qs[1].stem, qFixed.stem, "지적 문항을 수정본으로 교체");
  eq(qs.fixed, 1, "자동 수정 수");
  ok(qs.every((q) => R.lintQuestion(q, m).filter((x) => x.sev === "bad").length === 0), "결과 문항 필수 위반 없음");
  const mq = AI.toQuestion({ stem: "옳은 것을 고르시오.", choices: ["a", "b", " ", "a", "c"], answer: [1, 3] }, { objective: 1, band: "L1", type: "객관식", multi: true });
  eq(mq.choices.length, 3, "빈 보기·중복 보기 정리");
  eq(mq.stem, "옳은 것을 모두 고르시오.", "복수 정답 문항에 「모두 고르시오」");
  eq(mq.choices.filter((c) => c.correct).length, 2, "번호로 온 정답 반영");
  const sq = AI.toQuestion({ stem: "s", answer: "모범", rubric: [{ criterion: "c", points: 2 }], alts: ["x", "y"] }, { objective: 1, band: "L2", type: "서술형" });
  ok(sq.answer === "모범" && sq.rubric[0].points === 2 && sq.choices.length === 0, "서술형: 모범 답안 + 채점 요소");
  const fq = AI.toQuestion({ stem: "s", rubric: [{ criterion: "c", full: "f", partial: "p", none: "n", points: 3 }] }, { objective: 1, band: "L3", type: "파일제출" });
  ok(fq.rubric[0].full === "f" && fq.rubric[0].partial === "p" && fq.rubric[0].none === "n", "파일제출: 충족/부분/미흡");

  /* ================= 코드 리뷰 반영 회귀 테스트 ================= */
  // 목표 수가 줄면 없어진 번호의 연결을 푼다
  const tm = sample3(); tm.ideas = [{ section: 0, description: "a" }, { section: 2, description: "c" }];
  C.trimObjectiveRefs(tm, 2);
  eq(tm.questions.map((q) => q.objective).join(","), "1,2,,2", "목표 3 문항 → 목표 없음");
  eq(tm.ills.map((x) => x.placement).join(","), "0,1,", "학습내용 3 삽화 배치 해제");
  eq(J(tm.ncs.recs.map((r) => r.covers)), "[[0],[1]]", "NCS 대응에서 없어진 목표 제거");
  eq(tm.ideas.length, 1, "없어진 학습내용의 삽화 아이디어 제거");
  const di = sample3(); di.ideas = [{ section: 0, description: "a" }, { section: 1, description: "b" }, { section: 2, description: "c" }];
  C.deleteObjective(di, 1, "keep");
  eq(di.ideas.map((x) => x.section + x.description).join(","), "0a,1c", "목표 삭제 시 삽화 아이디어 번호 당김");
  // 교재.md 에 넣는 SVG: 괄호·대괄호가 마크다운 이미지 문법을 깨지 않게
  const uri = C.svgDataUri('<svg><g transform="rotate(45)"/></svg>');
  ok(uri.indexOf("(") === -1 && uri.indexOf(")") === -1, "SVG 데이터 URI 괄호 인코딩");
  const mm = C.newModule({ title: "삽화 모듈", objectives: ["가를 할 수 있다"] });
  mm.content = { overview: "o", sections: [{ title: "t", body: "b" }], checklist: [{ text: "c", ref: "학습내용 1" }] };
  mm.ills = [{ title: "그림", caption: "캡션 [1]\n둘째 줄", svg: '<svg><g transform="translate(1,2)"/></svg>', placement: 0 }];
  const ucourse = C.ensureCourse(C.buildCourse({ title: "t", units: ["u"] }, 2, {}));
  ucourse.units[0].modules = [mm];
  const tmd = C.textbookModuleMd(ucourse, ucourse.units[0], 0);
  ok(/!\[캡션 1 둘째 줄\]\(data:image\/svg\+xml;charset=utf-8,[^)\s]+\)/.test(tmd), "교재.md 삽화 이미지 문법 유지(대체 글자 정리)");
  // 블록 다시 설계: 새 블록은 학습모듈 기본 필드를 갖춤
  reset(() => J({ modules: [{ title: "블록 A", minutes: 120, objectives: ["가를 설명할 수 있다"], flow: [{ phase: "도입", title: "열기", minutes: 120 }] }] }));
  const pu = C.buildCourse({ title: "t", units: ["u"] }, 2, {}).units[0];
  await AI.planUnit({ title: "t", units: [pu], totalHours: 2 }, pu);
  ok(pu.modules[0].ncs && Array.isArray(pu.modules[0].ncs.chosen) && pu.modules[0].status === "작성중" && Array.isArray(pu.modules[0].ills), "다시 설계한 블록에 상태·NCS·삽화 필드");
  // 수정안: 목표 수가 줄어도 남는 번호의 고정 칸 유지
  const fourTb = JSON.parse(J(base)); fourTb.objectives.push("셋을 할 수 있다", "넷을 할 수 있다");
  fourTb.sections.push({ title: "", body: "" }, { title: "", body: "" }); fourTb.checklist.push({ text: "", ref: "" }, { text: "", ref: "" });
  reset(() => J(CHANGED));
  const fx2 = await AI.fixTextbook(course, unit, m, fourTb, ["ov", "o0"]);
  ok(fx2.tb.objectives.length === 2 && fx2.tb.overview === fourTb.overview && fx2.tb.objectives[0] === fourTb.objectives[0], "목표가 줄어도 고정 칸 유지");
  // 교차 검수 중 '중지'하면 문항을 넣지 않는다
  reset((p, o, n) => { if (/검수자/.test(p)) { const e = new Error("중지했습니다."); e.code = "cancelled"; return Promise.reject(e); } return J([qOk]); });
  const prevMixed = K.AI; K.AI = { isMixed: () => true };
  try { await AI.generateQuestions(course, unit, 0, { objective: 1, band: "L1", type: "객관식", multi: false, count: 1 }); ok(false, "중지가 전파되어야 함"); }
  catch (e) { eq(e.code, "cancelled", "교차 검수 중 중지 전파"); }
  K.AI = prevMixed;

  if (failures.length) {
    console.error("❌ 실패 " + failures.length + "건 (통과 " + passed + "건)");
    failures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("✅ 학습모듈 작업 테스트 전부 통과 — 단언 " + passed + "건");
})().catch((e) => { console.error(e); process.exit(1); });
