/* auto.test.js — 자동 단계 테스트
 *
 *   auto-images.js : 슬라이드 고르기 · 편성안 표시 달기 · 이미지 주소 풀기 · 자동 생성(같은 프롬프트 재사용·연속 실패 시 멈춤·키 없음)
 *   course-auto.js : NCS 자동 배정(교과목 능력단위·학습모듈 능력단위요소, 확정한 선택은 유지) · 삽화 자동 생성(배치·기준 삽화·취소 전달)
 *
 * 실행:  node tests/auto.test.js   (성공 exit 0, 실패 exit 1)
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

function sandbox() {
  const store = {};
  const ctx = {
    console,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}
function load(ctx, file) { vm.runInContext(fs.readFileSync(path.join(ASSETS, file), "utf8"), ctx, { filename: file }); }

(async function () {
  /* ================= auto-images.js ================= */
  const a = sandbox();
  load(a, "parser.js");
  load(a, "auto-images.js");
  const K = a.KBuilder, AI = K.autoImages;
  const deck = [
    "---", "주제: 생성형 AI", "---", "", "## 슬라이드 편성", "",
    "### 슬라이드 1 - 표지", "- 슬라이드 문구:", "  - (제목) 생성형 AI", "- 이미지/시각: 대표 일러스트", "",
    "### 슬라이드 2 - 목차", "- 슬라이드 문구:", "  - 흐름", "- 이미지/시각: 흐름 그래픽", "",
    "### 슬라이드 3 - 텍스트 생성", "- 슬라이드 문구:", "  - 문장", "- 이미지/시각: 말풍선을 이어 쓰는 로봇", "",
    "### 슬라이드 4 - 이미지 생성", "- 슬라이드 문구:", "  - 그림", "- 이미지/시각: 붓을 든 로봇", "",
    "### 슬라이드 5 - 음성 생성", "- 슬라이드 문구:", "  - 소리", "", "",
    "### 슬라이드 6 - 영상 생성", "- 슬라이드 문구:", "  - 영상", "- 이미지/시각: 필름 롤과 로봇", "",
    "### 슬라이드 7 - 마무리", "- 슬라이드 문구:", "  - (큰 문구) 끝", "- 이미지/시각: 다음 장면"
  ].join("\n");
  const slides = K.parseDeck(deck).slides;
  const picked = AI.pick(slides, 2);
  eq(picked.length, 2, "시각 제안이 있는 내용 슬라이드에서 2장");
  ok(picked.every((p) => !/^(cover|toc|closing)$/.test(p.s.kind) && p.s.visual), "표지·목차·마무리·시각 없는 슬라이드는 고르지 않음");
  eq(AI.pick(slides, 9).length, 3, "후보보다 많이 달라면 후보 전부(3장)");
  const tagged = AI.tagDeck(deck, [{ slide: 3, id: "x1" }]);
  ok(/- 이미지\/시각: 붓을 든 로봇 \[이미지:x1\]/.test(tagged), "4번째 슬라이드 시각 줄에 [이미지:id]");
  eq((tagged.match(/\[이미지:/g) || []).length, 1, "표시는 한 곳에만");
  eq(AI.resolveVisual("붓을 든 로봇 ![](data:image/png;base64,QQ==)").src, "data:image/png;base64,QQ==", "시각 제안의 이미지 주소를 칸에 채움");
  eq(AI.resolveVisual("붓을 든 로봇 [이미지:없는id]").text, "붓을 든 로봇", "모르는 표시는 지우고 설명만 남김");

  // 키 없음 → 건너뜀
  K.AI = { hasKey: () => false };
  K.genImage = () => Promise.resolve("data:image/png;base64,AA");
  const nokey = await AI.run([{ label: "1부", deckMd: deck }]);
  eq(nokey.skipped, "nokey", "Google 키가 없으면 건너뜀");
  eq(nokey.parts[0].deckMd, deck, "키가 없으면 편성안 그대로");

  // 키 있음 → 부마다 2장, 참고 이미지에도 추가, 같은 프롬프트는 다시 만들지 않음
  K.AI = { hasKey: () => true };
  let calls = 0;
  K.genImage = (p) => { calls++; return Promise.resolve("data:image/png;base64,IMG" + calls); };
  const refs = [];
  K.refImagesAddUrl = (url, name) => refs.push({ url, name });
  K.recommendImagePrompt = (c) => c.visual + " / " + c.title;
  AI.setCount(2);
  const r1 = await AI.run([{ label: "1부", title: "생성형 AI", deckMd: deck }]);
  eq(r1.made, 2, "이미지 2장 생성");
  eq(refs.length, 2, "만든 이미지를 참고 이미지에 추가");
  eq((r1.parts[0].deckMd.match(/\[이미지:ai[\w-]+\]/g) || []).length, 2, "편성안에 이미지 표시 2개");
  const renderedSrc = K.parseDeck(r1.parts[0].deckMd).slides.map((s) => AI.resolveVisual(s.visual).src).filter(Boolean);
  eq(renderedSrc.length, 2, "표시가 이미지 주소로 풀림");
  const r2 = await AI.run([{ label: "1부", title: "생성형 AI", deckMd: deck }]);
  eq(calls, 2, "같은 프롬프트는 이 창에서 다시 만들지 않음");
  eq(r2.made, 2, "다시 빌드해도 같은 이미지 2장");
  AI.setCount(0);
  eq((await AI.run([{ deckMd: deck }])).skipped, "off", "설정이 '끔'이면 건너뜀");
  // 계속 실패하면 두 번에서 멈춤
  AI.setCount(8);
  let tries = 0;
  K.genImage = () => { tries++; return Promise.reject(new Error("403")); };
  const bad = await AI.run([{ deckMd: deck.replace(/로봇/g, "기계") }]);
  eq(tries, 2, "처음부터 두 번 연속 실패하면 남은 이미지는 건너뜀");
  eq(bad.made, 0, "실패 시 표시 없음");
  ok(/실패 2장/.test(AI.summary(bad)) && /만들지 못했습니다/.test(AI.summary(bad)), "모두 실패하면 '만들지 못했습니다' + 실패 수");
  // 한 장 성공 뒤 연달아 두 번 실패해도 멈춤 (할당량 초과 등)
  let t2 = 0;
  K.genImage = () => { t2++; return t2 === 1 ? Promise.resolve("data:image/png;base64,OK") : Promise.reject(new Error("429")); };
  const quota = await AI.run([{ deckMd: deck.replace(/로봇/g, "인형") }]);
  eq(t2, 3, "성공 1번 뒤 연달아 2번 실패하면 남은 이미지는 건너뜀");
  ok(quota.stopped && quota.made === 1, "멈춤 표시와 만든 수");
  // 건너뛰기·중지 — 새 이미지는 시작하지 않고, 만들던 이미지는 넣는다
  AI.setCount(4);
  let stopNow = false, late = 0;
  K.genImage = () => { late++; stopNow = true; return Promise.resolve("data:image/png;base64,LATE"); };
  const sk = await AI.run([{ deckMd: deck.replace(/로봇/g, "곰") }], null, () => stopNow);
  ok(late === 1 && sk.made === 1 && sk.cancelled, "건너뛰면 만들던 이미지까지 넣고 끝냄");
  ok(/남은 이미지는 건너뛰었습니다/.test(AI.summary(sk)), "요약에 건너뜀 안내");
  // 생성 취소 — 늦게 도착한 이미지는 넣지 않음
  let dropNow = false;
  const refsBeforeCancel = refs.length;
  K.genImage = () => { dropNow = true; return Promise.resolve("data:image/png;base64,DROP"); };
  const cx = await AI.run([{ deckMd: deck.replace(/로봇/g, "여우") }], null, () => dropNow, () => dropNow);
  ok(cx.made === 0 && cx.cancelled, "생성을 취소하면 늦게 온 이미지도 넣지 않음");
  eq(refs.length, refsBeforeCancel, "취소 뒤 도착한 이미지는 참고 이미지에도 넣지 않음");
  // 미리 세기 — 이미 만든 프롬프트는 빼고
  K.genImage = () => Promise.resolve("data:image/png;base64,NEW");
  AI.setCount(2);
  eq(AI.countJobs([{ title: "생성형 AI", deckMd: deck }]), 0, "이 창에서 이미 만든 이미지는 다시 세지 않음");
  eq(AI.countJobs([{ deckMd: deck.replace(/로봇/g, "사자") }]), 2, "새로 만들 이미지 수");
  // 표시 → 그림 (내려받은 MD 에 그림이 남게)
  const exp = AI.expandTags(r1.parts[0].deckMd + "\n- 이미지/시각: 없는 표시 [이미지:zzz]");
  ok(/!\[이미지\]\(data:image\/png;base64,IMG/.test(exp) && !/\[이미지:/.test(exp), "표시를 그림으로 바꾸고 모르는 표시는 지움");
  eq(AI.resolveVisual("x [이미지:constructor]").src, "", "객체 기본 속성 이름의 표시는 이미지로 풀지 않음");
  // 이미지 칸이 없는 레이아웃은 고르지 않음 (렌더러 판단 사용)
  K.slideShowsImage = (s) => s.title !== "이미지 생성";
  ok(AI.pick(slides, 9).every((p) => p.s.title !== "이미지 생성"), "이미지 칸이 없는 슬라이드는 건너뜀");
  delete K.slideShowsImage;

  /* ================= course-auto.js ================= */
  const c = sandbox();
  load(c, "ncs-catalog.js");
  load(c, "course-rules.js");
  load(c, "course-model.js");
  const CK = c.KBuilder;
  load(c, "course-auto.js");
  const CA = CK.courseAuto;
  const C = CK.course;

  const picks = (scores) => CA.topPicks(scores.map((s, i) => ({ c: "u" + i, s })), (r) => r.s, (r) => r.c).map((r) => r.c).join(",");
  eq(picks([90, 75, 72, 71]), "u0,u1,u2", "적합도 70점 이상 높은 순 최대 3개");
  eq(picks([55, 60]), "u1", "70점 이상이 없으면 40점 이상 1위 하나");
  eq(picks([30]), "", "40점 미만뿐이면 배정하지 않음");

  let recCalls = 0;
  CK.courseAI = {
    recommendNcs: () => { recCalls++; return Promise.resolve([
      { code: "2001070705_25v1", name: "프롬프트 구현", level: 5, score: 88, objectives: ["1.1"], reason: "근거" },
      { code: "2001070701_25v1", name: "생성형AI 서비스 기획", level: 5, score: 74 },
      { code: "0501020101_23v1", name: "기타", level: 3, score: 41 }]); },
    recommendElements: () => Promise.resolve({ recs: [
      { unitCode: "2001070705_25v1", unitName: "프롬프트 구현", elementCode: "2001070705_25v1.1", elementName: "프롬프트 설계하기", fit: 91 },
      { unitCode: "2001070705_25v1", unitName: "프롬프트 구현", elementCode: "", elementName: "", fit: 52 }], note: "메모" }),
    drawSvg: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#F6F4EE"/></svg>')
  };
  CK.courseArt = { DEFAULT_ART: { name: "기본", palette: [{ role: "바탕", hex: "#F6F4EE" }], stroke: 2.5, anchorId: null, anchorSvg: null },
    sanitizeSvg: (s) => s, snapPalette: (s) => s };
  CK.courseTB = { tbOf: (m) => ({ sections: (m.content && m.content.sections) || [] }) };
  CK.ai = { available: () => true };

  const course = C.buildCourse(C.parseTopicInput("과정\n- 생성형 AI의 종류\n- LLM"), 10);
  const u = course.units[0];
  eq(await CA.assignUnit(course, u), true, "교과목 능력단위 자동 배정");
  eq(u.ncs.map((n) => n.code).join(","), "2001070705_25v1,2001070701_25v1", "70점 이상 두 개를 배정");
  ok(u.ncsAuto === true && u.ncsDraft.length === 3, "확정 전 표시 + 추천 목록 보관");
  eq(u.ncs[0].reason, "근거", "배정 항목에 근거 유지");
  u.ncsAuto = false; // 사용자가 확정
  eq(await CA.assignUnit(course, u), false, "확정한 선택은 다시 자동 배정하지 않음");
  eq(recCalls, 1, "확정 뒤에는 추천을 다시 부르지 않음");
  const all = await CA.assignUnits(course);
  eq(all.ok, 1, "과정 전체 자동 배정 — 확정 안 된 단원만");

  const m = u.modules[0];
  m.objectives = ["프롬프트를 역할·맥락·형식으로 작성할 수 있다", "출력 형식을 표로 고정할 수 있다"];
  m.content = { overview: "o", sections: [{ title: "역할 지정", body: "본문 1" }, { title: "형식 고정", body: "본문 2" }], checklist: [] };
  m.ills = [{ id: "old", placement: 1, svg: "<svg/>" }];
  eq(await CA.assignModule(course, u, m), true, "학습모듈 능력단위요소 자동 배정");
  eq(m.ncs.chosen.join(","), "2001070705_25v1.1", "요소 코드(없으면 단위 코드)로 배정");
  ok(m.ncs.auto === true && m.ncs.note === "메모", "확정 전 표시 + 메모 보관");
  m.ncs.auto = false;
  eq(await CA.assignModule(course, u, m), false, "확정한 학습모듈은 다시 배정하지 않음");

  const made = await CA.illustrate(course, u, m);
  eq(made, 1, "삽화가 없는 학습내용에만 삽화 생성");
  const fresh = m.ills.filter((x) => x.auto)[0];
  ok(fresh && fresh.placement === 0 && fresh.caption === "역할 지정", "새 삽화를 그 학습내용에 배치하고 캡션을 담");
  eq(course.art && course.art.anchorId, fresh && fresh.id, "기준 삽화가 없으면 첫 자동 삽화를 기준으로");
  ok(/삽화 자동 생성 1개/.test(m.changelog.map((x) => x.t).join("|")), "변경 이력에 기록");
  eq(await CA.illustrate(course, u, m), 0, "모든 학습내용에 삽화가 있으면 더 그리지 않음");
  course.auto = { art: false };
  m.ills = [];
  eq(await CA.illustrate(course, u, m), 0, "설정에서 끄면 삽화를 그리지 않음");
  course.auto = { art: true };
  CK.courseAI.drawSvg = () => Promise.reject(Object.assign(new Error("중지"), { code: "cancelled" }));
  let cancelled = false;
  await CA.illustrate(course, u, m).catch((e) => { cancelled = e.code === "cancelled"; });
  ok(cancelled, "중지하면 남은 삽화 생성도 멈추고 중지를 알림");
  CK.courseAI.drawSvg = () => Promise.reject(new Error("SVG 실패"));
  eq(await CA.illustrate(course, u, m), 0, "한 장 실패는 건너뛰고 계속");

  /* ---------- 기존에 써 둔 교재 보강 (새 기능을 예전 내용에도, 학습모듈마다 한 번) ---------- */
  CK.courseAI.drawSvg = () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#F6F4EE"/></svg>');
  CK.courseAI.hasTextbook = (mm) => !!(mm.content && (mm.content.overview || (mm.content.sections || []).some((s) => s.body)));
  CK.courseAI.buildOutputs = (cc, uu) => { uu.rebuilt = (uu.rebuilt || 0) + 1; };
  const oc = C.buildCourse(C.parseTopicInput("과정\n- 예전 단원 가\n- 예전 단원 나"), 8); // 단원마다 4시간 = 블록 2개
  const ou = oc.units[0], om = ou.modules[0];
  om.objectives = ["예전 교재의 핵심을 설명할 수 있다."];
  om.content = { overview: "예전 개요", sections: [{ title: "예전 내용", body: "예전 본문" }], checklist: [], guide: ["지침"] };
  ou.outputs = { v: 2, sessions: [] };
  ok(CA.needsFill(oc, om), "예전 교재(삽화·NCS 없음)는 보강 대상");
  ok(!CA.needsFill(oc, ou.modules[1]), "교재가 없는 블록은 보강 대상이 아님(교안 작성 대상)");
  const ew = CA.existingWork(oc);
  ok(ew.units.length === 2 && ew.modules.length === 1, "보강 대상: NCS 없는 단원 2 + 예전 교재 1");
  const ar = await CA.applyExisting(oc, null, () => {});
  ok(ar.units === 2 && ar.modules === 1 && ar.fail === 0, "기존 내용 보강 실행");
  ok(om.ills.some((x) => x.auto && x.placement === 0), "예전 교재에 삽화를 그려 배치");
  ok(om.ncs.chosen.length > 0 && om.ncs.auto === true, "예전 학습모듈에 능력단위요소 자동 배정(확정 전)");
  ok(oc.units.every((x) => x.ncs.length > 0 && x.ncsAuto), "예전 단원에 능력단위 자동 배정(확정 전)");
  eq(ou.rebuilt, 1, "조립해 둔 산출물은 다시 조립");
  eq(CA.existingWork(oc).modules.length + CA.existingWork(oc).units.length, 0, "보강은 한 번만 — 다시 대상이 되지 않음");
  om.ills = []; // 사용자가 삽화를 지워도
  ok(!CA.needsFill(oc, om), "지운 삽화를 다시 그리지 않음");

  console.log(`auto.test.js: ${passed} 통과, ${failures.length} 실패`);
  if (failures.length) { failures.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
