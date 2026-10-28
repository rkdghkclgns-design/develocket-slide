/* course-model.js — 과정 설계(주제 → 단원·학습모듈 블록) 순수 로직 · DOM 불필요
 *
 * 구조는 「콘텐츠 업무 설계」 지침을 따른다.
 *   과정(최종 목표·총 시간) → 단원(=교과목: NCS 능력단위 대응·시간) → 학습모듈(=블록: 목표 3개 이하·흐름별 시간)
 *   학습모듈 교재 = 개요 → 학습목표 → 학습내용(목표별 덩어리) → 학습 후 체크리스트(목표와 1:1)
 *   문제은행 = 모든 문항이 [학습목표, 밴드(L1~L3)] 두 태그를 가진다.
 *
 * 노출: window.KBuilder.course = { … }
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});

  var MIN_PER_HOUR = 60;
  var MODULE_MAX_MIN = 180;          // 학습모듈 한 블록의 최대 길이(3시간) — 넘으면 블록을 나눈다
  var MAX_OBJECTIVES = 3;            // 지침: 학습모듈당 학습목표 3개 이하 권장
  var BANDS = {
    L1: { name: "수업과 같은 상황", desc: "수업에서 다룬 상황을 그대로 묻습니다. 배운 내용을 기억하고 있는지 확인합니다.", types: ["객관식", "단답식"], recommend: 10 },
    L2: { name: "같은 구조, 다른 맥락", desc: "배운 구조를 다른 상황에 적용하게 합니다. 원리를 옮겨 쓸 수 있는지 확인합니다.", types: ["서술형", "코드제출"], recommend: 5 },
    L3: { name: "요구사항만 제시", desc: "해결할 요구사항만 주고 방법은 주지 않습니다. 배운 내용으로 스스로 구현할 수 있는지 확인합니다.", types: ["파일제출"], recommend: 3 },
    L4: { name: "목표만 제시", desc: "최종 목표만 주고 수행 능력 전체를 평가합니다. 문제은행이 아니라 과정의 프로젝트에서 다룹니다.", types: ["프로젝트"], recommend: 0 }
  };
  var QUESTION_BANDS = ["L1", "L2", "L3"];

  var seq = 0;
  function uid(prefix) {
    seq = (seq + 1) % 1e6;
    return (prefix || "id") + "-" + Date.now().toString(36) + "-" + seq.toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  }

  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* 분 → "1시간 30분" / "45분" */
  function fmtMin(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + "분";
    return r ? h + "시간 " + r + "분" : h + "시간";
  }

  /* ---------- 주제 입력 파싱 ----------
   * "주제 입력: 생성형 AI와 UGC 산업의 이해" + 하위 글머리 목록 → {title, units[]}
   * 라벨이 없으면 첫 비글머리 줄(또는 첫 줄)을 과정 주제로 본다. */
  function parseTopicInput(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var title = "", units = [];
    var labeled = false;
    lines.forEach(function (raw) {
      if (!raw.trim()) return;
      var indent = (raw.match(/^\s*/) || [""])[0].replace(/\t/g, "    ").length;
      var isBullet = /^\s*([-*•·]|\d+[.)])\s+/.test(raw);
      var line = raw.replace(/^\s*([-*•·]|\d+[.)])\s+/, "").trim();
      var lab = line.match(/^(?:과정\s*)?주제(?:\s*입력)?\s*[:：]\s*(.+)$/);
      if (lab) { title = lab[1].trim(); labeled = true; return; }
      if (!title && !labeled && (!isBullet || indent === 0) && !units.length) { title = line; return; }
      if (line) units.push(line.replace(/\s*\(\s*\d+\s*(시간|h|H)\s*\)\s*$/, "").trim());
    });
    // 같은 단원이 중복 입력되면 하나만 남긴다
    var seen = {};
    units = units.filter(function (u) { if (!u || seen[u]) return false; seen[u] = true; return true; });
    return { title: title, units: units };
  }

  /* 정수 시간 배분 — 가중치 비례 + 최대 나머지 방식, 각 단원 최소 1시간, 합계 = total */
  function allocate(n, total, weights, unit) {
    unit = unit || 1;
    var slots = Math.round(total / unit);
    if (n <= 0) return [];
    var w = [];
    for (var i = 0; i < n; i++) w.push(weights && weights[i] > 0 ? weights[i] : 1);
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var raw = w.map(function (x) { return (x / sw) * slots; });
    var base = raw.map(function (x) { return Math.max(1, Math.floor(x)); });
    var sum = base.reduce(function (a, b) { return a + b; }, 0);
    var order = raw.map(function (x, i) { return { i: i, f: x - Math.floor(x) }; })
      .sort(function (a, b) { return b.f - a.f || a.i - b.i; });
    var k = 0;
    while (sum < slots && n) { base[order[k % n].i]++; sum++; k++; }
    // 최소 1 보장으로 초과했으면 큰 것부터 줄인다
    while (sum > slots) {
      var maxI = 0;
      for (var j = 1; j < n; j++) if (base[j] > base[maxI]) maxI = j;
      if (base[maxI] <= 1) break;
      base[maxI]--; sum--;
    }
    return base.map(function (x) { return x * unit; });
  }
  function allocateHours(n, total, weights) { return allocate(n, total, weights, 1); }

  /* 학습모듈 내부 흐름(도입·전개·정리) 기본값 — 5분 단위 */
  function defaultFlow(minutes, title) {
    minutes = Math.max(10, Math.round(minutes));
    var intro = minutes >= 60 ? Math.max(10, Math.round(minutes * 0.1 / 5) * 5) : 5;
    var close = intro;
    var body = minutes - intro - close;
    var flow = [{ phase: "도입", title: "문제 상황 제시와 목표 확인", minutes: intro }];
    if (body > 90) {
      var parts = allocate(2, body, [1, 1], 5);
      flow.push({ phase: "전개", title: (title || "핵심 내용") + " — 개념과 원리", minutes: parts[0] });
      flow.push({ phase: "전개", title: (title || "핵심 내용") + " — 적용 실습", minutes: parts[1] });
    } else {
      flow.push({ phase: "전개", title: (title || "핵심 내용"), minutes: body });
    }
    flow.push({ phase: "정리", title: "목표 확인과 체크리스트", minutes: close });
    return flow;
  }

  var MODULE_SUFFIX = ["핵심 개념", "구조와 사례", "적용 실습", "심화 활용", "종합 정리"];

  /* 단원 하나를 학습모듈 블록으로 기본 분할 (AI 없이도 동작) */
  function defaultModules(unitTitle, hours) {
    var total = Math.max(1, hours) * MIN_PER_HOUR;
    var n = Math.max(1, Math.ceil(total / MODULE_MAX_MIN));
    var mins = allocate(n, total, null, 30);
    return mins.map(function (m, i) {
      var t = n === 1 ? unitTitle : unitTitle + " — " + (MODULE_SUFFIX[i] || ("블록 " + (i + 1)));
      return { id: uid("m"), title: t, minutes: m, objectives: [], flow: defaultFlow(m, n === 1 ? unitTitle : MODULE_SUFFIX[i]), content: null, questions: [] };
    });
  }

  function newUnit(title, hours) {
    return { id: uid("u"), title: title, hours: hours, ncs: [], ncsDraft: [], modules: defaultModules(title, hours), outputs: null };
  }

  function buildCourse(parsed, totalHours, opts) {
    opts = opts || {};
    totalHours = Number(totalHours) > 0 ? Number(totalHours) : 40;
    var titles = parsed.units.length ? parsed.units : [parsed.title || "단원 1"];
    var hours = allocateHours(titles.length, totalHours, opts.weights);
    return {
      v: 1,
      title: parsed.title || titles[0],
      goal: "",
      totalHours: totalHours,
      target: opts.target || "직업훈련 수강생(완전 초보)",
      tool: opts.tool || "",
      createdAt: todayStr(),
      units: titles.map(function (t, i) { return newUnit(t, hours[i]); })
    };
  }

  /* 모듈 시간 합 = 단원 시간, 흐름 시간 합 = 모듈 시간 이 되도록 보정 */
  function normalizeUnit(unit) {
    var total = Math.max(1, Number(unit.hours) || 1) * MIN_PER_HOUR;
    var mods = unit.modules || [];
    if (!mods.length) { unit.modules = defaultModules(unit.title, unit.hours); return unit; }
    var cur = mods.map(function (m) { return Math.max(5, Number(m.minutes) || 5); });
    var fixed = allocate(mods.length, total, cur, 5);
    mods.forEach(function (m, i) {
      m.minutes = fixed[i];
      if (!m.flow || !m.flow.length) { m.flow = defaultFlow(m.minutes, m.title); return; }
      var fm = allocate(m.flow.length, m.minutes, m.flow.map(function (f) { return Math.max(5, Number(f.minutes) || 5); }), 5);
      m.flow.forEach(function (f, j) { f.minutes = fm[j]; });
    });
    return unit;
  }

  function courseHours(course) {
    return (course.units || []).reduce(function (a, u) { return a + (Number(u.hours) || 0); }, 0);
  }

  /* ---------- 지침 검사(린트) ---------- */
  var BANNED_VERBS = /(이해한다|안다|익힌다|이해할 수 있다|알 수 있다|알게 된다|익힐 수 있다|배운다)\s*\.?$/;
  function lintObjective(text) {
    var t = String(text || "").trim();
    var issues = [];
    if (!t) return ["학습목표가 비어 있습니다."];
    if (BANNED_VERBS.test(t)) issues.push("'이해한다·안다·익힌다'는 관찰할 수 없는 목표입니다. 관찰 가능한 행동(설명·비교·작성·구현 등)으로 바꿔야 합니다.");
    else if (!/할\s*수\s*있다\.?$/.test(t)) issues.push("'~할 수 있다'로 끝나야 합니다.");
    if (t.length < 15) issues.push("수행의 조건과 제약(무엇을 가지고, 어떤 기준으로)을 함께 적는 것이 좋습니다.");
    return issues;
  }

  var TEXT_RULES = [
    { re: /여러분|당신|우리(는|가|의|도)?\s/g, msg: "학습자를 호칭하지 않습니다('여러분·당신·우리' 대신 주어 없이 동작만 서술)." },
    { re: /경우에 따라 다릅니다|상황에 맞게/g, msg: "모호한 표현입니다. 판단 기준을 명시하거나 문장을 삭제합니다." },
    { re: /매우|아주|굉장히/g, msg: "정도 표현('매우·아주·굉장히')은 수치로 씁니다." },
    { re: /당연히|물론|쉽게/g, msg: "'당연히·물론·쉽게'는 학습자를 자책하게 만듭니다." },
    { re: /앞에서 배운|앞서 배운|지난 시간|이전 시간|다음 시간|이전 모듈|다음 모듈|앞 단원/g, msg: "다른 학습모듈·과정을 본문에서 지칭하지 않습니다(도메인 상황으로 서술)." }
  ];
  /* 교재(학습자용) 본문 어투 검사 → [{msg, hits}] */
  function lintText(text) {
    var s = String(text || "");
    var out = [];
    TEXT_RULES.forEach(function (r) {
      var m = s.match(r.re);
      if (m && m.length) out.push({ msg: r.msg, hits: m.length, sample: m[0].trim() });
    });
    return out;
  }

  /* ---------- 문제은행 ---------- */
  function newQuestion(fields) {
    var q = {
      id: uid("q"), objective: 1, band: "L1", type: "객관식", multi: false,
      stem: "", code: "", choices: [], answer: "", accepted: "", rubric: [], tests: "", explanation: "", review: null
    };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) q[k] = fields[k];
    return q;
  }

  /* 규칙 검수 — 지침 '채점 기준'·'작성 규칙' 기반. 반환: 문제 목록(빈 배열이면 통과) */
  function validateQuestion(q, module) {
    var issues = [];
    var nObj = module && module.objectives ? module.objectives.length : 0;
    if (!q.stem || !String(q.stem).trim()) issues.push("문항 본문이 비어 있습니다.");
    if (!q.objective || (nObj && (q.objective < 1 || q.objective > nObj))) issues.push("학습목표 태그가 없습니다.");
    if (!BANDS[q.band] || q.band === "L4") issues.push("밴드 태그(L1~L3)가 없습니다.");
    else if (BANDS[q.band].types.indexOf(q.type) === -1) issues.push(q.band + " 밴드에는 " + BANDS[q.band].types.join("·") + " 유형을 씁니다.");
    var choices = q.choices || [];
    if (q.type === "객관식") {
      var correct = choices.filter(function (c) { return c.correct; }).length;
      var wrong = choices.length - correct;
      if (choices.length < 3) issues.push("객관식 보기는 3개 이상이어야 합니다.");
      if (choices.some(function (c) { return !String(c.text || "").trim(); })) issues.push("빈 보기가 있습니다.");
      if (q.multi) {
        if (correct < 2 || wrong < 1) issues.push("복수 정답은 정답 2개 이상과 오답 1개 이상으로 구성합니다.");
        if (!/모두\s*고르시오/.test(q.stem || "")) issues.push("복수 정답 문항은 본문에 '모두 고르시오'를 밝혀야 합니다.");
      } else if (correct !== 1) {
        issues.push("단일 선택 객관식은 정답이 정확히 1개여야 합니다.");
      }
    }
    if (q.type === "단답식" && !String(q.answer || "").trim()) issues.push("단답식은 정답(단어·값 하나)을 적어야 합니다.");
    if (q.type === "서술형") {
      var rub = (q.rubric || []).filter(function (r) { return String(r.criterion || "").trim(); });
      if (!rub.length) issues.push("서술형은 요소별 채점 기준(점수)을 함께 작성합니다.");
      else if (rub.some(function (r) { return !(Number(r.points) > 0); })) issues.push("채점 요소마다 점수를 적어야 합니다.");
    }
    if (q.type === "코드제출" && !String(q.tests || "").trim()) issues.push("코드제출은 기대 출력 또는 테스트 케이스를 함께 작성합니다.");
    if (q.type === "파일제출" && !(q.rubric || []).filter(function (r) { return String(r.criterion || "").trim(); }).length) issues.push("파일제출은 채점 루브릭을 구성합니다.");
    if ((q.band === "L1") && !String(q.explanation || "").trim()) issues.push("해설이 없습니다.");
    // 체크리스트 문장을 그대로 문항으로 쓰지 않는다
    var cl = module && module.content && module.content.checklist ? module.content.checklist : [];
    var stemN = String(q.stem || "").replace(/\s+/g, "");
    if (stemN && cl.some(function (c) { var t = String(c.text || c).replace(/\s+/g, ""); return t.length > 8 && stemN.indexOf(t) !== -1; })) {
      issues.push("체크리스트 문장을 그대로 문항으로 쓰지 않습니다(구체적 상황에서의 판단을 묻습니다).");
    }
    if (q.review && q.review.ok === false) issues.push("AI 교차 검수: " + (q.review.notes || "수정 필요"));
    return issues;
  }

  /* 목표 × 밴드 분포 */
  function distribution(questions, nObjectives) {
    var rows = [];
    for (var i = 0; i < nObjectives; i++) rows.push({ L1: 0, L2: 0, L3: 0 });
    var total = { L1: 0, L2: 0, L3: 0 };
    (questions || []).forEach(function (q) {
      var r = rows[(q.objective || 1) - 1];
      if (r && r[q.band] != null) r[q.band]++;
      if (total[q.band] != null) total[q.band]++;
    });
    return { rows: rows, total: total, recommend: { L1: BANDS.L1.recommend, L2: BANDS.L2.recommend, L3: BANDS.L3.recommend } };
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /* 문제은행 CSV — 출제 이력은 LMS가 관리하므로 여기에는 문항 자체만 담는다 */
  function questionsToCsv(questions, ctx) {
    ctx = ctx || {};
    var head = ["번호", "단원", "학습모듈", "학습목표", "목표 내용", "밴드", "유형", "복수정답", "문항", "시작 코드", "보기", "정답", "허용 표기", "채점 기준", "기대 출력·테스트", "해설", "검수"];
    var objs = ctx.objectives || [];
    var rows = [head.map(csvCell).join(",")];
    (questions || []).forEach(function (q, i) {
      var choices = (q.choices || []).map(function (c, j) { return (j + 1) + ") " + c.text; }).join("\n");
      var answer = q.type === "객관식"
        ? (q.choices || []).map(function (c, j) { return c.correct ? String(j + 1) : null; }).filter(Boolean).join(",")
        : (q.answer || "");
      var rubric = (q.rubric || []).map(function (r) { return r.criterion + " (" + (r.points || 0) + "점)"; }).join("\n");
      var issues = validateQuestion(q, ctx.module);
      rows.push([i + 1, ctx.unit || "", ctx.moduleTitle || "", q.objective, objs[(q.objective || 1) - 1] || "", q.band, q.type,
        q.multi ? "Y" : "", q.stem, q.code, choices, answer, q.accepted, rubric, q.tests, q.explanation,
        issues.length ? "검수 필요" : "검수 통과"].map(csvCell).join(","));
    });
    return "﻿" + rows.join("\r\n");
  }

  /* ---------- NCS 참조 목록 검색 ---------- */
  function catalog() { return K.NCS || { subd: {}, units: [] }; }

  function ncsUnit(code) {
    var c = catalog();
    for (var i = 0; i < c.units.length; i++) {
      var u = c.units[i];
      if (u[0] === code) {
        var sd = c.subd[code.slice(0, 8)] || [];
        return { code: u[0], name: u[1], level: u[2], subd: code.slice(0, 8), path: sd.slice(0, 4), duty: sd[4] || "" };
      }
    }
    return null;
  }

  /* 한국어 바이그램 + 영문/숫자 토큰 */
  function tokens(s) {
    s = String(s || "").toLowerCase();
    var out = {};
    (s.match(/[a-z0-9]+/g) || []).forEach(function (w) { if (w.length > 1) out[w] = 1; });
    (s.match(/[가-힣]+/g) || []).forEach(function (w) {
      if (w.length === 1) return;
      for (var i = 0; i < w.length - 1; i++) out[w.slice(i, i + 2)] = 1;
    });
    return out;
  }
  var STOP = tokens("하기 있다 수있 할수 하는 및 의 기반 관리 활용 이해 개념 구조 기초 등의 종류 원리 동작");

  /* 과정 주제에 자주 나오지만 NCS 명칭과 표현이 다른 낱말 → NCS 쪽 표현으로 확장 */
  var SYNONYMS = {
    "저작권": "지식재산 저작 권리화 계약관리", "라이선스": "라이센스 라이선싱 지식재산 계약", "라이센스": "라이선싱 계약",
    "ugc": "소셜미디어 콘텐츠 채널 운영", "크리에이터": "소셜미디어 채널 운영 콘텐츠 기획", "이코노미": "콘텐츠 생태계 소비시장",
    "플랫폼": "플랫폼 유통플랫폼 채널", "llm": "인공지능 모델 생성형 프롬프트", "에이전트": "인공지능 서비스 구현 에이전트",
    "이미지": "그래픽 일러스트레이션 디자인", "사운드": "음향 사운드 효과음 배경음악", "영상": "영상 편집 촬영",
    "프롬프트": "프롬프트 구현 최적화", "챗봇": "인공지능 서비스 시나리오", "윤리": "윤리 준수 안전성"
  };
  function expandQuery(query) {
    var s = String(query || "");
    var low = s.toLowerCase();
    Object.keys(SYNONYMS).forEach(function (k) { if (low.indexOf(k) !== -1) s += " " + SYNONYMS[k]; });
    return s;
  }

  /* 능력단위별 토큰 사전과 IDF — 자주 나오는 바이그램('생성' 등)이 점수를 독점하지 않게 한다 */
  var index = null;
  function buildIndex() {
    var c = catalog();
    if (index && index.n === c.units.length) return index;
    var docs = [], df = {};
    var subdTok = {};
    Object.keys(c.subd).forEach(function (sd) {
      var row = c.subd[sd];
      subdTok[sd] = { name: tokens(row[2] + " " + row[3]), duty: tokens(row[4]) };
    });
    c.units.forEach(function (u) {
      var sd = u[0].slice(0, 8);
      var d = { code: u[0], sd: sd, name: tokens(u[1]), subd: subdTok[sd] || { name: {}, duty: {} } };
      var seen = {};
      [d.name, d.subd.name].forEach(function (m) { Object.keys(m).forEach(function (t) { seen[t] = 1; }); });
      Object.keys(seen).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      docs.push(d);
    });
    index = { n: c.units.length, docs: docs, df: df };
    return index;
  }

  /* 질의와 능력단위(명칭 3·세분류명 2·직무정의 1, IDF 가중) 겹침으로 점수화 → 세분류당 최대 3개, 상위 limit 개 */
  function ncsSearch(query, limit, opts) {
    opts = opts || {};
    var q = tokens(expandQuery(query));
    Object.keys(STOP).forEach(function (k) { delete q[k]; });
    var qk = Object.keys(q);
    if (!qk.length) return [];
    var ix = buildIndex();
    var idf = {};
    qk.forEach(function (t) { idf[t] = Math.log(1 + ix.n / (1 + (ix.df[t] || 0))); });
    var res = [];
    ix.docs.forEach(function (d) {
      if (opts.subds && opts.subds.indexOf(d.sd) === -1) return;
      var s = 0;
      qk.forEach(function (t) {
        if (d.name[t]) s += 3 * idf[t];
        if (d.subd.name[t]) s += 2 * idf[t];
        if (d.subd.duty[t]) s += 0.5 * idf[t];
      });
      if (s > 0) res.push({ code: d.code, sd: d.sd, score: s });
    });
    res.sort(function (a, b) { return b.score - a.score || a.code.localeCompare(b.code); });
    var perSubd = {}, picked = [];
    var cap = opts.perSubd || 3;
    for (var i = 0; i < res.length && picked.length < (limit || 20); i++) {
      var r = res[i];
      perSubd[r.sd] = (perSubd[r.sd] || 0) + 1;
      if (perSubd[r.sd] <= cap) picked.push(r);
    }
    var top = picked.length ? picked[0].score : 1;
    return picked.map(function (r) {
      var u = ncsUnit(r.code);
      u.match = Math.round(40 + 55 * (r.score / top));
      return u;
    });
  }

  /* 세분류 목록 (AI 1단계 선택용) */
  function ncsSubdList() {
    var c = catalog();
    return Object.keys(c.subd).map(function (k) { var r = c.subd[k]; return { code: k, path: r.slice(0, 4) }; });
  }

  /* ---------- 산출물 조립(MD) ---------- */
  function objectiveRefs(unit) {
    // 단원 내 학습목표 번호 "모듈.목표" (예: 2.1)
    var out = [];
    (unit.modules || []).forEach(function (m, mi) {
      (m.objectives || []).forEach(function (o, oi) { out.push({ ref: (mi + 1) + "." + (oi + 1), text: o, module: mi }); });
    });
    return out;
  }

  function ncsLine(n) {
    return n.code + " " + n.name + (n.level ? " (" + n.level + "수준)" : "");
  }

  /* 과정 설계서 — 단원·블록별 소요 시간 표 */
  function courseMd(course) {
    var L = [];
    var total = courseHours(course);
    L.push("---", "과정: " + course.title, "총 시간: " + total + "시간", "date: " + todayStr(), "---", "");
    L.push("# 과정 설계서 - " + course.title, "");
    L.push("## 과정 목표", "", course.goal || "(과정 목표를 입력하세요)", "");
    L.push("## 단원 구성 한눈에 보기", "", "| 단원 | 시간 | 학습모듈 | NCS 능력단위 |", "|---|---|---|---|");
    course.units.forEach(function (u, i) {
      L.push("| " + (i + 1) + ". " + u.title + " | " + u.hours + "시간 | " +
        u.modules.map(function (m) { return m.title + "(" + fmtMin(m.minutes) + ")"; }).join("<br>") + " | " +
        ((u.ncs || []).map(ncsLine).join("<br>") || "-") + " |");
    });
    L.push("| **합계** | **" + total + "시간** |  |  |", "");
    course.units.forEach(function (u, i) {
      L.push("## " + (i + 1) + ". " + u.title + " (" + u.hours + "시간)", "");
      u.modules.forEach(function (m, mi) {
        L.push("### 학습모듈 " + (i + 1) + "-" + (mi + 1) + ". " + m.title + " (" + fmtMin(m.minutes) + ")", "");
        if (m.objectives && m.objectives.length) {
          L.push("**학습목표**", "");
          m.objectives.forEach(function (o, oi) { L.push((oi + 1) + ". " + o); });
          L.push("");
        }
        L.push("| 단계 | 내용 | 시간 |", "|---|---|---|");
        (m.flow || []).forEach(function (f) { L.push("| " + f.phase + " | " + f.title + " | " + fmtMin(f.minutes) + " |"); });
        L.push("");
      });
    });
    return L.join("\n");
  }

  /* 학습모듈 교재(학습자용) — 개요 → 학습목표 → 학습내용 → 학습 후 체크리스트 (구성 순서 고정) */
  function textbookModuleMd(course, unit, mi) {
    var m = unit.modules[mi];
    var c = m.content || {};
    var objs = m.objectives || [];
    var L = [];
    L.push("# " + m.title, "");
    L.push("| 항목 | 내용 |", "|---|---|");
    L.push("| 예상 소요 시간 | " + fmtMin(m.minutes) + " |");
    L.push("| 사용 툴과 버전 | " + (course.tool || "-") + " |");
    L.push("| 선행 학습모듈 | " + (mi > 0 ? unit.modules[mi - 1].title : "없음") + " |");
    var refs = (unit.ncs || []).filter(function (n) {
      return !(n.objectives && n.objectives.length) || n.objectives.some(function (r) { return String(r).split(".")[0] === String(mi + 1); });
    });
    L.push("| NCS 능력단위(교과목 대응) | " + (refs.map(ncsLine).join("<br>") || "-") + " |");
    L.push("| 변경 이력 | " + todayStr() + " 초안 작성" + (c.by ? "(" + c.by + ")" : "") + " |", "");
    L.push("## 개요", "", c.overview || "(이 학습모듈을 왜 배우는지 — 문제 상황 / 해결할 것 / 학습 후 가능해지는 것)", "");
    L.push("## 학습목표", "");
    objs.forEach(function (o, i) { L.push((i + 1) + ". " + o); });
    if (!objs.length) L.push("1. (학습목표를 '~할 수 있다'로 작성)");
    L.push("", "## 학습내용", "");
    objs.forEach(function (o, i) {
      var sec = (c.sections || [])[i] || {};
      L.push("### " + (i + 1) + ". " + (sec.title || o), "");
      L.push(sec.body || "(학습목표 " + (i + 1) + "에 대응하는 내용)", "");
    });
    L.push("## 학습 후 체크리스트", "");
    objs.forEach(function (o, i) {
      var item = (c.checklist || [])[i];
      var text = item ? (item.text || item) : o.replace(/할\s*수\s*있다\.?$/, "할 수 있습니까?");
      L.push("- [ ] " + text + " → 다시 보기: 학습내용 " + (i + 1));
    });
    L.push("");
    return L.join("\n");
  }

  function textbookMd(course, unit) {
    var head = ["---", "과정: " + course.title, "교과목: " + unit.title, "소요: " + unit.hours + "시간", "date: " + todayStr(), "status: 초안", "---", ""];
    return head.join("\n") + unit.modules.map(function (m, mi) { return textbookModuleMd(course, unit, mi); }).join("\n---\n\n");
  }

  /* 단원 교수안 — 기존 교수안.md 형태 유지(도입 / 전개 N / 정리 + 각부 소요 시간) */
  function unitSteps(unit) {
    var steps = [];
    var mods = unit.modules || [];
    mods.forEach(function (m, mi) {
      (m.flow || []).forEach(function (f, fi) {
        var first = mi === 0 && fi === 0 && f.phase === "도입";
        var last = mi === mods.length - 1 && fi === m.flow.length - 1 && f.phase === "정리";
        steps.push({ module: mi, flow: fi, f: f, kind: first ? "도입" : last ? "정리" : "전개" });
      });
    });
    var n = 0;
    steps.forEach(function (s) {
      var label = s.kind === "전개" ? "전개 " + (++n) : s.kind;
      var prefix = s.kind === "전개" && s.f.phase !== "전개" ? "[" + mods[s.module].title + " · " + s.f.phase + "] " : "";
      s.heading = label + " - " + prefix + s.f.title + " (" + fmtMin(s.f.minutes) + ")";
    });
    return steps;
  }

  function lessonPlanMd(course, unit) {
    var L = [];
    var mins = unit.hours * MIN_PER_HOUR;
    var objs = objectiveRefs(unit);
    L.push("---", "교과목: " + unit.title, "주제: " + unit.title, "소요: " + unit.hours + "시수(약 " + mins + "분)",
      "대상: " + (course.target || "직업훈련 수강생"), "date: " + todayStr(), "status: 초안(과정 설계)", "---", "");
    L.push("# 교수안 - " + unit.title, "");
    L.push("## 학습 목표", "");
    objs.forEach(function (o) { L.push("- " + o.text); });
    if (!objs.length) L.push("- (학습모듈의 학습목표를 입력하세요)");
    L.push("", "## 개요", "", "| 항목 | 내용 |", "|---|---|");
    L.push("| 과정 | " + course.title + " |", "| 교과목 | " + unit.title + " |", "| 소요 | " + unit.hours + "시수(약 " + mins + "분) |");
    L.push("| 대상 | " + (course.target || "직업훈련 수강생") + " |");
    L.push("| 학습모듈 | " + unit.modules.map(function (m) { return m.title + "(" + fmtMin(m.minutes) + ")"; }).join(", ") + " |");
    L.push("| NCS 능력단위 | " + ((unit.ncs || []).map(ncsLine).join(", ") || "-") + " |", "");
    if (course.goal) L.push("과정 목표: " + course.goal, "");
    L.push("## 수업 흐름 한눈에 보기", "", "| 단계 | 시간 | 핵심 |", "|---|---|---|");
    var steps = unitSteps(unit);
    steps.forEach(function (s) {
      L.push("| " + s.heading.replace(/ \([^)]*\)$/, "").replace(/ - .*$/, "") + " | " + fmtMin(s.f.minutes) + " | " + s.f.title + " |");
    });
    L.push("| **합계** | **" + fmtMin(mins) + "** | " + unit.modules.length + "개 학습모듈 |", "");
    L.push("## 진행", "");
    L.push("각 단계는 **강사 활동 → 설명 내용 → 멘트 예시 → 학생 활동** 순으로 구성한다. 괄호 안은 해당 단계의 소요 시간이다.", "");
    steps.forEach(function (s) {
      var m = unit.modules[s.module];
      var g = (m.content && m.content.guide && m.content.guide[s.flow]) || "";
      L.push("### " + s.heading, "");
      L.push(g || "**설명 내용**: " + s.f.title + "\n**학생 활동**: (활동을 입력하세요)", "");
    });
    L.push("## 평가·체크포인트", "");
    unit.modules.forEach(function (m, mi) {
      var qn = (m.questions || []).length;
      L.push("- " + m.title + ": 학습 후 체크리스트 " + (m.objectives || []).length + "항목" + (qn ? ", 문제은행 " + qn + "문항" : ""));
    });
    L.push("", "## 강사 유의사항", "");
    L.push("- 각 단계 제목 옆 시간은 계획 시간이다. 실습 진행 상황에 따라 전개 단계 안에서 조정한다.");
    L.push("- 학습자용 교재는 경어체로 작성되어 있다. 교재 문장을 그대로 읽기보다 사례로 풀어 설명한다.");
    L.push("- AI가 생성한 초안이므로 강의 전 내용과 NCS 대응을 검토·보완한다.", "");
    return L.join("\n");
  }

  /* 단원 슬라이드 편성안 — 기존 편성안 형식 (### 슬라이드 N - 제목) */
  function deckMd(course, unit) {
    var L = [];
    var n = 1;
    L.push("---", "교과목: " + unit.title, "주제: " + unit.title, "date: " + todayStr(), "status: 초안(과정 설계)", "---", "");
    L.push("# 슬라이드 편성안 - " + unit.title, "", "## 슬라이드 편성", "");
    L.push("### 슬라이드 " + (n++) + " - 표지", "- 대응 교수안: -", "- 슬라이드 문구:", "  - (제목) " + unit.title,
      "  - (부제) " + course.title + " · " + unit.hours + "시간", "- 이미지/시각: 단원 주제를 상징하는 대표 일러스트", "");
    L.push("### 슬라이드 " + (n++) + " - 목차", "- 대응 교수안: -", "- 슬라이드 문구:", "  - 오늘의 학습모듈");
    unit.modules.forEach(function (m, i) { L.push("  - " + (i + 1) + ". " + m.title + " (" + fmtMin(m.minutes) + ")"); });
    L.push("- 이미지/시각: 단계를 잇는 흐름 그래픽", "");
    var steps = unitSteps(unit);
    unit.modules.forEach(function (m, mi) {
      var label = (steps.filter(function (s) { return s.module === mi; })[0] || {}).heading || "";
      L.push("### 슬라이드 " + (n++) + " - 학습목표: " + m.title, "- 대응 교수안: " + label.replace(/ - .*$/, ""), "- 슬라이드 문구:");
      (m.objectives || []).forEach(function (o, oi) { L.push("  - " + (oi + 1) + ". " + o); });
      L.push("- 이미지/시각: 목표 체크 아이콘", "- 핵심 메시지: " + fmtMin(m.minutes) + " 동안 " + ((m.objectives || []).length || 1) + "가지를 할 수 있게 됩니다.", "");
      var slides = (m.content && m.content.slides) || "";
      if (slides.trim()) {
        slides.split(/\n(?=###\s)/).forEach(function (block) {
          block = block.trim();
          if (!block) return;
          var bl = block.split("\n");
          var title = bl[0].replace(/^###\s*/, "").replace(/^슬라이드\s*\d*\s*[-–—:.]?\s*/, "").trim();
          bl[0] = "### 슬라이드 " + (n++) + " - " + (title || m.title);
          if (!/대응\s*교수안/.test(block)) bl.splice(1, 0, "- 대응 교수안: " + label.replace(/ - .*$/, ""));
          L.push(bl.join("\n"), "");
        });
      } else {
        (m.flow || []).filter(function (f) { return f.phase === "전개"; }).forEach(function (f) {
          L.push("### 슬라이드 " + (n++) + " - " + f.title, "- 대응 교수안: " + label.replace(/ - .*$/, ""), "- 슬라이드 문구:",
            "  - " + f.title, "  - (" + fmtMin(f.minutes) + ")", "- 이미지/시각: 관련 이미지", "- 핵심 메시지: " + f.title, "");
        });
      }
      L.push("### 슬라이드 " + (n++) + " - 체크리스트: " + m.title, "- 대응 교수안: 정리", "- 슬라이드 문구:");
      (m.objectives || []).forEach(function (o, oi) {
        var item = m.content && m.content.checklist && m.content.checklist[oi];
        L.push("  - □ " + (item ? (item.text || item) : o));
      });
      L.push("- 이미지/시각: 체크리스트", "");
    });
    L.push("### 슬라이드 " + (n++) + " - 마무리", "- 대응 교수안: 정리", "- 슬라이드 문구:", "  - (큰 문구) " + unit.title,
      "  - 체크리스트로 스스로 확인합니다", "- 이미지/시각: 다음 단계로 나아가는 장면", "- 핵심 메시지: 목표를 확인하고 마무리합니다.", "");
    L.push("## 비고", "", "- 과정 설계에서 생성한 초안입니다. 문구·이미지 제안을 검토해 사용하세요.", "");
    return L.join("\n");
  }

  K.course = {
    BANDS: BANDS, QUESTION_BANDS: QUESTION_BANDS, MAX_OBJECTIVES: MAX_OBJECTIVES, MODULE_MAX_MIN: MODULE_MAX_MIN,
    uid: uid, todayStr: todayStr, fmtMin: fmtMin,
    parseTopicInput: parseTopicInput, allocateHours: allocateHours, allocate: allocate,
    defaultFlow: defaultFlow, defaultModules: defaultModules, newUnit: newUnit, buildCourse: buildCourse,
    normalizeUnit: normalizeUnit, courseHours: courseHours,
    lintObjective: lintObjective, lintText: lintText,
    newQuestion: newQuestion, validateQuestion: validateQuestion, distribution: distribution, questionsToCsv: questionsToCsv,
    ncsUnit: ncsUnit, ncsSearch: ncsSearch, ncsSubdList: ncsSubdList, objectiveRefs: objectiveRefs,
    courseMd: courseMd, textbookMd: textbookMd, textbookModuleMd: textbookModuleMd, lessonPlanMd: lessonPlanMd, deckMd: deckMd, unitSteps: unitSteps
  };
})();
