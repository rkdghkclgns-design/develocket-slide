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
      return newModule({ title: t, minutes: m, flow: defaultFlow(m, n === 1 ? unitTitle : MODULE_SUFFIX[i]) });
    });
  }

  /* ---------- 학습모듈(블록) — LMS 메타데이터 포함 ----------
   * status: 작성중·검수중·완료·개선필요 (지침: 유지보수 대상은 '개선필요'로 바꾸고 주기적으로 몰아서 처리)
   * tools: 사용 툴과 버전 / prereqs: 선행 학습모듈 / changelog: 변경 이력 / review: 수동 검수 확인 시각
   * ncs: 능력단위요소 대응 {recs, chosen, note} / ills: SVG 삽화 / ideas: 삽화 후보 / gen: 초안 생성 옵션 */
  var STATUSES = ["작성중", "검수중", "완료", "개선필요"];
  function newModule(fields) {
    var m = {
      id: uid("m"), title: "새 블록", minutes: 60, objectives: [], flow: null, content: null, questions: [],
      status: "작성중", category: "", tools: [], prereqs: [], changelog: [{ at: Date.now(), t: "학습모듈 생성" }],
      review: {}, ncs: { recs: [], chosen: [], note: "" }, ills: [], ideas: [], gen: {}
    };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) m[k] = fields[k];
    if (!m.flow) m.flow = defaultFlow(m.minutes, m.title);
    return m;
  }
  /* 예전에 저장된 모듈에 빠진 필드를 채운다 (체크리스트 다시 볼 곳 포함) */
  function ensureModule(m) {
    var d = newModule({});
    ["status", "category", "tools", "prereqs", "changelog", "review", "ncs", "ills", "ideas", "gen", "questions", "objectives"].forEach(function (k) {
      if (m[k] == null) m[k] = d[k];
    });
    if (!m.ncs.recs) m.ncs.recs = [];
    if (!m.ncs.chosen) m.ncs.chosen = [];
    if (m.content && m.content.checklist) {
      m.content.checklist = m.content.checklist.map(function (c, i) {
        var o = typeof c === "string" ? { text: c } : c;
        if (!o.ref) o.ref = "학습내용 " + (i + 1);
        return o;
      });
    }
    (m.questions || []).forEach(function (q) { if (!q.rubric) q.rubric = []; });
    // 예전에 줄글로 써 둔 교재는 기존 교안 양식(글머리 문장·## 소주제)으로 한 번 바꿔 저장한다
    if (m.content && !m.content.lessonFmt) {
      var cc = m.content, changed = false;
      var ov = String(cc.overview || "").trim();
      if (ov && !/^\s*[-*]\s/m.test(ov)) { cc.overview = sentences(ov).map(function (s) { return "- " + s; }).join("\n"); changed = true; }
      (cc.sections || []).forEach(function (s) {
        var nb = lessonBody(s.body);
        if (String(s.body || "").trim() && nb !== String(s.body).trim()) { s.body = nb; changed = true; }
      });
      cc.lessonFmt = 1;
      if (changed) logChange(m, "기존 교안 양식으로 정리 (줄글 → 글머리 문장, 소제목 ##)");
    }
    return m;
  }
  function ensureCourse(c) {
    if (!c) return c;
    if (!c.trash) c.trash = [];
    (c.units || []).forEach(function (u) { (u.modules || []).forEach(ensureModule); });
    return c;
  }
  function logChange(m, text) {
    m.changelog = (m.changelog || []).concat([{ at: Date.now(), t: text }]);
  }
  function allModules(course) {
    var out = [];
    ((course && course.units) || []).forEach(function (u, ui) { (u.modules || []).forEach(function (m, mi) { out.push({ unit: u, ui: ui, module: m, mi: mi }); }); });
    return out;
  }
  /* 선행 학습모듈: 이름이 같은 등록 모듈과 연결 (이름이 바뀌어도 id 로 유지) */
  function findPrereq(course, p, selfId) {
    var list = allModules(course);
    var hit = p.id ? list.filter(function (x) { return x.module.id === p.id; })[0] : null;
    if (!hit && p.name) hit = list.filter(function (x) { return x.module.title === String(p.name).trim(); })[0];
    if (!hit) return { state: "none" };
    if (hit.module.id === selfId) return { state: "self", module: hit.module };
    return { state: "ok", module: hit.module };
  }

  /* 학습목표 하나를 지우면 학습내용·체크리스트도 함께 지우고, 문항·삽화 번호를 맞춘다
     qMode: "keep"(문항은 남기고 목표 연결 해제) | "delete"(문항도 삭제) */
  function deleteObjective(m, i, qMode) {
    var label = String(m.objectives[i] || "").trim();
    m.objectives.splice(i, 1);
    if (m.content) {
      if (m.content.sections) m.content.sections.splice(i, 1);
      if (m.content.checklist) {
        m.content.checklist.splice(i, 1);
        m.content.checklist.forEach(function (c, j) { if (/^학습내용\s*\d+/.test(c.ref || "")) c.ref = c.ref.replace(/^학습내용\s*\d+/, "학습내용 " + (j + 1)); });
      }
    }
    var no = i + 1;
    var affected = (m.questions || []).filter(function (q) { return q.objective === no; }).length;
    m.questions = (m.questions || []).filter(function (q) { return !(q.objective === no && qMode === "delete"); }).map(function (q) {
      if (q.objective === no) q.objective = null;
      else if (q.objective > no) q.objective -= 1;
      return q;
    });
    (m.ills || []).forEach(function (x) {
      if (x.placement == null) return;
      if (x.placement === i) x.placement = null;
      else if (x.placement > i) x.placement -= 1;
    });
    (m.ncs.recs || []).forEach(function (r) { r.covers = (r.covers || []).filter(function (c) { return c !== i; }).map(function (c) { return c > i ? c - 1 : c; }); });
    m.ideas = (m.ideas || []).filter(function (x) { return x.section !== i; }).map(function (x) { return x.section > i ? Object.assign({}, x, { section: x.section - 1 }) : x; });
    logChange(m, "학습목표 " + no + " 삭제" + (label ? ": " + label.slice(0, 40).trim() : "") +
      (affected ? (qMode === "delete" ? ", 문항 " + affected + "개 삭제" : ", 문항 " + affected + "개 연결 해제") : ""));
    return m;
  }

  /* 학습목표가 n개로 줄었을 때 없어진 번호를 가리키던 연결을 푼다 (문항 → 목표 없음, 삽화 배치 해제, NCS 대응·삽화 아이디어 정리) */
  function trimObjectiveRefs(m, n) {
    (m.questions || []).forEach(function (q) { if (q.objective > n) q.objective = null; });
    (m.ills || []).forEach(function (x) { if (x.placement != null && x.placement >= n) x.placement = null; });
    ((m.ncs && m.ncs.recs) || []).forEach(function (r) { r.covers = (r.covers || []).filter(function (c) { return c < n; }); });
    m.ideas = (m.ideas || []).filter(function (x) { return x.section < n; });
    return m;
  }

  /* 마크다운 이미지 문법이 깨지지 않게: 괄호 등은 퍼센트 인코딩, 대체 글자의 []·줄바꿈 제거 */
  function svgDataUri(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg).replace(/[()'!*]/g, function (ch) { return "%" + ch.charCodeAt(0).toString(16).toUpperCase(); });
  }
  function mdAlt(s) { return String(s || "").replace(/[[\]]+/g, " ").replace(/\s+/g, " ").trim(); }

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
      trash: [],
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
    if (t.length < 18) issues.push("수행의 조건과 제약(무엇을 가지고, 어떤 기준으로)을 함께 적는 것이 좋습니다.");
    return issues;
  }

  /* 교재(학습자용) 본문 어투 검사 → [{sev, msg, sample}] — 규칙은 course-rules.js 와 같다 */
  function lintText(text) {
    var R = K.courseRules;
    if (!R) return [];
    var out = [];
    R.scanText("본문", text, out);
    return out.map(function (x) { return { sev: x.sev, msg: x.msg, sample: x.snip, hits: 1 }; });
  }
  /* 모듈 교재 전체 검수 (개요·목표·내용·체크리스트·1:1 대응) */
  function lintModule(m) { return K.courseRules ? K.courseRules.lintTextbook(m) : []; }

  /* ---------- 문제은행 ---------- */
  function newQuestion(fields) {
    var q = {
      id: uid("q"), objective: 1, band: "L1", type: "객관식", multi: false,
      stem: "", code: "", choices: [], answer: "", accepted: "", rubric: [], tests: "", explanation: "", review: null
    };
    for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) q[k] = fields[k];
    return q;
  }

  /* 문항 검수 — 규칙은 course-rules.js(lintQuestion). 반환: 지적 문구 목록(빈 배열이면 통과) */
  function lintQuestion(q, module) { return K.courseRules ? K.courseRules.lintQuestion(q, module) : []; }
  function validateQuestion(q, module) { return lintQuestion(q, module).map(function (x) { return x.msg; }); }

  /* 목표 × 밴드 분포 */
  function distribution(questions, nObjectives) {
    var rows = [];
    for (var i = 0; i < nObjectives; i++) rows.push({ L1: 0, L2: 0, L3: 0 });
    var total = { L1: 0, L2: 0, L3: 0 };
    (questions || []).forEach(function (q) {
      var r = q.objective ? rows[q.objective - 1] : null; // 연결이 해제된 문항(목표 없음)은 분포에 넣지 않는다
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
    var head = ["문항ID", "단원", "학습모듈", "목표번호", "학습목표", "밴드", "유형", "복수정답", "문항", "보기1", "보기2", "보기3", "보기4", "보기5",
      "정답", "허용표기", "모범답안", "채점기준", "시작코드", "테스트케이스", "루브릭", "해설", "검수"];
    var objs = ctx.objectives || [];
    var rows = [head.map(csvCell).join(",")];
    (questions || []).forEach(function (q) {
      var ch = q.choices || [];
      var answer = q.type === "객관식"
        ? ch.map(function (c, j) { return c.correct ? String(j + 1) : null; }).filter(Boolean).join(", ")
        : (q.type === "단답식" ? (q.answer || "") : "");
      var model = q.type === "서술형" ? (q.answer || "") : "";
      var criteria = q.type === "서술형" ? (q.rubric || []).map(function (r) { return r.criterion + " (" + (r.points || 0) + "점)"; }).join("\n") : "";
      var rubric = q.type === "파일제출" ? (q.rubric || []).map(function (r) {
        return r.criterion + " [충족:" + (r.full || (r.points ? r.points + "점" : "")) + " / 부분:" + (r.partial || "") + " / 미흡:" + (r.none || "") + "]";
      }).join("\n") : "";
      var issues = lintQuestion(q, ctx.module);
      var status = !issues.length ? "검수 통과" : issues.some(function (x) { return x.sev === "bad"; }) ? "필수 위반" : "권장 위반";
      rows.push([q.id, ctx.unit || "", ctx.moduleTitle || "", q.objective == null ? "" : q.objective, (q.objective ? objs[q.objective - 1] : "") || "", q.band, q.type,
        q.multi ? "Y" : "", q.stem, (ch[0] || {}).text, (ch[1] || {}).text, (ch[2] || {}).text, (ch[3] || {}).text, (ch[4] || {}).text,
        answer, String(q.accepted || "").split(/\n|,\s*/).filter(Boolean).join(" / "), model, criteria, q.code, q.tests, rubric, q.explanation,
        status].map(csvCell).join(","));
    });
    return "\uFEFF" + rows.join("\r\n");
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
      if (K.course.sessionTableLines) L.push.apply(L, K.course.sessionTableLines(u)); // 차시 구성 (course-sessions.js)
    });
    return L.join("\n");
  }

  /* ---------- 학습자용 교안(교재) — 기관에서 쓰던 기존 교안 양식 ----------
   * # {학습모듈} 개요(## 학습 목표 · ## 학습 개요) → # {학습내용 제목}(학습목표와 1:1, ## 소주제 + 글머리 문장)
   * → ## ✅ 학습 후 체크리스트 → ## ❗오늘의 퀘스트(기본 실습). 큰 주제 사이는 <br> 여백.
   * 예전에 줄글로 써 둔 본문은 문장마다 글머리로 바꾸고 ### 소제목은 ## 로 올린다(저장된 내용은 그대로).
   * 상태·툴·NCS·변경 이력은 화면에 보이지 않는 주석으로 맨 위에 남긴다. */
  var SECTION_GAP = "<br><br><br><br>";
  function sentences(text) {
    return String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=\S)/).filter(Boolean);
  }
  /* 개요 → 글머리 문장 (이미 글머리면 그 줄들) */
  function overviewBullets(text) {
    var t = String(text || "").trim();
    if (/^\s*[-*]\s/m.test(t)) return t.split("\n").map(function (l) { return l.replace(/^\s*[-*]\s+/, "").trim(); }).filter(Boolean);
    return sentences(t);
  }
  function lessonBody(body) {
    var out = [], para = [], inCode = false;
    var flush = function () { if (para.length) { sentences(para.join(" ")).forEach(function (s) { out.push("- " + s); }); para = []; } };
    String(body || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line) {
      if (/^\s*(```|~~~)/.test(line)) { flush(); inCode = !inCode; out.push(line); return; }
      if (inCode) { out.push(line); return; }
      if (!line.trim()) { flush(); out.push(""); return; }
      var h = line.match(/^\s*#{1,6}\s+(.*)$/);
      if (h) { flush(); out.push("", "## " + h[1].trim()); return; }
      if (/^\s*([-*+]\s|\d+[.)]\s|\||>|!\[|\*\*[^*]+\*\*\s*$|<br)/.test(line)) { flush(); out.push(line); return; }
      para.push(line.trim());
    });
    flush();
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function metaComment(course, unit, m, mi) {
    var tools = (m.tools || []).filter(function (t) { return t.name || t.version; }).map(function (t) { return [t.name, t.version].filter(Boolean).join(" "); });
    var pre = (m.prereqs || []).map(function (p) { var f = findPrereq(course, p, m.id); return f.module ? f.module.title : p.name; }).filter(Boolean);
    var refs = (unit.ncs || []).filter(function (n) {
      return !(n.objectives && n.objectives.length) || n.objectives.some(function (r) { return String(r).split(".")[0] === String(mi + 1); });
    });
    var els = ((m.ncs && m.ncs.chosen) || []).map(function (code) { var f = K.ncsRef ? K.ncsRef.find(code) : null; return code + (f ? " " + (f.elem ? f.elem.name : f.unit.name) : ""); });
    var log = (m.changelog || []).slice(-3).map(function (x) { var d = new Date(x.at); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + " " + x.t; });
    var rows = ["학습모듈 정보", "상태: " + (m.status || "작성중"), "예상 소요 시간: " + fmtMin(m.minutes), "사용 툴과 버전: " + (tools.join(", ") || course.tool || "-"),
      "선행 학습모듈: " + (pre.join(", ") || "없음"), "NCS 능력단위(교과목 대응): " + (refs.map(ncsLine).join(", ") || "-") + (refs.length && unit.ncsAuto ? " (자동 배정 · 확정 전)" : ""),
      "NCS 능력단위요소(학습모듈 대응): " + (els.join(", ") || "-") + (els.length && m.ncs && m.ncs.auto ? " (자동 배정 · 확정 전)" : ""), "변경 이력: " + (log.join(" / ") || "-")];
    return "<!--\n" + rows.join("\n").replace(/--/g, "—") + "\n-->";
  }
  /* 오늘의 퀘스트(기본 실습) — AI 가 쓴 퀘스트, 없으면 실습형 전개 단계로 만든다. 제출 파일명: 날짜_단원-블록_제목_Ver0n_조or이름 */
  function questMd(course, unit, m, mi) {
    var q = (m.content && m.content.quest) || null;
    var title = q && q.title, steps = (q && q.steps) || [];
    if (!title && !steps.length) {
      var st = (m.flow || []).filter(function (f) { return f.phase === "전개" && /실습|활동|작성|만들|분석|설계|기획|발표|구현|제작|적용/.test(f.title); })[0];
      if (!st) return "";
      title = st.title;
      steps = (m.objectives || []).map(function (o) { return "확인 기준: " + o; });
    }
    var d = new Date(), pad = function (n) { return ("0" + n).slice(-2); };
    var file = String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + ((course.units || []).indexOf(unit) + 1) + "-" + (mi + 1) + "_" +
      String(title || m.title).replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 12) + "_Ver0n_조or이름";
    return ["## ❗오늘의 퀘스트(기본 실습)", "", "⚙️" + (title || m.title)].concat(steps.map(function (s) { return "- " + s; }), ["- 제출 파일명: `" + file + "`"]).join("\n");
  }
  function textbookModuleMd(course, unit, mi) {
    var m = unit.modules[mi];
    var c = m.content || {};
    var objs = m.objectives || [];
    var L = [metaComment(course, unit, m, mi), "", "# " + m.title + " 개요", "", "## 학습 목표", ""];
    objs.forEach(function (o) { L.push("- " + o); });
    if (!objs.length) L.push("- (학습목표를 '~할 수 있다'로 작성)");
    L.push("", "## 학습 개요", "");
    var ov = overviewBullets(c.overview);
    if (ov.length) ov.forEach(function (s) { L.push("- " + s); });
    else L.push("- (이 학습모듈을 왜 배우는지 — 문제 상황 / 해결할 것 / 학습 후 가능해지는 것)");
    L.push(SECTION_GAP, "");
    objs.forEach(function (o, i) {
      var sec = (c.sections || [])[i] || {};
      L.push("# " + (sec.title || o), "");
      (m.ills || []).filter(function (x) { return x.placement === i && x.svg; }).forEach(function (x) {
        L.push("![" + (mdAlt(x.caption || x.title) || "삽화") + "](" + svgDataUri(x.svg) + ")", "");
      });
      L.push(lessonBody(sec.body) || "- (학습목표 " + (i + 1) + "에 대응하는 내용)", "");
      L.push(SECTION_GAP, "");
    });
    L.push("## ✅ 학습 후 체크리스트", "");
    objs.forEach(function (o, i) {
      var item = (c.checklist || [])[i];
      var text = item ? (item.text || item) : o.replace(/할\s*수\s*있다\.?$/, "할 수 있습니까?");
      L.push("- [ ] " + text + " → 다시 보기: " + ((item && item.ref) || "학습내용 " + (i + 1)));
    });
    var quest = questMd(course, unit, m, mi);
    if (quest) L.push("", quest);
    L.push("");
    return L.join("\n");
  }

  function textbookMd(course, unit) {
    return unit.modules.map(function (m, mi) { return textbookModuleMd(course, unit, mi); }).join("\n" + SECTION_GAP + "\n\n");
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
    lintObjective: lintObjective, lintText: lintText, lintModule: lintModule, lintQuestion: lintQuestion,
    STATUSES: STATUSES, newModule: newModule, ensureModule: ensureModule, ensureCourse: ensureCourse, logChange: logChange,
    allModules: allModules, findPrereq: findPrereq, deleteObjective: deleteObjective, trimObjectiveRefs: trimObjectiveRefs, svgDataUri: svgDataUri,
    newQuestion: newQuestion, validateQuestion: validateQuestion, distribution: distribution, questionsToCsv: questionsToCsv,
    ncsUnit: ncsUnit, ncsSearch: ncsSearch, ncsSubdList: ncsSubdList, objectiveRefs: objectiveRefs,
    courseMd: courseMd, textbookMd: textbookMd, textbookModuleMd: textbookModuleMd, lessonPlanMd: lessonPlanMd, deckMd: deckMd, unitSteps: unitSteps,
    MIN_PER_HOUR: MIN_PER_HOUR, ncsLine: ncsLine
  };
})();
