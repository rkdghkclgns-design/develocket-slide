/* auto.test.js — 자동 단계 테스트
 *
 *   auto-images.js : 슬라이드 고르기 · 편성안 표시 달기 · 이미지 주소 풀기 · 자동 생성(같은 프롬프트 재사용·연속 실패 시 멈춤·키 없음)
 *                    내용에 맞는 프롬프트(막연한 시각 제안 대신 슬라이드 내용) · 교수안(대응 단계)·교안(같은 내용 소제목) 본문에 넣기 · 교안 그림 재사용
 *   course-auto.js : NCS 자동 배정(교과목 능력단위·학습모듈 능력단위요소, 확정한 선택은 유지) · 삽화 자동 생성(배치·기준 삽화·취소 전달)
 *   lesson-images.js : 교안 본문 이미지(소제목 고르기·생성·소제목 아래 배치·빼기·다시 만들기·기존 교재 보강)
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

  /* ================= 내용에 맞는 이미지 + MD 본문에 넣기 (auto-images.js) ================= */
  const b = sandbox();
  load(b, "parser.js");
  load(b, "generate.js");
  load(b, "auto-images.js");
  const BK = b.KBuilder, BA = BK.autoImages;
  BK.AI = { hasKey: () => true };
  const prompts = [];
  BK.genImage = (p) => { prompts.push(p); return Promise.resolve("data:image/png;base64,P" + prompts.length); };
  BA.setCount(4);
  const sdeck = [
    "---", "주제: 생성형 AI 기초", "---", "", "## 슬라이드 편성", "",
    "### 슬라이드 1 - 표지", "- 대응 교수안: -", "- 슬라이드 문구:", "  - (제목) 생성형 AI", "- 이미지/시각: 차시 주제를 상징하는 대표 일러스트", "",
    "### 슬라이드 2 - 학습목표: 생성형 AI의 종류", "- 대응 교수안: 도입", "- 슬라이드 문구:", "  - 종류를 구분할 수 있다", "- 이미지/시각: 목표 체크 아이콘", "",
    "### 슬라이드 3 - 머신러닝과 딥러닝", "- 대응 교수안: 전개 1", "- 슬라이드 문구:", "  - 머신러닝은 데이터에서 규칙을 배웁니다", "  - 딥러닝은 신경망을 깊게 쌓은 방법입니다", "- 이미지/시각: 관련 이미지", "",
    "### 슬라이드 4 - 텍스트 생성 모델", "- 대응 교수안: 전개 2", "- 슬라이드 문구:", "  - 다음 단어를 예측해 문장을 이어 씁니다", "- 이미지/시각: 말풍선을 이어 쓰는 로봇", "",
    "### 슬라이드 5 - 체크리스트: 생성형 AI의 종류", "- 대응 교수안: 정리", "- 슬라이드 문구:", "  - 확인", "- 이미지/시각: 체크리스트", ""
  ].join("\n");
  eq(BA.pick(BK.parseDeck(sdeck).slides, 9).map((p) => p.s.title).join(","), "머신러닝과 딥러닝,텍스트 생성 모델", "학습목표·체크리스트 같은 꾸밈 슬라이드는 고르지 않음");
  const sdoc = ["# 교수안", "", "## 진행", "", "### 도입 - 동기 유발 (5분)", "", "설명", "", "### 전개 10 - 다른 단계 (5분)", "", "설명",
    "", "### 전개 1 - 머신러닝과 딥러닝 (20분)", "", "**설명 내용**: 관계", "", "### 전개 2 - 텍스트 생성 (20분)", "", "설명"].join("\n");
  const stext = ["# 생성형 AI의 종류 개요", "", "## 학습 목표", "", "- 종류를 구분할 수 있다", "", "# AI의 범위", "",
    "## 머신러닝과 딥러닝", "- 머신러닝은 데이터에서 규칙을 배웁니다.", "- 딥러닝은 신경망을 깊게 쌓은 방법입니다.", "", "## 텍스트 생성 모델", "- 다음 단어를 예측해 문장을 이어 씁니다."].join("\n");
  const sr = await BA.run([{ label: "1차시", title: "생성형 AI", deckMd: sdeck, docMd: sdoc, textMd: stext }]);
  eq(sr.made, 2, "내용 슬라이드 2장 생성");
  ok(prompts.every((p) => !/관련 이미지|목표 체크/.test(p)), "막연한 시각 제안('관련 이미지')은 프롬프트에 쓰지 않음");
  ok(/^머신러닝과 딥러닝/.test(prompts[0]) && /딥러닝은 신경망을 깊게 쌓은 방법입니다/.test(prompts[0]), "프롬프트를 슬라이드 제목과 핵심 내용으로");
  ok(/^말풍선을 이어 쓰는 로봇/.test(prompts[1]) && /주제: 텍스트 생성 모델/.test(prompts[1]), "구체적인 시각 제안은 그대로 앞에 + 슬라이드 주제");
  ok(prompts.every((p) => /생성형 AI 기초/.test(p) && /상관없는/.test(p)), "강의 주제 + 내용과 상관없는 그림 금지");
  const sp = sr.parts[0];
  const dl = sp.docMd.split("\n");
  const i1 = dl.findIndex((l) => /^### 전개 1 -/.test(l)), i10 = dl.findIndex((l) => /^### 전개 10/.test(l));
  ok(/^\[이미지:ai[\w-]+\]$/.test(dl[i1 + 2]), "교수안: 대응 단계(전개 1) 제목 아래에 이미지 줄");
  ok(!/\[이미지:/.test(dl[i10 + 2] || ""), "전개 10 에는 넣지 않음");
  const byLabel = BA.placeDoc(sdoc, [{ id: "zz", title: "전혀 다른 말", text: "", maps: "전개 1" }]).split("\n");
  eq(byLabel[byLabel.indexOf("[이미지:zz]") - 2], "### 전개 1 - 머신러닝과 딥러닝 (20분)", "내용이 같은 단계가 없으면 '대응 교수안' 단계 아래 (전개 10 을 전개 1 로 보지 않음)");
  ok(BA.placeDoc(sdoc, [{ id: "yy", title: "전혀 다른 말", text: "", maps: "도입" }]).indexOf("[이미지:yy]") === -1, "도입·정리 단계에는 내용 그림을 억지로 넣지 않음");
  eq((sp.docMd.match(/\[이미지:/g) || []).length, 2, "교수안에 슬라이드 이미지 2장");
  const tl = sp.textMd.split("\n");
  const h1 = tl.indexOf("## 머신러닝과 딥러닝"), h2 = tl.indexOf("## 텍스트 생성 모델");
  ok(/^\[이미지:/.test(tl[h1 + 2]) && /^\[이미지:/.test(tl[h2 + 2]), "교안: 내용이 같은 소제목 바로 아래에 이미지 줄");
  ok(!/\[이미지:/.test(tl.slice(0, tl.indexOf("# AI의 범위")).join("\n")), "내용이 다른 제목에는 넣지 않음");
  const sx = BA.expandTags(sp.textMd);
  ok(/\n## 머신러닝과 딥러닝\n\n!\[머신러닝과 딥러닝\]\(data:image\/png;base64,P\d\)\n/.test(sx), "본문 표시는 제 줄에서 그림으로(제목 줄은 그대로, 대체 글자 = 슬라이드 제목)");
  ok(!/\[이미지:/.test(BA.expandTags("## 제목\n\n[이미지:없는것]\n\n- 글")), "모르는 본문 표시는 지움");
  // 교안 본문 이미지와 내용이 같은 슬라이드는 새로 만들지 않고 그 그림을 쓴다
  const pid = BA.put("data:image/png;base64,PHOTO", "머신러닝과 딥러닝", "교안 프롬프트", true);
  const shots = prompts.length;
  const photoImgs = [{ id: pid, title: "머신러닝과 딥러닝", text: "딥러닝은 신경망을 깊게 쌓은 방법입니다." }];
  eq(BA.countJobs([{ deckMd: sdeck, images: photoImgs }]), 0, "미리 세기: 교안 그림으로 채우는 슬라이드·이미 만든 프롬프트는 빼고");
  const rr = await BA.run([{ title: "생성형 AI", deckMd: sdeck.replace(/로봇/g, "곰"), docMd: sdoc, textMd: stext, images: photoImgs }]);
  eq(prompts.length - shots, 1, "교안 그림을 쓴 슬라이드는 새로 만들지 않음 (1장만 생성)");
  ok(rr.reused === 1 && rr.parts[0].deckMd.indexOf("[이미지:" + pid + "]") !== -1, "그 슬라이드에 교안 그림 표시");
  ok(/교안 본문 이미지 1장/.test(BA.summary(rr)), "요약에 교안 그림 재사용 안내");
  const pid2 = BA.put("data:image/png;base64,PH2", "텍스트 생성", "교안 프롬프트2", true);
  const ro = await BA.run([{ deckMd: "## 슬라이드 편성\n\n### 슬라이드 1 - 표지\n- 슬라이드 문구:\n  - (제목) x\n- 이미지/시각: 대표 일러스트", docMd: sdoc,
    images: [{ id: pid2, title: "텍스트 생성", text: "다음 단어를 예측해 문장을 이어 씁니다." }, { id: "없는그림", title: "도입", text: "" }] }]);
  const rl = ro.parts[0].docMd.split("\n");
  eq(rl[rl.indexOf("[이미지:" + pid2 + "]") - 2], "### 전개 2 - 텍스트 생성 (20분)", "슬라이드에 쓰지 않은 교안 그림도 내용이 같은 교수안 단계 아래에");
  ok(ro.parts[0].docMd.indexOf("없는그림") === -1, "보관소에 없는 그림은 넣지 않음");
  // 코드 블록 속 '# 주석'은 제목이 아니다
  const codeMd = ["# 변수 선언", "- 값을 이름에 담습니다.", "```python", "# 변수 선언 예시", "x = 1", "```", "", "# 반복문", "- 같은 일을 되풀이합니다."].join("\n");
  const cp = BA.placeText(codeMd, [{ id: "cc", title: "변수 선언 예시", text: "" }]).split("\n");
  const ci = cp.indexOf("[이미지:cc]");
  ok(ci !== -1 && cp[ci - 2] === "# 변수 선언" && cp.indexOf("```python") > ci, "코드 블록 안 주석 줄이 아니라 진짜 제목 아래에 넣음");
  // 정리: 고정(교안) 그림은 세지 않고, 방금 만든 그림은 지우지 않음
  const pins = [];
  for (let i = 0; i < BA.KEEP; i++) pins.push(BA.put("data:image/png;base64,PIN" + i, "핀" + i, "", true));
  const fresh1 = BA.put("data:image/png;base64,FRESH", "새 그림", "새 프롬프트", false);
  ok(BA.has(fresh1) && pins.every((id) => BA.has(id)), "교안에 고정한 그림이 많아도 방금 만든 그림은 남음");
  BA.releasePinned(pins.slice(0, 3));
  ok(BA.has(pins[0]) && !BA.has(pins[5]) && BA.has(fresh1), "과정이 쓰지 않는 고정 그림만 정리(고정 안 한 그림은 그대로)");

  /* ================= 교안 본문 이미지 (lesson-images.js · course-model placePhotos) ================= */
  load(c, "auto-images.js");
  load(c, "lesson-images.js");
  const LI = CK.lessonImages;
  CK.AI = { hasKey: () => true };
  const lcalls = [];
  CK.genImage = (p) => { lcalls.push(p); return Promise.resolve("data:image/png;base64,L" + lcalls.length); };
  CK.recommendImagePrompt = (x) => "P:" + x.title + "|" + x.subject + "|" + (x.points || []).join("/");
  const pm = C.newModule({ title: "생성형 AI의 종류" });
  pm.objectives = ["생성형 AI의 종류를 구분할 수 있다.", "LLM 의 동작을 설명할 수 있다."];
  pm.content = { overview: "- 개요", sections: [
    { title: "생성형 AI의 종류", body: "## 텍스트 생성\n- 문장을 이어 씁니다.\n- 요약과 번역을 합니다.\n\n## 이미지 생성\n- 그림을 그립니다." },
    { title: "LLM", body: "LLM은 다음 단어를 예측합니다. 많은 글을 학습합니다." }], checklist: [] };
  u.modules.push(pm);
  const pmi = u.modules.length - 1;
  const tg = LI.targets(pm);
  eq(tg.map((t) => t.sec + ":" + (t.sub || "-")).join(","), "0:텍스트 생성,1:-", "학습내용마다 내용이 가장 많은 소제목 하나(없으면 학습내용 전체)");
  ok(tg[0].points.length === 2 && /문장을 이어 씁니다/.test(tg[0].points[0]), "그 소제목의 글머리를 프롬프트 재료로");
  ok(LI.needs(pm), "교재가 있고 본문 이미지가 없으면 만들 대상");
  const lr = await LI.generate(course, u, pm);
  eq(lr.made, 2, "학습내용마다 그림 하나씩");
  ok(lcalls[0].indexOf("P:텍스트 생성|") === 0 && /생성형 AI의 종류/.test(lcalls[0]) && /문장을 이어 씁니다/.test(lcalls[0]), "프롬프트: 소제목 + 과정·블록·학습내용 + 글머리");
  ok(pm.photos.length === 2 && pm.photos[0].sub === "텍스트 생성" && pm.photos[0].sec === 0 && pm.autoPhotoDone, "블록에 저장(학습내용·소제목) + 한 번 돌았음 표시");
  ok(!LI.needs(pm), "다 넣은 뒤에는 대상이 아님");
  const tmd = C.textbookModuleMd(course, u, pmi), tml = tmd.split("\n");
  eq(tml[tml.indexOf("## 텍스트 생성") + 2], "[이미지:" + pm.photos[0].id + "]", "교안 MD: 소제목 바로 아래에 이미지 줄");
  ok(tmd.indexOf("[이미지:" + pm.photos[1].id + "]") > tmd.indexOf("# LLM"), "소제목이 없는 학습내용은 그 학습내용 맨 위");
  ok(/\n!\[텍스트 생성\]\(data:image\/png;base64,L1\)\n/.test(CK.autoImages.expandTags(tmd)), "교안 MD 를 풀면 소제목 아래 그림");
  const fsx = LI.forSession(u, { mods: [pm.id] });
  ok(fsx.length === 2 && fsx[0].title === "텍스트 생성" && /문장을/.test(fsx[0].text), "차시(블록 id)에 걸친 블록의 교안 그림 목록");
  eq(LI.forSession(u, { mods: [pmi] }).length, 2, "블록 번호로 된 차시도");
  // 같은 그림을 다른 블록도 쓰면(같은 프롬프트) 한 블록에서 빼도 보관소에는 남는다
  const twin = C.newModule({ title: "쌍둥이" });
  twin.photos = [Object.assign({}, pm.photos[0])];
  course.trash = [{ at: Date.now(), module: twin }];
  const gone = pm.photos[0].id;
  ok(LI.remove(course, pm, gone) && pm.photos.length === 1 && CK.autoImages.has(gone), "빼기 — 휴지통의 다른 블록이 같은 그림을 쓰면 보관소에 남김");
  course.trash = [];
  LI.gc(course);
  ok(!CK.autoImages.has(gone), "아무도 쓰지 않게 되면 저장할 때 보관소에서도 지움");
  ok(C.textbookModuleMd(course, u, pmi).indexOf(gone) === -1, "뺀 그림은 교안에서 사라짐");
  ok(!LI.needs(pm) && LI.missing(pm).length === 1, "뺀 자리는 자동으로 다시 만들지 않지만 직접 채울 수 있게 셈");
  const keep = pm.photos[0].id;
  ok(await LI.redo(course, u, pm, keep) && pm.photos[0].id !== keep && !CK.autoImages.has(keep), "다시 만들기 — 같은 자리에 새 그림, 예전 그림은 지움");
  C.deleteObjective(pm, 0, "keep");
  ok(pm.photos.length === 1 && pm.photos[0].sec === 0, "학습목표를 지우면 본문 이미지 번호도 당김");
  CK.autoImages.setCount(0);
  ok(!LI.enabled(), "이미지 자동 생성이 '끔'이면 만들지 않음");
  CK.autoImages.setCount(4);
  const am = C.newModule({ title: "새 블록" });
  am.objectives = ["형식을 고정할 수 있다."];
  am.content = { overview: "- 개요", sections: [{ title: "형식 고정", body: "## 표로 고정\n- 열 이름을 정합니다." }], checklist: [] };
  const at = await CA.afterTextbook(course, u, am);
  eq(at.photos, 1, "교재를 쓴 직후 본문 이미지도 넣음");
  const om2 = C.newModule({ title: "예전 블록" });
  om2.objectives = ["예전 내용을 설명할 수 있다."];
  om2.content = { overview: "- 개요", sections: [{ title: "예전", body: "- 예전 본문입니다." }], checklist: [] };
  om2.autoArtDone = true; om2.ncs.autoTried = true;
  ok(CA.needsFill(course, om2) && CA.needsPhotos(om2), "예전 교재도 본문 이미지가 없으면 보강 대상");
  eq((await CA.fillModule(course, u, om2)).photos, 1, "기존 교재 보강으로 본문 이미지를 채움");
  // 연달아 실패해 멈춰도 자동 보강은 한 번만 (매번 다시 시도하지 않음) — 직접 채우기는 가능
  const fm = C.newModule({ title: "실패 블록" });
  fm.objectives = ["가", "나"];
  fm.content = { overview: "- 개요", sections: [{ title: "가", body: "## 가1\n- 가 본문" }, { title: "나", body: "## 나1\n- 나 본문" }], checklist: [] };
  CK.genImage = () => Promise.reject(new Error("429"));
  const fr = await LI.generate(course, u, fm);
  ok(fr.stopped && fr.made === 0 && fm.autoPhotoDone && !LI.needs(fm) && LI.missing(fm).length === 2, "실패로 멈추면 다시 자동 보강하지 않음(빈 자리는 남김)");
  // 코드 블록 속 '## …'·'- …' 는 소제목·글머리로 보지 않음
  const cm = C.newModule({ title: "코드 블록" });
  cm.objectives = ["프롬프트를 쓸 수 있다."];
  cm.content = { overview: "- 개요", sections: [{ title: "프롬프트 틀", body: "## 틀 쓰기\n- 역할을 먼저 씁니다.\n\n```markdown\n## 역할\n- 하나\n- 둘\n- 셋\n- 넷\n```" }], checklist: [] };
  eq(LI.targets(cm).map((t) => t.sub).join(","), "틀 쓰기", "코드 블록 속 소제목은 그림 자리로 고르지 않음");
  cm.photos = [{ id: "cbx", sec: 0, sub: "역할", title: "역할" }];
  const cmd = C.textbookModuleMd(course, u, (u.modules.push(cm), u.modules.length - 1));
  ok(cmd.indexOf("[이미지:cbx]") < cmd.indexOf("```markdown"), "코드 블록 속 같은 이름 소제목 아래에는 넣지 않음");

  console.log(`auto.test.js: ${passed} 통과, ${failures.length} 실패`);
  if (failures.length) { failures.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
