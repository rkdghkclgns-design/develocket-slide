/* parts.test.js — 주제+하위 주제 → 부(部)별 원고 → 부별 교수안·슬라이드 테스트
 *
 *   source-parts.js : 하위 주제 목록 감지 · 부 분할 · 부별 원고 작성 · 부별 생성
 *   generate.js     : writeSource / generateFromSource 의 분량·과정명 매개변수
 * AI 호출(K.ai.call)은 프롬프트 종류에 맞춰 형식만 갖춘 가짜 응답으로 대체한다.
 *
 * 실행:  node tests/parts.test.js   (성공 exit 0, 실패 exit 1)
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

const ctx = { console, setTimeout, Promise };
ctx.window = ctx;
vm.createContext(ctx);
["course-rules.js", "course-model.js", "generate.js", "source-parts.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(ASSETS, f), "utf8"), ctx, { filename: f }));
const K = ctx.KBuilder;
const P = K.parts;

/* ---------- 가짜 AI ---------- */
const calls = [];
K.ai = {
  call(prompt, opts) {
    calls.push({ role: opts && opts.role, prompt });
    let out = "";
    const minutes = Number((prompt.match(/시간 합계는 정확히 (\d+)분/) || [])[1]);
    if (/강의의 개요를 설계하세요/.test(prompt)) {
      const unit = (prompt.match(/이 부의 주제: (.+?) \(/) || [0, "주제"])[1];
      const a = Math.round(minutes / 3 / 5) * 5;
      out = `제목: ${unit}\n목표: ${unit}을 설명할 수 있다\n섹션: ${unit} 개념 | ${a}분 | 정의\n섹션: ${unit} 사례 | ${a}분 | 사례\n섹션: ${unit} 실습 | ${minutes - 2 * a}분 | 실습`;
    } else if (/섹션 \d+\/\d+ 본문을 작성하세요/.test(prompt)) {
      const head = (prompt.match(/첫 줄은 반드시 '(## .+?)' 그대로/) || [0, "## 섹션"])[1];
      out = head + "\n\n본문 문단입니다. 예시 두 가지를 들어 설명합니다. 활동도 포함합니다.";
    } else if (/교수안 머리말/.test(prompt)) {
      out = "교과목: AI가 정한 과목\n주제: AI가 정한 주제\n부제: 부제\n[학습목표]\n- 설명할 수 있다\n[개요]\n개요.\n[유의사항]\n- 유의";
    } else if (/@@GYOSUAN@@/.test(prompt)) {
      const t = (prompt.match(/\[섹션 제목\] (.+)/) || [0, "섹션"])[1];
      out = `@@GYOSUAN@@\n**설명 내용**: ${t} 설명.\n**멘트 예시**: "멘트"\n**학생 활동**: 활동.\n@@SLIDES@@\n### 슬라이드 - ${t}\n- 슬라이드 문구:\n  - 문구\n- 이미지/시각: 그림\n- 핵심 메시지: 메시지`;
    }
    return Promise.resolve(out);
  }
};

const INPUT = [
  "* 주제 입력: 생성형 AI와 UGC 산업의 이해",
  "   * 생성형 AI의 종류",
  "   * LLM의 동작 원리",
  "   * UGC 플렛폼 산업의 구조와 크리에이ㅓ 이코노미",
  "   * AI 에이전트",
  "   * 이미지, 사운드 생성 등의 AI 도구 생태계",
  "   * AI 생성물의 저작권 및 라리선스"
].join("\n");

(async () => {
  /* ---------- 하위 주제 감지 ---------- */
  const t = P.detectTopicList(INPUT);
  ok(t, "'* 주제 입력:' + 하위 글머리 목록 감지");
  eq(t && t.title, "생성형 AI와 UGC 산업의 이해", "과정 주제");
  eq(t && t.units.length, 6, "하위 주제 6개");
  eq(P.detectTopicList("중학생 대상 게임 기획 입문 2차시 — 재미 요소 분석"), null, "한 줄 주제는 부 분할 안 함");
  eq(P.detectTopicList("# 원고\n\n긴 문단입니다. 여러 문장이 이어집니다.\n- 항목\n- 항목2\n또 다른 문단"), null, "일반 원고·메모는 부 분할 안 함");
  ok(P.detectTopicList("게임 기획 입문\n- 재미 요소\n- 기획서 작성"), "라벨 없이 첫 줄 + 글머리 목록도 감지");
  eq(P.splitHours(6, 40).reduce((a, b) => a + b, 0), 40, "부별 시간 합계 40");

  /* ---------- 부 분할 ---------- */
  const src = "# 과정: 테스트 과정\n\n> 메모\n\n# 1부. 첫째 주제 (7시간)\n\n## 학습 목표\n- a\n\n## 개념 (60분)\n본문 본문 본문 본문 본문 본문 본문 본문\n\n# 2부. 둘째 주제 (6시간)\n\n## 사례 (60분)\n본문 본문 본문 본문 본문 본문 본문 본문";
  const sp = P.splitParts(src);
  eq(sp && sp.parts.length, 2, "'# N부.' 머리글 2개 → 2부");
  eq(sp && sp.course, "테스트 과정", "'# 과정:' → 과정명");
  eq(sp && sp.parts[0].hours, 7, "부 시간 읽기");
  eq(sp && sp.parts[1].label, "2부. 둘째 주제 (6시간)", "드롭다운 라벨");
  eq(P.splitParts("# 1부. 하나뿐\n본문"), null, "1부만 있으면 분할 안 함");
  eq(P.splitParts("# 10부작 웹툰 기획\n본문\n# 3부작 드라마\n본문"), null, "'10부작' 같은 제목은 부 머리글이 아님");

  /* ---------- 부별 원고 작성 ---------- */
  const progress = [];
  const md = await P.writeSourceParts(INPUT, (d, tt, l) => progress.push(l), { totalHours: 40 });
  const back = P.splitParts(md);
  eq(back && back.parts.length, 6, "작성한 원고를 다시 나누면 6부");
  eq(back && back.course, "생성형 AI와 UGC 산업의 이해", "원고에 과정명 머리글");
  eq(back && back.parts.reduce((a, p) => a + p.hours, 0), 40, "부 시간 합계 40");
  ok(back && back.parts.every((p) => /## .+ \(\d+분\)/.test(p.md)), "부마다 '## 섹션 (N분)' 본문");
  const outlinePrompts = calls.filter((c) => /강의의 개요를 설계하세요/.test(c.prompt));
  eq(outlinePrompts.length, 6, "부마다 개요 1회");
  ok(outlinePrompts.every((c) => /\[과정 맥락\]/.test(c.prompt) && /6부 구성/.test(c.prompt)), "개요에 과정 맥락(다른 부와 중복 방지)");
  ok(outlinePrompts[0].prompt.includes("420분") && outlinePrompts[5].prompt.includes("360분"), "부별 분량(7시간=420분, 6시간=360분)");
  ok(progress.some((l) => /\[3\/6부 · /.test(l)), "진행 표시에 부 번호");
  // 섹션 시간 합 = 부 시간
  back.parts.forEach((p, i) => {
    const sum = K.splitSections(p.md).sections.reduce((a, s) => a + s.time, 0);
    eq(sum, p.hours * 60, `${i + 1}부 섹션 시간 합 = 부 시간`);
  });

  /* ---------- 부별 교수안·슬라이드 생성 ---------- */
  const gen = await P.generateParts(md, () => {});
  eq(gen.parts.length, 6, "부마다 결과 6개");
  const g0 = gen.parts[0];
  ok(/^---\n교과목: 생성형 AI와 UGC 산업의 이해/.test(g0.docMd), "교수안 교과목 = 과정명");
  ok(/주제: 생성형 AI의 종류/.test(g0.docMd), "교수안 주제 = 부 제목");
  ok(/소요: 420분\(약 7시수\)/.test(g0.docMd), "교수안 소요 = 부 시간(420분)");
  ok(/# 교수안 - 생성형 AI의 종류/.test(g0.docMd), "교수안 제목 = 부 제목");
  ok(/### 슬라이드 1 - 표지/.test(g0.deckMd) && /\(제목\) 생성형 AI의 종류/.test(g0.deckMd), "부별 편성안(표지 = 부 제목)");
  ok(gen.parts.every((p, i) => p.label === `${i + 1}부. ${p.title} (${p.hours}시간)`), "부 라벨");
  const decks = new Set(gen.parts.map((p) => (p.deckMd.match(/주제: (.+)/) || [])[1]));
  eq(decks.size, 6, "부마다 편성안 주제가 달라 슬라이드 저장 키가 겹치지 않음");

  /* ---------- 실패 시 완료분 보존 ---------- */
  const real = K.ai.call;
  let n = 0;
  K.ai.call = (p, o) => (/섹션 \d+\/\d+ 본문/.test(p) && ++n > 4 ? Promise.reject(new Error("한도 초과")) : real(p, o));
  try { await P.writeSourceParts(INPUT, () => {}, { totalHours: 40 }); ok(false, "실패가 전파되어야 함"); }
  catch (e) { ok(e.partialCount >= 1 && /# 1부\./.test(e.partial), "원고 작성 실패 시 완료된 부 보존"); }
  K.ai.call = real;

  if (failures.length) {
    console.error("❌ 실패 " + failures.length + "건 (통과 " + passed + "건)");
    failures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("✅ 부(部) 분할·생성 테스트 전부 통과 — 단언 " + passed + "건");
})().catch((e) => { console.error(e); process.exit(1); });
