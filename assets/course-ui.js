/* course-ui.js — 과정 설계 화면
 *   ① 블록 설계  : 단원(교과목)·학습모듈 블록·흐름별 소요 시간 편집 (합계 시간 검증)
 *   ② NCS 선정   : AI 추천 + 직접 선택 → 선정 목록 저장 (현행 분류 참조 목록 기준)
 *   ③ 문제은행   : 목표×밴드 분포, 문항 생성(AI/빈 문항), 검수, CSV
 *   ④ 산출물     : 교수안.md(기존 형식) · 교재(교습안).md · 슬라이드 편성안 → 검토·빌드
 * 상태는 이 브라우저의 localStorage 에 자동 저장한다. */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var root = document.getElementById("course-root");
  if (!root || !K.course) return;
  var C = K.course;
  var STORE = "kb-course-v1";
  var EXAMPLE = "주제 입력: 생성형 AI와 UGC 산업의 이해\n - 생성형 AI의 종류\n - LLM의 동작 원리\n - UGC 플랫폼 산업의 구조와 크리에이터 이코노미\n - AI 에이전트\n - 이미지, 사운드 생성 등의 AI 도구 생태계\n - AI 생성물의 저작권 및 라이선스";

  var S = {
    course: null, draft: { topic: "", total: 40, target: "직업훈련 수강생(완전 초보)", tool: "" },
    showSetup: false, unit: 0, tab: "blocks", qModule: 0, qBand: "", qObj: "",
    gen: { objective: 1, band: "L1", type: "객관식", multi: false, count: 3 },
    editing: null, qDraft: null, ncsPending: null, ncsQuery: "", bandHelp: true,
    busy: false, progress: null, error: ""
  };

  /* ---------- 저장 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var j = JSON.parse(raw);
      if (j && j.course && j.course.v === 1) S.course = j.course;
      if (j && j.draft) S.draft = j.draft;
      if (j && typeof j.unit === "number") S.unit = j.unit;
    } catch (e) {}
  }
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, JSON.stringify({ course: S.course, draft: S.draft, unit: S.unit })); } catch (e) {}
    }, 250);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function unit() { return S.course && S.course.units[Math.min(S.unit, S.course.units.length - 1)]; }
  function aiReady(role) { return !!(K.ai && K.ai.available(role || "write")); }
  function aiName(role) { return K.ai ? K.ai.providerLabel(K.ai.providerFor(role)) : "없음"; }

  function download(name, text, type) {
    var blob = new Blob([text], { type: (type || "text/markdown") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function safeName(s) { return String(s || "문서").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60); }

  /* ---------- 작업 실행(진행 표시 + 오류 처리) ---------- */
  function run(label, fn) {
    if (S.busy) return;
    S.busy = true; S.error = ""; S.progress = { label: label, done: 0, total: 0 };
    render();
    var prog = function (done, total, l) {
      if (typeof done === "string") { S.progress.label = done; }
      else { S.progress.done = done; S.progress.total = total; if (l) S.progress.label = l; }
      renderProgress();
    };
    Promise.resolve().then(function () { return fn(prog); }).then(function () {
      S.busy = false; S.progress = null; save(); render();
    }, function (err) {
      console.error(err);
      S.busy = false; S.progress = null;
      S.error = (err && err.message) || String(err);
      save(); render();
    });
  }

  /* ================= 렌더 ================= */
  function render() {
    var html = renderHead();
    if (S.progress || S.error) html += '<div id="cs-progress">' + progressHtml() + "</div>";
    if (!S.course || S.showSetup) html += renderSetup();
    if (S.course && !S.showSetup) {
      html += renderSummary();
      html += renderTabs();
      var u = unit();
      if (S.tab === "blocks") html += renderBlocks(u);
      else if (S.tab === "ncs") html += renderNcs(u);
      else if (S.tab === "qbank") html += renderQbank(u);
      else html += renderOutputs(u);
    }
    root.innerHTML = html;
    root.classList.toggle("is-busy", S.busy);
  }

  function progressHtml() {
    if (S.error) return '<div class="cs-error">⚠ ' + esc(S.error) + ' <button class="cs-link" data-act="clear-error">닫기</button></div>';
    var p = S.progress;
    var pct = p.total ? Math.round((p.done / p.total) * 100) : 8;
    return '<div class="cs-progress"><span class="cs-spin">🍁</span><span>' + esc(p.label) + "</span>" +
      '<div class="cs-pbar"><i style="width:' + pct + '%"></i></div></div>';
  }
  function renderProgress() {
    var el = document.getElementById("cs-progress");
    if (el) el.innerHTML = progressHtml();
  }

  function routeChip() {
    var t = (K.app && K.app.refreshAi && document.getElementById("ai-route")) ? document.getElementById("ai-route").textContent : "";
    return t ? '<span class="cs-route">' + esc(t) + "</span>" : '<span class="cs-route off">AI 키 없음 — 기본 배분·템플릿·직접 입력으로 작업합니다</span>';
  }

  function renderHead() {
    return '<div class="cs-head"><h2>🧩 과정 설계</h2>' + routeChip() + '<div class="cs-spacer"></div>' +
      (S.course ? '<button class="btn btn-ghost" data-act="show-setup">✎ 주제 다시 입력</button>' +
        '<button class="btn btn-ghost" data-act="dl-course">⤓ 과정 설계서.md</button>' +
        '<button class="btn btn-ghost" data-act="new-course">새 과정</button>' : "") + "</div>";
  }

  function renderSetup() {
    var d = S.draft;
    return '<div class="cs-card cs-setup">' +
      "<h3>주제 입력</h3>" +
      '<p class="cs-sub">과정 주제와 단원(하위 주제)을 한 줄씩 적습니다. 단원 하나가 하나의 교과목이 되고, 총 시간을 단원별로 나눈 뒤 각 단원을 학습모듈 <b>블록</b>으로 쪼개 교안을 만듭니다.</p>' +
      '<textarea id="cs-topic" class="cs-topic" spellcheck="false" placeholder="' + esc(EXAMPLE) + '">' + esc(d.topic) + "</textarea>" +
      '<div class="cs-row"><label>총 시간 <input type="number" id="cs-total" min="1" max="400" value="' + esc(d.total) + '"> 시간</label>' +
      '<label>대상 <input id="cs-target" value="' + esc(d.target) + '"></label>' +
      '<label>사용 툴과 버전 <input id="cs-tool" placeholder="예: ChatGPT·Gemini 웹(2026-10 기준)" value="' + esc(d.tool) + '"></label></div>' +
      '<div class="cs-actions">' +
      '<button class="btn btn-primary" data-act="plan-ai"' + (aiReady("plan") ? "" : " disabled") + ">✨ AI로 블록 설계</button>" +
      '<button class="btn btn-ghost" data-act="plan-basic">기본 배분으로 시작</button>' +
      '<button class="btn btn-ghost" data-act="fill-example">예시 넣기</button>' +
      (S.course ? '<button class="btn btn-ghost" data-act="hide-setup">취소</button>' : "") + "</div>" +
      '<p class="cs-hint">AI 블록 설계는 과정 목표·단원별 시간·블록(학습목표 3개 이하, 도입·전개·정리 시간)을 제안합니다. ' +
      (aiReady("plan") ? "사용 AI: " + esc(aiName("plan")) : "AI 키가 없으면 '기본 배분'으로 시작해 직접 채울 수 있어요.") + "</p></div>";
  }

  function unitBadges(u) {
    var q = u.modules.reduce(function (a, m) { return a + (m.questions || []).length; }, 0);
    var b = "";
    if (u.outputs) b += '<i title="교안 생성됨">📝</i>';
    if (u.ncs && u.ncs.length) b += '<i title="NCS ' + u.ncs.length + '개 선정">🏷</i>';
    if (q) b += '<i title="문항 ' + q + '개">❓' + q + "</i>";
    return b;
  }

  function renderSummary() {
    var c = S.course;
    var sum = C.courseHours(c);
    var ok = sum === Number(c.totalHours);
    var segs = c.units.map(function (u, i) {
      return '<button class="cs-seg' + (i === S.unit ? " on" : "") + '" style="flex:' + Math.max(1, u.hours) + '" data-act="pick-unit" data-u="' + i + '" title="' +
        esc((i + 1) + ". " + u.title + " — " + u.hours + "시간") + '">' + (i + 1) + " · " + u.hours + "h</button>";
    }).join("");
    var chips = c.units.map(function (u, i) {
      return '<button class="cs-chip' + (i === S.unit ? " on" : "") + '" data-act="pick-unit" data-u="' + i + '"><b>' + (i + 1) + "</b> " + esc(u.title) +
        ' <span class="cs-chip-h">' + u.hours + "h</span>" + unitBadges(u) + "</button>";
    }).join("");
    return '<div class="cs-card cs-summary">' +
      '<div class="cs-sum-top"><input class="cs-title" data-f="course.title" value="' + esc(c.title) + '">' +
      '<span class="cs-total ' + (ok ? "ok" : "warn") + '">합계 ' + sum + " / " + c.totalHours + "시간" + (ok ? " ✓" : " — 단원 시간을 조정하세요") + "</span>" +
      (ok ? "" : '<button class="btn btn-ghost" data-act="fit-hours">비율대로 맞추기</button>') + "</div>" +
      '<label class="cs-lab">과정 목표 <span class="cs-muted">(수료 시 도달할 최종 목표)</span></label>' +
      '<textarea class="cs-goal" data-f="course.goal" rows="2" placeholder="예: 생성형 AI의 원리와 UGC 산업 구조를 바탕으로 AI 도구를 활용한 콘텐츠 제작 기획서를 저작권 기준에 맞게 작성할 수 있다">' + esc(c.goal) + "</textarea>" +
      '<div class="cs-timebar">' + segs + "</div>" +
      '<div class="cs-chips">' + chips + "</div></div>";
  }

  function renderTabs() {
    var tabs = [["blocks", "① 블록 설계"], ["ncs", "② NCS 선정"], ["qbank", "③ 문제은행"], ["outputs", "④ 산출물"]];
    return '<div class="cs-tabs">' + tabs.map(function (t) {
      return '<button class="cs-tab' + (S.tab === t[0] ? " on" : "") + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>";
  }

  /* ---------- ① 블록 설계 ---------- */
  function renderTimetable() {
    var rows = S.course.units.map(function (u, i) {
      return "<tr" + (i === S.unit ? ' class="on"' : "") + '><td><button class="cs-link" data-act="pick-unit" data-u="' + i + '">' + (i + 1) + ". " + esc(u.title) + "</button></td><td>" + u.hours + "시간</td><td>" +
        u.modules.map(function (m) { return esc(m.title) + ' <span class="cs-muted">(' + C.fmtMin(m.minutes) + ")</span>"; }).join("<br>") + "</td></tr>";
    }).join("");
    return '<details class="cs-card cs-tt"><summary>전체 단원 시간표 · 블록별 소요 시간</summary><table class="cs-table"><thead><tr><th>단원(교과목)</th><th>시간</th><th>학습모듈 블록</th></tr></thead><tbody>' +
      rows + '</tbody><tfoot><tr><td>합계</td><td>' + C.courseHours(S.course) + "시간</td><td></td></tr></tfoot></table></details>";
  }

  function renderBlocks(u) {
    var total = u.hours * 60;
    var msum = u.modules.reduce(function (a, m) { return a + m.minutes; }, 0);
    var blocks = u.modules.map(function (m, mi) {
      var fsum = (m.flow || []).reduce(function (a, f) { return a + (Number(f.minutes) || 0); }, 0);
      var objLint = m.objectives.map(function (o, oi) {
        var is = C.lintObjective(o);
        return is.length ? "<li><b>" + (oi + 1) + ".</b> " + esc(is.join(" ")) + "</li>" : "";
      }).join("");
      if (m.objectives.length > C.MAX_OBJECTIVES) objLint += "<li>학습목표가 " + m.objectives.length + "개입니다. 3개 이하를 권장하며, 4개 이상이면 블록 분할을 검토합니다.</li>";
      if (!m.objectives.length) objLint += "<li>학습목표가 없습니다. '~할 수 있다'로 1~3개 작성하세요.</li>";
      var flow = (m.flow || []).map(function (f, k) {
        return "<tr><td><select data-f=\"flow.phase\" data-m=\"" + mi + '" data-k="' + k + '">' +
          ["도입", "전개", "정리"].map(function (p) { return "<option" + (p === f.phase ? " selected" : "") + ">" + p + "</option>"; }).join("") +
          '</select></td><td><input data-f="flow.title" data-m="' + mi + '" data-k="' + k + '" value="' + esc(f.title) + '"></td>' +
          '<td class="cs-num"><input type="number" min="5" step="5" data-f="flow.minutes" data-m="' + mi + '" data-k="' + k + '" value="' + f.minutes + '">분</td>' +
          '<td><button class="cs-x" data-act="del-flow" data-m="' + mi + '" data-k="' + k + '" title="단계 삭제">✕</button></td></tr>';
      }).join("");
      var content = m.content
        ? '<div class="cs-done">✓ 교재·교수안 작성됨 <span class="cs-muted">(' + esc(m.content.by || "") + ")</span>" +
          (m.content.lint && m.content.lint.length ? ' · <span class="cs-warn">어투 점검 ' + m.content.lint.length + "건</span>" : " · 어투 점검 통과") + "</div>"
        : "";
      return '<div class="cs-block">' +
        '<div class="cs-block-head"><span class="cs-block-no">블록 ' + (S.unit + 1) + "-" + (mi + 1) + "</span>" +
        '<input class="cs-block-title" data-f="module.title" data-m="' + mi + '" value="' + esc(m.title) + '">' +
        '<label class="cs-num"><input type="number" min="10" step="5" data-f="module.minutes" data-m="' + mi + '" value="' + m.minutes + '">분</label>' +
        '<span class="cs-time">' + C.fmtMin(m.minutes) + "</span>" +
        '<button class="cs-x" data-act="del-module" data-m="' + mi + '" title="블록 삭제">✕</button></div>' +
        '<div class="cs-block-grid"><div><label class="cs-lab">학습목표 <span class="cs-muted">(한 줄에 하나 · 3개 이하 · \'~할 수 있다\')</span></label>' +
        '<textarea rows="4" data-f="module.objectives" data-m="' + mi + '" placeholder="예: LLM이 다음 토큰을 고르는 과정을 예시 문장으로 단계별 설명할 수 있다">' + esc(m.objectives.join("\n")) + "</textarea>" +
        (objLint ? '<ul class="cs-lint">' + objLint + "</ul>" : '<div class="cs-ok">학습목표 지침 충족</div>') + "</div>" +
        '<div><label class="cs-lab">진행 흐름 · 각부 소요 시간</label><table class="cs-flow">' + flow + "</table>" +
        '<div class="cs-flow-foot"><span class="' + (fsum === m.minutes ? "cs-ok" : "cs-warn") + '">단계 합계 ' + fsum + "분" + (fsum === m.minutes ? " ✓" : " ≠ 블록 " + m.minutes + "분") + "</span>" +
        '<button class="cs-link" data-act="add-flow" data-m="' + mi + '">＋ 단계</button>' +
        (fsum === m.minutes ? "" : '<button class="cs-link" data-act="fit-unit">시간 맞추기</button>') + "</div></div></div>" + content + "</div>";
    }).join("");
    return renderTimetable() + '<div class="cs-card">' +
      '<div class="cs-card-head"><h3>단원 ' + (S.unit + 1) + "</h3>" +
      '<input class="cs-unit-title" data-f="unit.title" value="' + esc(u.title) + '">' +
      '<label class="cs-num">시간 <input type="number" min="1" max="200" data-f="unit.hours" value="' + u.hours + '"> 시간</label>' +
      '<span class="' + (msum === total ? "cs-ok" : "cs-warn") + '">블록 합계 ' + C.fmtMin(msum) + (msum === total ? " ✓" : " ≠ " + C.fmtMin(total)) + "</span>" +
      (msum === total ? "" : '<button class="btn btn-ghost" data-act="fit-unit">시간 맞추기</button>') + "</div>" +
      blocks +
      '<div class="cs-actions">' +
      '<button class="btn btn-ghost" data-act="add-module">＋ 블록 추가</button>' +
      '<button class="btn btn-ghost" data-act="replan-unit"' + (aiReady("plan") ? "" : " disabled") + ">✨ 이 단원 블록 다시 설계</button>" +
      '<div class="cs-spacer"></div>' +
      '<button class="btn btn-primary" data-act="gen-unit"' + (aiReady("write") ? "" : " disabled") + ">📝 이 단원 교안 생성 (교수안·교재·슬라이드)</button>" +
      "</div>" +
      '<p class="cs-hint">교안 생성: 블록마다 학습자용 교재(개요→학습목표→학습내용→체크리스트)와 강사용 교수안 단계, 슬라이드를 만듭니다. ' +
      (K.AI && K.AI.isMixed && K.AI.isMixed() ? "혼합 모드: Claude가 교재·교수안을 쓰고 Gemini가 슬라이드로 요약합니다." : "사용 AI: " + esc(aiName("write"))) + "</p></div>";
  }

  /* ---------- ② NCS 선정 ---------- */
  function ncsItem(n, checked, opts) {
    opts = opts || {};
    var path = (n.path || []).join(" › ");
    var score = n.score != null ? n.score : n.match;
    return '<label class="cs-ncs' + (checked ? " on" : "") + '"><input type="checkbox" data-act="ncs-toggle" data-code="' + esc(n.code) + '"' + (checked ? " checked" : "") + ">" +
      '<div class="cs-ncs-main"><div class="cs-ncs-name">' + esc(n.name) + "</div>" +
      '<dl class="cs-ncs-dl"><dt>단위 코드</dt><dd class="mono">' + esc(n.code) + "</dd><dt>분류</dt><dd>" + esc(path) + "</dd><dt>수준</dt><dd>" + esc(n.level) + "수준</dd></dl>" +
      (n.objectives && n.objectives.length ? '<div class="cs-ncs-obj">학습목표 ' + n.objectives.map(esc).join(" · ") + "</div>" : "") +
      (n.reason ? '<p class="cs-ncs-why">' + esc(n.reason) + "</p>" : "") +
      (opts.showDuty && n.duty ? '<p class="cs-ncs-duty">' + esc(n.duty) + "</p>" : "") + "</div>" +
      '<div class="cs-ncs-side"><span class="cs-badge ref">참조 목록</span>' + (n.cross ? '<span class="cs-badge cross">교차 검증</span>' : "") +
      (score != null ? '<div class="cs-meter"><i style="width:' + Math.max(0, Math.min(100, score)) + '%"></i></div><span class="cs-score">적합도 <b>' + score + "</b></span>" : "") +
      (n.by ? '<span class="cs-muted">' + esc(n.by) + "</span>" : "") + "</div></label>";
  }

  function pending(u) {
    if (!S.ncsPending) S.ncsPending = (u.ncs || []).map(function (n) { return n.code; });
    return S.ncsPending;
  }

  function renderNcs(u) {
    var sel = pending(u);
    var saved = (u.ncs || []).map(function (n) { return n.code; });
    var dirty = sel.join() !== saved.join();
    var lookup = function (code) {
      var d = (u.ncsDraft || []).filter(function (x) { return x.code === code; })[0];
      var s = (u.ncs || []).filter(function (x) { return x.code === code; })[0];
      return d || s || C.ncsUnit(code);
    };
    var selected = sel.map(function (code) {
      var n = lookup(code);
      return n ? '<div class="cs-sel"><span class="mono">' + esc(n.code) + "</span> " + esc(n.name) + ' <span class="cs-muted">' + esc(n.level) + "수준 · " + esc((n.path || [])[3] || "") + "</span>" +
        '<button class="cs-x" data-act="ncs-toggle" data-code="' + esc(code) + '" title="선정 해제">✕</button></div>' : "";
    }).join("") || '<p class="cs-muted">아직 선정한 능력단위가 없습니다.</p>';
    var draft = (u.ncsDraft || []).map(function (n) { return ncsItem(n, sel.indexOf(n.code) !== -1); }).join("") ||
      '<p class="cs-muted">' + (aiReady("plan") ? "'추천 받기'를 누르면 단원 학습목표에 맞는 능력단위를 현행 분류 목록에서 추천합니다." : "AI 키가 없어 키워드 검색으로 추천합니다. '추천 받기'를 누르세요.") + "</p>";
    var q = S.ncsQuery.trim();
    var found = q ? C.ncsSearch(q, 12, { perSubd: 6 }) : [];
    var direct = q ? (found.map(function (n) { return ncsItem(n, sel.indexOf(n.code) !== -1, { showDuty: false }); }).join("") || '<p class="cs-muted">검색 결과가 없습니다.</p>') : "";
    return '<div class="cs-card"><div class="cs-card-head"><h3>NCS 선정 — 단원 ' + (S.unit + 1) + ". " + esc(u.title) + '</h3><div class="cs-spacer"></div>' +
      '<button class="btn btn-ghost" data-act="ncs-cancel"' + (dirty ? "" : " disabled") + ">변경 취소</button>" +
      '<button class="btn btn-primary" data-act="ncs-save"' + (dirty ? "" : " disabled") + ">저장</button></div>" +
      '<p class="cs-sub">AI 추천이나 직접 선택에서 체크한 항목이 여기에 모입니다. 교과목(단원)에 능력단위를 대응시키며, 하나의 교과목이 여러 능력단위를 묶을 수 있습니다.' + (dirty ? ' <b class="cs-warn">저장하지 않은 변경이 있습니다.</b>' : "") + "</p>" +
      '<div class="cs-sels">' + selected + "</div></div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>AI 추천</h3><span class="cs-muted">' + (aiReady("plan") ? (K.AI.isMixed() ? "Claude·Gemini 교차 판단" : esc(aiName("plan"))) : "키워드 검색") + '</span><div class="cs-spacer"></div>' +
      '<button class="btn btn-ghost" data-act="ncs-recommend">' + ((u.ncsDraft || []).length ? "다시 추천" : "추천 받기") + "</button></div>" + draft + "</div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>직접 선택</h3><input class="cs-search" id="cs-ncs-q" placeholder="능력단위·세분류 키워드 (예: 프롬프트, 저작권, 소셜미디어)" value="' + esc(S.ncsQuery) + '"></div>' +
      direct + '<p class="cs-foot">기준: NCS ' + esc((K.NCS && K.NCS.degree) || "") + "차 분류체계 참조 목록(" + esc((K.NCS && K.NCS.collectedAt) || "") + " ncs.go.kr 수집, " + ((K.NCS && K.NCS.units.length) || 0) +
      '개 능력단위). 분류번호는 현행 체계를 그대로 쓰며 개정 시 코드가 바뀔 수 있으니 사용 전 <a href="https://www.ncs.go.kr/unity/th03/ncsSearchMain.do" target="_blank" rel="noopener noreferrer">ncs.go.kr</a>에서 확인하세요. 능력단위요소는 학습모듈(블록)에 대응시킵니다.</p></div>';
  }

  /* ---------- ③ 문제은행 ---------- */
  function curModule(u) { return u.modules[Math.min(S.qModule, u.modules.length - 1)]; }

  function qStatus(q, m) {
    var issues = C.validateQuestion(q, m);
    var ai = q.review ? ' <span class="cs-muted">AI 교차 검수 · ' + esc(q.review.by) + (q.review.ok ? " ✓" : " ✕") + "</span>" : "";
    return { issues: issues, html: (issues.length ? '<span class="cs-qstat bad" title="' + esc(issues.join("\n")) + '">검수 필요</span>' : '<span class="cs-qstat ok">검수 통과</span>') + ai };
  }

  function qView(q, m) {
    var st = qStatus(q, m);
    var h = '<div class="cs-q"><div class="cs-q-head"><span class="cs-band b-' + q.band + '">' + q.band + "</span><b>" + esc(q.type) + "</b>" +
      '<span class="cs-muted">목표 ' + q.objective + "</span>" + (q.multi ? '<span class="cs-badge">복수 정답</span>' : "") + '<div class="cs-spacer"></div>' + st.html + "</div>";
    h += '<div class="cs-q-stem">' + esc(q.stem) + "</div>";
    if (q.code) h += '<div class="cs-code"><div>시작 코드</div><pre>' + esc(q.code) + "</pre></div>";
    if (q.type === "객관식") {
      h += '<ol class="cs-choices">' + (q.choices || []).map(function (c) { return "<li" + (c.correct ? ' class="ok"' : "") + ">" + esc(c.text) + (c.correct ? " ✓" : "") + "</li>"; }).join("") + "</ol>";
    }
    if (q.type === "단답식") h += '<p class="cs-ans">정답: <b>' + esc(q.answer) + "</b>" + (q.accepted ? " · 허용 표기: " + esc(q.accepted) : "") + "</p>";
    if ((q.rubric || []).length) {
      var tot = q.rubric.reduce(function (a, r) { return a + (Number(r.points) || 0); }, 0);
      h += '<table class="cs-rub"><thead><tr><th>' + (q.type === "파일제출" ? "루브릭 평가 기준" : "채점 요소") + "</th><th>점수</th></tr></thead><tbody>" +
        q.rubric.map(function (r) { return "<tr><td>" + esc(r.criterion) + "</td><td>" + esc(r.points) + "</td></tr>"; }).join("") +
        "</tbody><tfoot><tr><td>합계</td><td>" + tot + "</td></tr></tfoot></table>";
    }
    if (q.tests) h += '<div class="cs-code"><div>기대 출력 · 테스트 케이스</div><pre>' + esc(q.tests) + "</pre></div>";
    if (q.explanation) h += '<p class="cs-expl">해설: ' + esc(q.explanation) + "</p>";
    if (st.issues.length) h += '<ul class="cs-lint">' + st.issues.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>";
    h += '<div class="cs-q-act"><button class="btn btn-ghost" data-act="q-edit" data-q="' + q.id + '">편집</button><button class="cs-danger" data-act="q-del" data-q="' + q.id + '">삭제</button></div></div>';
    return h;
  }

  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + esc(label) + "</option>"; }

  function qEdit(m) {
    var q = S.qDraft;
    var types = C.BANDS[q.band].types;
    var h = '<div class="cs-q editing"><div class="cs-q-form">' +
      '<label>학습목표 <select data-qf="objective">' + m.objectives.map(function (o, i) { return opt(i + 1, (i + 1) + ". " + o.slice(0, 30), q.objective); }).join("") + "</select></label>" +
      '<label>밴드 <select data-qf="band">' + C.QUESTION_BANDS.map(function (b) { return opt(b, b + " · " + C.BANDS[b].name, q.band); }).join("") + "</select></label>" +
      '<label>유형 <select data-qf="type">' + types.map(function (t) { return opt(t, t, q.type); }).join("") + "</select></label>" +
      (q.type === "객관식" ? '<label class="cs-check"><input type="checkbox" data-qf="multi"' + (q.multi ? " checked" : "") + "> 복수 정답</label>" : "") + "</div>" +
      '<label class="cs-lab">문항</label><textarea rows="3" data-qf="stem">' + esc(q.stem) + "</textarea>";
    if (q.type === "코드제출" || q.code) h += '<label class="cs-lab">시작 코드</label><textarea rows="4" class="mono" data-qf="code">' + esc(q.code) + "</textarea>";
    if (q.type === "객관식") {
      h += '<label class="cs-lab">보기 <span class="cs-muted">(정답에 체크)</span></label>' + q.choices.map(function (c, i) {
        return '<div class="cs-chrow"><span>' + (i + 1) + '.</span><input data-qf="choice" data-i="' + i + '" value="' + esc(c.text) + '">' +
          '<label class="cs-check"><input type="checkbox" data-qf="correct" data-i="' + i + '"' + (c.correct ? " checked" : "") + "> 정답</label>" +
          '<button class="cs-x" data-act="q-choice-del" data-i="' + i + '">✕</button></div>';
      }).join("") + '<button class="cs-link" data-act="q-choice-add">＋ 보기 추가</button>';
    }
    if (q.type === "단답식") {
      h += '<div class="cs-q-form"><label>정답 <input data-qf="answer" value="' + esc(q.answer) + '"></label>' +
        '<label>허용 표기 <input data-qf="accepted" placeholder="대소문자·띄어쓰기·동의어" value="' + esc(q.accepted) + '"></label></div>';
    }
    if (q.type === "서술형" || q.type === "파일제출") {
      h += '<label class="cs-lab">' + (q.type === "파일제출" ? "채점 루브릭" : "요소별 채점 기준") + "</label>" + (q.rubric || []).map(function (r, i) {
        return '<div class="cs-chrow"><input data-qf="rub-c" data-i="' + i + '" value="' + esc(r.criterion) + '" placeholder="관찰 가능한 기준">' +
          '<input type="number" class="cs-pts" data-qf="rub-p" data-i="' + i + '" value="' + esc(r.points) + '"> 점' +
          '<button class="cs-x" data-act="q-rub-del" data-i="' + i + '">✕</button></div>';
      }).join("") + '<button class="cs-link" data-act="q-rub-add">＋ 기준 추가</button>';
    }
    if (q.type === "코드제출") h += '<label class="cs-lab">기대 출력 · 테스트 케이스</label><textarea rows="3" class="mono" data-qf="tests">' + esc(q.tests) + "</textarea>";
    h += '<label class="cs-lab">해설</label><textarea rows="2" data-qf="explanation">' + esc(q.explanation) + "</textarea>" +
      '<div class="cs-q-act"><button class="btn btn-primary" data-act="q-save">저장</button><button class="btn btn-ghost" data-act="q-cancel">취소</button></div></div>';
    return h;
  }

  function renderQbank(u) {
    var m = curModule(u);
    var nObj = Math.max(1, m.objectives.length);
    var dist = C.distribution(m.questions, nObj);
    var modSel = '<select data-act="q-module">' + u.modules.map(function (x, i) { return opt(i, "블록 " + (S.unit + 1) + "-" + (i + 1) + ". " + x.title + " (" + x.questions.length + "문항)", S.qModule); }).join("") + "</select>";
    var rows = dist.rows.map(function (r, i) {
      return "<tr><td><span class=\"cs-muted\">" + (i + 1) + "</span> " + esc((m.objectives[i] || "(학습목표 없음)")) + "</td>" +
        C.QUESTION_BANDS.map(function (b) { return '<td class="' + (r[b] ? "" : "zero") + '">' + r[b] + "</td>"; }).join("") + "</tr>";
    }).join("");
    var foot = "<tr><td>합계 / 권장</td>" + C.QUESTION_BANDS.map(function (b) {
      return '<td class="' + (dist.total[b] >= dist.recommend[b] ? "met" : "") + '">' + dist.total[b] + " / " + dist.recommend[b] + "</td>";
    }).join("") + "</tr>";
    var bandHead = C.QUESTION_BANDS.map(function (b) { return '<th><span class="cs-band b-' + b + '">' + b + "</span><small>" + esc(C.BANDS[b].name) + "</small></th>"; }).join("");
    var help = S.bandHelp ? '<div class="cs-bands">' + ["L1", "L2", "L3", "L4"].map(function (b) {
      var B = C.BANDS[b];
      return '<div class="cs-bandcard' + (b === "L4" ? " l4" : "") + '"><div><span class="cs-band b-' + b + '">' + b + "</span> <b>" + esc(B.name) + "</b></div><p>" + esc(B.desc) + "</p><small>" +
        esc(b === "L3" ? "파일제출 (루브릭 채점)" : b === "L4" ? "프로젝트" : B.types.join(" · ")) + "</small></div>";
    }).join("") + "</div>" : "";
    var g = S.gen;
    if (g.objective > nObj) g.objective = 1;
    if (C.BANDS[g.band].types.indexOf(g.type) === -1) g.type = C.BANDS[g.band].types[0];
    var form = '<div class="cs-card cs-qgen"><h3>문항 생성</h3><div class="cs-q-form">' +
      '<label>학습목표 <select data-g="objective">' + (m.objectives.length ? m.objectives : ["(학습목표를 먼저 작성하세요)"]).map(function (o, i) { return opt(i + 1, (i + 1) + ". " + o, g.objective); }).join("") + "</select></label>" +
      '<label>밴드 <select data-g="band">' + C.QUESTION_BANDS.map(function (b) { return opt(b, b, g.band); }).join("") + "</select></label>" +
      '<label>유형 <select data-g="type">' + C.BANDS[g.band].types.map(function (t) { return opt(t, t, g.type); }).join("") + "</select>" +
      (g.type === "객관식" ? '<span class="cs-check"><input type="checkbox" data-g="multi"' + (g.multi ? " checked" : "") + "> 복수 정답</span>" : "") + "</label></div>" +
      '<p class="cs-muted">코드가 들어가는 문항은 학습내용에 쓰인 언어 기준으로 만듭니다. ' + (m.content ? "교재 내용을 근거로 출제합니다." : "교재가 아직 없어 학습목표 기준으로 출제합니다.") + "</p>" +
      '<div class="cs-actions"><select data-g="count">' + [1, 3, 5, 10].map(function (n) { return opt(n, n + "문항", g.count); }).join("") + "</select>" +
      '<button class="btn btn-primary" data-act="q-gen"' + (aiReady("qgen") && m.objectives.length ? "" : " disabled") + ">AI로 생성</button><span class=\"cs-muted\">또는</span>" +
      '<button class="btn btn-ghost" data-act="q-add">빈 문항 추가</button>' +
      '<span class="cs-muted">' + (aiReady("qgen") ? (K.AI.isMixed() ? "Gemini 생성 → Claude 교차 검수" : esc(aiName("qgen")) + " 생성 · 규칙 검수") : "AI 키 없음 — 빈 문항으로 직접 작성") + "</span></div></div>";
    var list = m.questions.filter(function (q) {
      return (!S.qBand || q.band === S.qBand) && (!S.qObj || String(q.objective) === String(S.qObj));
    });
    var items = list.map(function (q) { return S.editing === q.id ? qEdit(m) : qView(q, m); }).join("") || '<p class="cs-muted">문항이 없습니다.</p>';
    if (S.editing && S.qDraft && S.qDraft._new) items = qEdit(m) + items;
    var chips = ["", "L1", "L2", "L3"].map(function (b) { return '<button class="cs-fchip' + (S.qBand === b ? " on" : "") + '" data-act="q-filter" data-b="' + b + '">' + (b || "전체 밴드") + "</button>"; }).join("");
    return '<div class="cs-card"><div class="cs-card-head"><h3>문항 분포</h3>' + modSel + '<div class="cs-spacer"></div><span class="cs-muted">권장 문항 수: L1 10문항 · L2 5문항 · L3 3문항 (재응시·회차 로테이션용)</span></div>' +
      '<table class="cs-dist"><thead><tr><th>학습목표</th>' + bandHead + "</tr></thead><tbody>" + rows + "</tbody><tfoot>" + foot + "</tfoot></table>" +
      '<button class="cs-link" data-act="band-help">밴드란? · ' + (S.bandHelp ? "접기" : "펼치기") + "</button>" +
      (S.bandHelp ? '<p class="cs-sub">밴드는 문항이 학습자에게 얼마나 많은 것을 스스로 하도록 요구하는지를 나타내는 단계입니다. 숫자가 클수록 주어지는 정보가 적습니다. 모든 문항에 학습목표와 밴드를 함께 붙여 두면, 오답률이 높을 때 어느 목표의 어느 수준이 무너졌는지 찾을 수 있습니다.</p>' : "") +
      help + "</div>" + form +
      '<div class="cs-card"><div class="cs-card-head"><h3>문항 ' + m.questions.length + "</h3>" + chips +
      '<select data-act="q-objfilter">' + opt("", "전체 목표", S.qObj) + m.objectives.map(function (o, i) { return opt(i + 1, "목표 " + (i + 1), S.qObj); }).join("") + "</select>" +
      '<div class="cs-spacer"></div><button class="btn btn-ghost" data-act="q-csv"' + (m.questions.length ? "" : " disabled") + ">CSV 저장</button></div>" + items + "</div>";
  }

  /* ---------- ④ 산출물 ---------- */
  function renderOutputs(u) {
    var o = u.outputs;
    var lintN = u.modules.reduce(function (a, m) { return a + ((m.content && m.content.lint) || []).length; }, 0);
    var written = u.modules.filter(function (m) { return m.content; }).length;
    var qn = u.modules.reduce(function (a, m) { return a + m.questions.length; }, 0);
    var card = function (icon, title, desc, key, file) {
      return '<div class="cs-out"><div class="cs-out-ic">' + icon + '</div><div class="cs-out-main"><b>' + title + "</b><p>" + desc + "</p></div>" +
        '<button class="btn btn-ghost" data-act="dl-out" data-k="' + key + '" data-file="' + esc(file) + '"' + (o ? "" : " disabled") + ">⤓ MD</button></div>";
    };
    return '<div class="cs-card"><div class="cs-card-head"><h3>산출물 — 단원 ' + (S.unit + 1) + ". " + esc(u.title) + " (" + u.hours + "시간)</h3></div>" +
      '<p class="cs-sub">' + (o ? "조립일 " + esc(o.generatedAt) + " · " : "아직 조립 전입니다. · ") + "교재 작성 블록 " + written + "/" + u.modules.length + " · NCS " + (u.ncs || []).length + "개 · 문항 " + qn + "개" +
      (lintN ? ' · <span class="cs-warn">교재 어투 점검 ' + lintN + "건</span>" : "") + "</p>" +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="gen-unit"' + (aiReady("write") ? "" : " disabled") + ">📝 " + (written ? "AI로 다시 작성" : "AI로 교안 작성") + "</button>" +
      '<button class="btn btn-ghost" data-act="assemble">↻ 현재 내용으로 조립' + (written ? "" : "(템플릿)") + "</button></div>" +
      card("📖", "교수안.md", "기존 교수안 형식 유지 — 도입 / 전개 N / 정리, 각 단계 제목에 소요 시간, 수업 흐름 표.", "docMd", "교수안 - " + u.title + ".md") +
      card("📘", "교재(교습안).md", "학습자용 — 블록마다 개요 → 학습목표 → 학습내용 → 학습 후 체크리스트, 경어체·메타데이터(소요 시간·툴·선행 블록·NCS).", "textMd", "교재 - " + u.title + ".md") +
      card("🎬", "슬라이드 편성안.md", "기존 편성안 형식 — 빌드하면 현재 슬라이드 템플릿으로 바로 만들어집니다.", "deckMd", "슬라이드 편성안 - " + u.title + ".md") +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="open-review"' + (o ? "" : " disabled") + ">🎬 검토 후 슬라이드·문서로 빌드 →</button>" +
      '<button class="btn btn-ghost" data-act="dl-qcsv"' + (qn ? "" : " disabled") + ">⤓ 이 단원 문제은행 CSV</button></div></div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>과정 전체</h3></div><div class="cs-actions">' +
      '<button class="btn btn-primary" data-act="open-review-all"' + (S.course.units.filter(function (x) { return x.outputs; }).length > 1 ? "" : " disabled") +
      '>🎬 조립된 단원 모두 빌드 (드롭다운으로 이동)</button>' +
      '<button class="btn btn-ghost" data-act="dl-course">⤓ 과정 설계서.md (단원·블록 시간표)</button>' +
      '<button class="btn btn-ghost" data-act="dl-all-text">⤓ 전체 교재.md</button>' +
      '<button class="btn btn-ghost" data-act="dl-all-qcsv">⤓ 전체 문제은행 CSV</button></div>' +
      '<p class="cs-foot">출제 이력·회차 결과·오답률 집계는 LMS에서 관리합니다(이 도구는 문항 자체만 만듭니다).</p></div>';
  }

  /* ================= 동작 ================= */
  function setPath(path, el) {
    var u = unit();
    var mi = Number(el.dataset.m), k = Number(el.dataset.k);
    var v = el.type === "number" ? Number(el.value) : el.value;
    switch (path) {
      case "course.title": S.course.title = v.trim() || S.course.title; break;
      case "course.goal": S.course.goal = v.trim(); break;
      case "unit.title": u.title = v.trim() || u.title; break;
      case "unit.hours": u.hours = Math.max(1, Math.round(v) || 1); C.normalizeUnit(u); break;
      case "module.title": u.modules[mi].title = v.trim() || u.modules[mi].title; break;
      case "module.minutes": u.modules[mi].minutes = Math.max(10, Math.round(v / 5) * 5 || 10); break;
      case "module.objectives": u.modules[mi].objectives = String(v).split("\n").map(function (s) { return s.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim(); }).filter(Boolean); break;
      case "flow.phase": u.modules[mi].flow[k].phase = v; break;
      case "flow.title": u.modules[mi].flow[k].title = v.trim(); break;
      case "flow.minutes": u.modules[mi].flow[k].minutes = Math.max(5, Math.round(v / 5) * 5 || 5); break;
    }
    save();
    render();
  }

  function startCourse(useAi) {
    var d = S.draft;
    d.topic = (document.getElementById("cs-topic") || {}).value || d.topic;
    d.total = Number((document.getElementById("cs-total") || {}).value) || 40;
    d.target = ((document.getElementById("cs-target") || {}).value || d.target).trim();
    d.tool = ((document.getElementById("cs-tool") || {}).value || "").trim();
    var parsed = C.parseTopicInput(d.topic.trim() ? d.topic : EXAMPLE);
    if (!parsed.title && !parsed.units.length) { alert("과정 주제와 단원을 입력해 주세요."); return; }
    var course = C.buildCourse(parsed, d.total, { target: d.target, tool: d.tool });
    S.course = course; S.unit = 0; S.tab = "blocks"; S.showSetup = false; S.ncsPending = null; S.editing = null;
    save();
    if (!useAi) { render(); return; }
    run("AI 블록 설계 준비 중…", function (prog) { return K.courseAI.planCourse(course, prog); });
  }

  function questionCtx(u, m) {
    return { unit: u.title, moduleTitle: m.title, module: m, objectives: m.objectives };
  }
  function moduleCsvRows(u, m) {
    return C.questionsToCsv(m.questions, questionCtx(u, m)).replace(/^﻿/, "").split("\r\n");
  }

  var actions = {
    "clear-error": function () { S.error = ""; render(); },
    "show-setup": function () { S.showSetup = true; render(); },
    "hide-setup": function () { S.showSetup = false; render(); },
    "fill-example": function () { S.draft.topic = EXAMPLE; render(); },
    "new-course": function () {
      if (!confirm("현재 과정 설계를 지우고 새로 시작할까요? (내려받지 않은 내용은 사라집니다)")) return;
      S.course = null; S.showSetup = false; S.unit = 0; save(); render();
    },
    "plan-ai": function () { startCourse(true); },
    "plan-basic": function () { startCourse(false); },
    "pick-unit": function (el) { S.unit = Number(el.dataset.u); S.ncsPending = null; S.editing = null; S.qModule = 0; save(); render(); },
    "tab": function (el) { S.tab = el.dataset.tab; S.editing = null; render(); },
    "fit-hours": function () {
      var c = S.course;
      var hrs = C.allocateHours(c.units.length, c.totalHours, c.units.map(function (u) { return u.hours; }));
      c.units.forEach(function (u, i) { u.hours = hrs[i]; C.normalizeUnit(u); });
      save(); render();
    },
    "fit-unit": function () { C.normalizeUnit(unit()); save(); render(); },
    "add-module": function () {
      var u = unit();
      u.modules.push({ id: C.uid("m"), title: u.title + " — 새 블록", minutes: 60, objectives: [], flow: C.defaultFlow(60, "새 블록"), content: null, questions: [] });
      save(); render();
    },
    "del-module": function (el) {
      var u = unit();
      if (u.modules.length <= 1) { alert("단원에는 블록이 하나 이상 있어야 합니다."); return; }
      if (!confirm("이 블록을 삭제할까요? (교재·문항도 함께 삭제됩니다)")) return;
      u.modules.splice(Number(el.dataset.m), 1); save(); render();
    },
    "add-flow": function (el) {
      var m = unit().modules[Number(el.dataset.m)];
      var at = Math.max(0, m.flow.length - 1);
      m.flow.splice(at, 0, { phase: "전개", title: "새 활동", minutes: 10 });
      save(); render();
    },
    "del-flow": function (el) {
      var m = unit().modules[Number(el.dataset.m)];
      if (m.flow.length <= 1) return;
      m.flow.splice(Number(el.dataset.k), 1); save(); render();
    },
    "replan-unit": function () {
      var u = unit();
      if (u.modules.some(function (m) { return m.content || m.questions.length; }) && !confirm("블록을 다시 설계하면 이 단원의 교재·문항이 지워집니다. 계속할까요?")) return;
      run("단원 블록 다시 설계 중… (" + aiName("plan") + ")", function () { return K.courseAI.planUnit(S.course, u); });
    },
    "gen-unit": function () {
      var u = unit();
      if (u.modules.some(function (m) { return !m.objectives.length; }) && !confirm("학습목표가 없는 블록이 있습니다. 블록 제목 기준으로 작성할까요?")) return;
      run("교안 작성 준비 중…", function (prog) {
        return K.courseAI.generateUnit(S.course, u, prog).then(function () { S.tab = "outputs"; });
      });
    },
    "assemble": function () { K.courseAI.buildOutputs(S.course, unit()); save(); render(); },
    "open-review": function () {
      var o = unit().outputs;
      if (o && K.app) K.app.openReview({ docMd: o.docMd, deckMd: o.deckMd, textMd: o.textMd });
    },
    "open-review-all": function () {
      var list = [], start = 0;
      S.course.units.forEach(function (u, i) {
        if (!u.outputs) return;
        if (i === S.unit) start = list.length;
        list.push({ label: (i + 1) + "단원. " + u.title + " (" + u.hours + "시간)", title: u.title, docMd: u.outputs.docMd, deckMd: u.outputs.deckMd, textMd: u.outputs.textMd });
      });
      if (list.length && K.app) K.app.openReview({ parts: list, index: start });
    },
    "dl-out": function (el) { var o = unit().outputs; if (o) download(safeName(el.dataset.file.replace(/\.md$/, "")) + ".md", o[el.dataset.k]); },
    "dl-course": function () { download(safeName("과정 설계서 - " + S.course.title) + ".md", C.courseMd(S.course)); },
    "dl-all-text": function () {
      var c = S.course;
      download(safeName("교재 - " + c.title) + ".md", c.units.map(function (u) { return C.textbookMd(c, u); }).join("\n\n---\n\n"));
    },
    "dl-qcsv": function () {
      var u = unit(), rows = [];
      u.modules.forEach(function (m, i) { if (m.questions.length) { var r = moduleCsvRows(u, m); rows = rows.concat(rows.length ? r.slice(1) : r); } });
      download(safeName("문제은행 - " + u.title) + ".csv", "﻿" + rows.join("\r\n"), "text/csv");
    },
    "dl-all-qcsv": function () {
      var rows = [];
      S.course.units.forEach(function (u) { u.modules.forEach(function (m) { if (m.questions.length) { var r = moduleCsvRows(u, m); rows = rows.concat(rows.length ? r.slice(1) : r); } }); });
      if (!rows.length) { alert("아직 문항이 없습니다."); return; }
      download(safeName("문제은행 - " + S.course.title) + ".csv", "﻿" + rows.join("\r\n"), "text/csv");
    },
    /* NCS */
    "ncs-toggle": function (el) {
      var u = unit(), sel = pending(u), code = el.dataset.code;
      var i = sel.indexOf(code);
      if (i === -1) sel.push(code); else sel.splice(i, 1);
      render();
    },
    "ncs-cancel": function () { S.ncsPending = null; render(); },
    "ncs-save": function () {
      var u = unit();
      var keep = {};
      (u.ncs || []).forEach(function (n) { keep[n.code] = n; });
      (u.ncsDraft || []).forEach(function (n) { keep[n.code] = n; });
      u.ncs = pending(u).map(function (code) {
        var n = keep[code] || C.ncsUnit(code);
        return { code: n.code, name: n.name, level: n.level, subd: n.subd, path: n.path, objectives: n.objectives || [], reason: n.reason || "", score: n.score != null ? n.score : n.match, cross: !!n.cross };
      }).filter(function (n) { return n.code; });
      S.ncsPending = null;
      if (u.outputs) K.courseAI.buildOutputs(S.course, u);
      save(); render();
    },
    "ncs-recommend": function () {
      var u = unit();
      run("NCS 능력단위 추천 중…", function (prog) {
        return K.courseAI.recommendNcs(S.course, u, function (l) { prog(l); }).then(function (list) { u.ncsDraft = list; });
      });
    },
    /* 문제은행 */
    "band-help": function () { S.bandHelp = !S.bandHelp; render(); },
    "q-filter": function (el) { S.qBand = el.dataset.b; render(); },
    "q-gen": function () {
      var u = unit(), m = curModule(u), mi = u.modules.indexOf(m);
      var spec = { objective: S.gen.objective, band: S.gen.band, type: S.gen.type, multi: S.gen.type === "객관식" && S.gen.multi, count: S.gen.count };
      run("문항 생성 중… (" + (K.AI.isMixed() ? "Gemini 생성 → Claude 교차 검수" : aiName("qgen")) + ")", function () {
        return K.courseAI.generateQuestions(S.course, u, mi, spec).then(function (qs) { m.questions = m.questions.concat(qs); });
      });
    },
    "q-add": function () {
      var g = S.gen;
      var q = C.newQuestion({ objective: g.objective, band: g.band, type: g.type, multi: g.type === "객관식" && g.multi });
      if (q.type === "객관식") q.choices = [0, 1, 2, 3].map(function (i) { return { text: "", correct: i === 0 }; });
      if (q.type === "서술형" || q.type === "파일제출") q.rubric = [{ criterion: "", points: 5 }];
      q._new = true;
      S.editing = q.id; S.qDraft = q; render();
    },
    "q-edit": function (el) {
      var m = curModule(unit());
      var q = m.questions.filter(function (x) { return x.id === el.dataset.q; })[0];
      if (!q) return;
      S.editing = q.id; S.qDraft = JSON.parse(JSON.stringify(q)); render();
    },
    "q-del": function (el) {
      var m = curModule(unit());
      if (!confirm("이 문항을 삭제할까요?")) return;
      m.questions = m.questions.filter(function (x) { return x.id !== el.dataset.q; });
      save(); render();
    },
    "q-cancel": function () { S.editing = null; S.qDraft = null; render(); },
    "q-save": function () {
      var m = curModule(unit()), q = S.qDraft;
      var isNew = q._new;
      delete q._new;
      q.review = null; // 사람이 고친 문항은 AI 검수 결과를 무효화한다
      if (isNew) m.questions.push(q);
      else m.questions = m.questions.map(function (x) { return x.id === q.id ? q : x; });
      S.editing = null; S.qDraft = null; save(); render();
    },
    "q-choice-add": function () { S.qDraft.choices.push({ text: "", correct: false }); render(); },
    "q-choice-del": function (el) { S.qDraft.choices.splice(Number(el.dataset.i), 1); render(); },
    "q-rub-add": function () { S.qDraft.rubric.push({ criterion: "", points: 1 }); render(); },
    "q-rub-del": function (el) { S.qDraft.rubric.splice(Number(el.dataset.i), 1); render(); },
    "q-csv": function () {
      var u = unit(), m = curModule(u);
      download(safeName("문제은행 - " + m.title) + ".csv", C.questionsToCsv(m.questions, questionCtx(u, m)), "text/csv");
    }
  };

  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
    var fn = actions[el.dataset.act];
    if (!fn || el.disabled) return;
    if (S.busy && !/^(clear-error|tab|pick-unit)$/.test(el.dataset.act)) return;
    if (el.tagName === "INPUT" && el.type === "checkbox") { e.preventDefault(); }
    fn(el, e);
  });

  root.addEventListener("change", function (e) {
    var el = e.target;
    if (el.dataset.f) { setPath(el.dataset.f, el); return; }
    if (el.dataset.g) {
      var g = S.gen, k = el.dataset.g;
      if (k === "multi") g.multi = el.checked;
      else if (k === "objective" || k === "count") g[k] = Number(el.value);
      else g[k] = el.value;
      if (k === "band") g.type = C.BANDS[g.band].types[0];
      render(); return;
    }
    if (el.dataset.act === "q-module") { S.qModule = Number(el.value); S.editing = null; S.qObj = ""; render(); return; }
    if (el.dataset.act === "q-objfilter") { S.qObj = el.value; render(); return; }
    if (el.dataset.qf && S.qDraft) {
      var q = S.qDraft, f = el.dataset.qf;
      if (f === "objective") q.objective = Number(el.value);
      else if (f === "band") { q.band = el.value; if (C.BANDS[q.band].types.indexOf(q.type) === -1) setType(q, C.BANDS[q.band].types[0]); }
      else if (f === "type") setType(q, el.value);
      else if (f === "multi") q.multi = el.checked;
      else if (f === "correct") {
        var i = Number(el.dataset.i);
        if (!q.multi) q.choices.forEach(function (c, j) { c.correct = j === i ? el.checked : false; });
        else q.choices[i].correct = el.checked;
      } else return;
      render();
    }
  });

  function setType(q, t) {
    q.type = t;
    if (t === "객관식" && !(q.choices || []).length) q.choices = [0, 1, 2, 3].map(function (i) { return { text: "", correct: i === 0 }; });
    if ((t === "서술형" || t === "파일제출") && !(q.rubric || []).length) q.rubric = [{ criterion: "", points: 5 }];
    if (t !== "객관식") q.multi = false;
  }

  root.addEventListener("input", function (e) {
    var el = e.target;
    if (el.id === "cs-topic") { S.draft.topic = el.value; save(); return; }
    if (el.id === "cs-ncs-q") {
      S.ncsQuery = el.value;
      clearTimeout(el._t);
      el._t = setTimeout(function () {
        var pos = el.selectionStart;
        render();
        var n = document.getElementById("cs-ncs-q");
        if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e2) {} }
      }, 350);
      return;
    }
    if (!el.dataset.qf || !S.qDraft) return;
    var q = S.qDraft, f = el.dataset.qf, i = Number(el.dataset.i);
    if (f === "stem" || f === "code" || f === "answer" || f === "accepted" || f === "tests" || f === "explanation") q[f] = el.value;
    else if (f === "choice") q.choices[i].text = el.value;
    else if (f === "rub-c") q.rubric[i].criterion = el.value;
    else if (f === "rub-p") q.rubric[i].points = Number(el.value) || 0;
  });

  document.addEventListener("kb-ai-change", function () { if (document.getElementById("app").dataset.screen === "course") render(); });

  load();
  K.courseUI = {
    open: function () { render(); },
    state: function () { return S; }
  };
})();
