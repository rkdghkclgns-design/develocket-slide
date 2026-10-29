/* course-ui.js — 과정 설계 화면 (뼈대 + 단원 단위 탭)
 *   ① 블록 설계   : 단원(교과목)·학습모듈 블록·흐름별 소요 시간 편집 (합계 시간 검증)
 *   ② 학습모듈    : 모듈 목록·상태·메타데이터·휴지통 + 교재/NCS/삽화/문제은행 (course-workspace.js · K.courseTabs)
 *   ③ 교과목 NCS  : 단원(교과목) ↔ 능력단위 — AI 추천 + 직접 선택 → 저장
 *   ④ 산출물      : 차시(1시간)별 교수안.md(기존 형식) · 슬라이드 편성안 + 교재(교습안).md → 차시 드롭다운으로 검토·빌드
 * K.cui 로 상태·렌더·저장·작업 실행(진행/중지)·대화상자·알림을 다른 화면 모듈에 제공한다.
 * 상태는 이 브라우저의 localStorage 에 자동 저장한다. */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var root = document.getElementById("course-root");
  if (!root || !K.course) return;
  var C = K.course;
  var STORE = "kb-course-v1";
  var TRASH_DAYS = 30;
  var EXAMPLE = "주제 입력: 생성형 AI와 UGC 산업의 이해\n - 생성형 AI의 종류\n - LLM의 동작 원리\n - UGC 플랫폼 산업의 구조와 크리에이터 이코노미\n - AI 에이전트\n - 이미지, 사운드 생성 등의 AI 도구 생태계\n - AI 생성물의 저작권 및 라이선스";

  var S = {
    course: null, draft: { topic: "", total: 40, target: "직업훈련 수강생(완전 초보)", tool: "" },
    showSetup: false, unit: 0, tab: "blocks", mod: null, sub: "textbook",
    ncsPending: null, ncsQuery: "",
    busy: false, progress: null, error: "", abort: null
  };

  /* ---------- 저장 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var j = JSON.parse(raw);
      if (j && j.course && j.course.v === 1) S.course = C.ensureCourse(j.course);
      if (j && j.draft) S.draft = j.draft;
      if (j && typeof j.unit === "number") S.unit = j.unit;
      if (j && j.mod) S.mod = j.mod;
      if (j && j.tab) S.tab = j.tab === "qbank" ? "modules" : j.tab;
      purgeTrash();
    } catch (e) {}
  }
  var saveTimer = null, saveFailing = false, lastSaved = null;
  function writeNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      lastSaved = JSON.stringify({ course: S.course, draft: S.draft, unit: S.unit, mod: S.mod, tab: S.tab });
      localStorage.setItem(STORE, lastSaved);
      saveFailing = false;
    } catch (e) {
      // 실패가 새로 시작될 때마다 알린다 (같은 실패가 이어지는 동안은 한 번만)
      if (!saveFailing) toast("브라우저 저장 공간이 부족해 저장하지 못했습니다. 휴지통을 비우거나 삽화를 줄인 뒤 과정 설계서를 내려받아 두세요.");
      saveFailing = true;
    }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 250);
  }
  /* 창을 닫거나 숨기기 직전에는 기다리지 않고 저장 */
  window.addEventListener("pagehide", function () { if (saveTimer) writeNow(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && saveTimer) writeNow(); });
  /* 다른 탭에서 같은 과정을 고치면 덮어쓰지 않도록 알린다 */
  window.addEventListener("storage", function (e) {
    if (e.key === STORE && e.newValue && e.newValue !== lastSaved) toast("다른 탭에서 과정 설계가 바뀌었습니다. 한 탭에서만 작업하세요. 이 탭을 새로고침하면 최신 내용을 불러옵니다.");
  });
  /* 휴지통: 30일이 지난 학습모듈은 영구 삭제 */
  function purgeTrash() {
    if (!S.course) return;
    var cut = Date.now() - TRASH_DAYS * 864e5;
    S.course.trash = (S.course.trash || []).filter(function (t) { return t.at > cut; });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function unit() { return S.course && S.course.units[Math.min(S.unit, S.course.units.length - 1)]; }
  function aiReady(role) { return !!(K.ai && K.ai.available(role || "write")); }
  function aiName(role) { return K.ai ? K.ai.providerLabel(K.ai.providerFor(role)) : "없음"; }
  /* 학습모듈 찾기 (모든 단원) */
  function locate(id) {
    var hit = null;
    C.allModules(S.course).forEach(function (x) { if (x.module.id === id) hit = x; });
    return hit;
  }
  function ctx() {
    var hit = S.course && S.mod ? locate(S.mod) : null;
    return { S: S, course: S.course, unit: hit ? hit.unit : unit(), ui: hit ? hit.ui : S.unit, module: hit ? hit.module : null, mi: hit ? hit.mi : -1 };
  }

  function download(name, text, type) {
    var blob = text instanceof Blob ? text : new Blob([text], { type: (type || "text/markdown") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function safeName(s) { return String(s || "문서").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60); }

  /* ---------- 알림 · 대화상자 ---------- */
  var toastEl = document.createElement("div");
  toastEl.className = "cs-toast"; toastEl.hidden = true; toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }
  var modal = document.createElement("div");
  modal.className = "cs-modal"; modal.hidden = true;
  modal.innerHTML = '<div class="cs-dlg" role="dialog" aria-modal="true"></div>';
  document.body.appendChild(modal);
  var dlgBox = modal.firstChild;
  function openDialog(html, wide) {
    dlgBox.className = "cs-dlg" + (wide ? " wide" : "");
    var keep = !modal.hidden ? dlgBox.querySelector(".cs-dlg-b") : null;
    var top = keep ? keep.scrollTop : 0;
    dlgBox.innerHTML = html;
    modal.hidden = false;
    var b = dlgBox.querySelector(".cs-dlg-b");
    if (b && keep) b.scrollTop = top;
  }
  function closeDialog() { modal.hidden = true; dlgBox.innerHTML = ""; }
  function dialogOpen() { return !modal.hidden; }
  modal.addEventListener("mousedown", function (e) { if (e.target === modal && !S.busy) closeDialog(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden && !S.busy) closeDialog(); });

  /* ---------- 작업 실행(진행 표시 · 받은 글자 수 · 중지 · 오류 처리) ---------- */
  function run(label, fn, opts) {
    if (S.busy) return Promise.resolve();
    opts = opts || {};
    var ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    S.busy = true; S.error = ""; S.abort = ac; S.progress = { label: label, done: 0, total: 0, chars: 0 };
    if (K.courseAI) K.courseAI.setCallContext({ signal: ac && ac.signal, onChars: function (n) { if (S.progress) { S.progress.chars = n; renderProgress(); } } });
    if (!opts.quiet) render(); else renderProgress();
    var prog = function (done, total, l) {
      if (!S.progress) return;
      if (typeof done === "string") S.progress.label = done;
      else { S.progress.done = done; S.progress.total = total; if (l) S.progress.label = l; }
      S.progress.chars = 0;
      renderProgress();
    };
    function end() {
      S.busy = false; S.progress = null; S.abort = null;
      if (K.courseAI) K.courseAI.setCallContext(null);
      if (S.course) C.ensureCourse(S.course);
    }
    return Promise.resolve().then(function () { return fn(prog, ac && ac.signal); }).then(function () {
      end(); save(); render();
    }, function (err) {
      end();
      if (err && (err.code === "cancelled" || err.name === "AbortError")) { toast("중지했습니다."); save(); render(); return; }
      if (window.console) console.error(err);
      S.error = (err && err.message) || String(err);
      save(); render();
    });
  }

  /* ================= 렌더 ================= */
  function render() {
    var html = renderHead();
    html += '<div id="cs-progress">' + progressHtml() + "</div>";
    if (!S.course || S.showSetup) html += renderSetup();
    if (S.course && !S.showSetup) {
      html += renderSummary();
      html += renderTabs();
      var u = unit();
      if (S.tab === "blocks") html += renderBlocks(u);
      else if (S.tab === "modules") html += K.courseWS ? K.courseWS.render(ctx()) : "";
      else if (S.tab === "ncs") html += renderNcs(u);
      else html += renderOutputs(u);
    }
    root.innerHTML = html;
    root.classList.toggle("is-busy", S.busy);
    if (K.courseWS && S.tab === "modules" && K.courseWS.after) K.courseWS.after(ctx());
  }

  function progressHtml() {
    if (S.error) return '<div class="cs-error">⚠ ' + esc(S.error) + ' <button class="cs-link" data-act="clear-error">닫기</button></div>';
    var p = S.progress;
    if (!p) return "";
    var pct = p.total ? Math.round((p.done / p.total) * 100) : 8;
    return '<div class="cs-progress"><span class="cs-spin">🍁</span><span class="cs-plabel">' + esc(p.label) + "</span>" +
      '<span class="cs-chars mono">' + (p.chars ? p.chars.toLocaleString() + "자 받는 중" : "") + "</span>" +
      '<div class="cs-pbar"><i style="width:' + pct + '%"></i></div>' +
      (S.abort ? '<button class="btn btn-ghost cs-stop" data-act="busy-stop">중지</button>' : "") + "</div>";
  }
  function renderProgress() {
    var el = document.getElementById("cs-progress");
    if (!el) return;
    var p = S.progress, box = el.querySelector(".cs-progress");
    if (p && !S.error && box) { // 스트리밍 중 '중지' 버튼이 매번 새로 만들어져 클릭을 놓치지 않게 제자리에서 갱신
      box.querySelector(".cs-plabel").textContent = p.label;
      var ch = box.querySelector(".cs-chars");
      ch.textContent = p.chars ? p.chars.toLocaleString() + "자 받는 중" : "";
      box.querySelector(".cs-pbar i").style.width = (p.total ? Math.round((p.done / p.total) * 100) : 8) + "%";
      return;
    }
    el.innerHTML = progressHtml();
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
    var done = u.modules.filter(function (m) { return m.status === "완료"; }).length;
    var b = "";
    if (u.outputs) b += '<i title="교안 생성됨">📝</i>';
    if (u.ncs && u.ncs.length) b += '<i title="NCS ' + u.ncs.length + '개 선정">🏷</i>';
    if (q) b += '<i title="문항 ' + q + '개">❓' + q + "</i>";
    if (done) b += '<i title="완료한 학습모듈">✓' + done + "/" + u.modules.length + "</i>";
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
    var n = C.allModules(S.course).length;
    var tabs = [["blocks", "① 블록 설계"], ["modules", "② 학습모듈 <span class=\"cs-cnt\">" + n + "</span>"], ["ncs", "③ 교과목 NCS"], ["outputs", "④ 산출물"]];
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

  function statusChip(m) { return '<span class="cs-st st-' + C.STATUSES.indexOf(m.status) + '">' + esc(m.status) + "</span>"; }

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
        ? '<div class="cs-done">✓ 교재·교수안 작성됨 <span class="cs-muted">(' + esc(m.content.by || "직접 작성") + ")</span>" +
          (m.content.lint && m.content.lint.length ? ' · <span class="cs-warn">교재 검수 ' + m.content.lint.length + "건</span>" : " · 교재 검수 통과") + "</div>"
        : "";
      return '<div class="cs-block">' +
        '<div class="cs-block-head"><span class="cs-block-no">블록 ' + (S.unit + 1) + "-" + (mi + 1) + "</span>" + statusChip(m) +
        '<input class="cs-block-title" data-f="module.title" data-m="' + mi + '" value="' + esc(m.title) + '">' +
        '<label class="cs-num"><input type="number" min="10" step="5" data-f="module.minutes" data-m="' + mi + '" value="' + m.minutes + '">분</label>' +
        '<span class="cs-time">' + C.fmtMin(m.minutes) + "</span>" +
        '<button class="btn btn-ghost" data-act="ws-open" data-id="' + m.id + '">학습모듈 열기 →</button>' +
        '<button class="cs-x" data-act="del-module" data-m="' + mi + '" title="휴지통으로">✕</button></div>' +
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
      '<button class="btn btn-ghost" data-act="ws-new" data-u="' + S.unit + '">＋ 블록(학습모듈) 추가</button>' +
      '<button class="btn btn-ghost" data-act="replan-unit"' + (aiReady("plan") ? "" : " disabled") + ">✨ 이 단원 블록 다시 설계</button>" +
      '<div class="cs-spacer"></div>' +
      '<button class="btn btn-primary" data-act="gen-unit"' + (aiReady("write") ? "" : " disabled") + ">📝 이 단원 교안 생성 (교수안·교재·슬라이드)</button>" +
      "</div>" +
      '<p class="cs-hint">교안 생성: 블록마다 학습자용 교재(개요→학습목표→학습내용→체크리스트)와 강사용 교수안 단계, 슬라이드를 만듭니다. 이미 교재를 쓴 블록은 교재를 그대로 두고 교수안·슬라이드만 만듭니다. ' +
      (K.AI && K.AI.isMixed && K.AI.isMixed() ? "혼합 모드: Claude가 교재·교수안을 쓰고 Gemini가 슬라이드로 요약합니다." : "사용 AI: " + esc(aiName("write"))) + "</p></div>";
  }

  /* ---------- ③ 교과목 NCS (능력단위 ↔ 단원) ---------- */
  function ncsItem(n, checked) {
    var path = (n.path || []).join(" › ");
    var score = n.score != null ? n.score : n.match;
    return '<label class="cs-ncs' + (checked ? " on" : "") + '"><input type="checkbox" data-act="ncs-toggle" data-code="' + esc(n.code) + '"' + (checked ? " checked" : "") + ">" +
      '<div class="cs-ncs-main"><div class="cs-ncs-name">' + esc(n.name) + "</div>" +
      '<dl class="cs-ncs-dl"><dt>단위 코드</dt><dd class="mono">' + esc(n.code) + "</dd><dt>분류</dt><dd>" + esc(path) + "</dd><dt>수준</dt><dd>" + esc(n.level) + "수준</dd></dl>" +
      (n.objectives && n.objectives.length ? '<div class="cs-ncs-obj">학습목표 ' + n.objectives.map(esc).join(" · ") + "</div>" : "") +
      (n.reason ? '<p class="cs-ncs-why">' + esc(n.reason) + "</p>" : "") + "</div>" +
      '<div class="cs-ncs-side"><span class="cs-badge ref">참조 목록</span>' + (n.cross ? '<span class="cs-badge cross">교차 검증</span>' : "") +
      (score != null ? '<div class="cs-meter"><i style="width:' + Math.max(0, Math.min(100, score)) + '%"></i></div><span class="cs-score">적합도 <b>' + score + "</b></span>" : "") +
      (n.by ? '<span class="cs-muted">' + esc(n.by) + "</span>" : "") + "</div></label>";
  }
  function pending(u) {
    if (!S.ncsPending) S.ncsPending = (u.ncs || []).map(function (n) { return n.code; });
    return S.ncsPending;
  }
  /* 학습모듈에서 선정한 능력단위요소가 속한 능력단위 = 교과목 대응 후보 */
  function moduleUnitCands(u) {
    var map = {};
    u.modules.forEach(function (m) {
      ((m.ncs && m.ncs.chosen) || []).forEach(function (code) {
        var f = K.ncsRef ? K.ncsRef.find(code) : null;
        var uc = f ? f.unit.code : String(code).split(".")[0];
        if (!uc) return;
        (map[uc] = map[uc] || { code: uc, name: f ? f.unit.name : "", mods: [] }).mods.push(m.title);
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
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
    var cands = moduleUnitCands(u);
    var candHtml = cands.length ? '<div class="cs-uc"><div class="cs-uc-h">학습모듈의 능력단위요소에서 올라온 후보</div>' + cands.map(function (x) {
      var on = sel.indexOf(x.code) !== -1, known = !!C.ncsUnit(x.code);
      return '<div class="cs-uc-row"><span>' + esc(x.name || x.code) + ' <span class="cs-muted">← ' + esc(x.mods.join(", ")) + '</span></span><span class="mono cs-muted">' + esc(x.code) + "</span>" +
        (known ? '<button class="cs-link" data-act="ncs-toggle" data-code="' + esc(x.code) + '">' + (on ? "선정 해제" : "선정") + "</button>" : '<span class="cs-badge warn">목록 밖</span>') + "</div>";
    }).join("") + "</div>" : "";
    var draft = (u.ncsDraft || []).map(function (n) { return ncsItem(n, sel.indexOf(n.code) !== -1); }).join("") ||
      '<p class="cs-muted">' + (aiReady("plan") ? "'추천 받기'를 누르면 단원 학습목표에 맞는 능력단위를 현행 분류 목록에서 추천합니다." : "AI 키가 없어 키워드 검색으로 추천합니다. '추천 받기'를 누르세요.") + "</p>";
    var q = S.ncsQuery.trim();
    var found = q ? C.ncsSearch(q, 12, { perSubd: 6 }) : [];
    var direct = q ? (found.map(function (n) { return ncsItem(n, sel.indexOf(n.code) !== -1); }).join("") || '<p class="cs-muted">검색 결과가 없습니다.</p>') : "";
    return '<div class="cs-card"><div class="cs-card-head"><h3>교과목 NCS — 단원 ' + (S.unit + 1) + ". " + esc(u.title) + '</h3><div class="cs-spacer"></div>' +
      '<button class="btn btn-ghost" data-act="ncs-cancel"' + (dirty ? "" : " disabled") + ">변경 취소</button>" +
      '<button class="btn btn-primary" data-act="ncs-save"' + (dirty ? "" : " disabled") + ">저장</button></div>" +
      '<p class="cs-sub">교과목(단원)에는 <b>능력단위</b>를, 학습모듈에는 <b>능력단위요소</b>를 대응시킵니다(요소는 ② 학습모듈 → NCS 탭). 하나의 교과목이 여러 능력단위를 묶을 수 있습니다.' + (dirty ? ' <b class="cs-warn">저장하지 않은 변경이 있습니다.</b>' : "") + "</p>" +
      '<div class="cs-sels">' + selected + "</div>" + candHtml + "</div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>AI 추천</h3><span class="cs-muted">' + (aiReady("plan") ? (K.AI.isMixed() ? "Claude·Gemini 교차 판단" : esc(aiName("plan"))) : "키워드 검색") + '</span><div class="cs-spacer"></div>' +
      '<button class="btn btn-ghost" data-act="ncs-recommend">' + ((u.ncsDraft || []).length ? "다시 추천" : "추천 받기") + "</button></div>" + draft + "</div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>직접 선택</h3><input class="cs-search" id="cs-ncs-q" placeholder="능력단위·세분류 키워드 (예: 프롬프트, 저작권, 소셜미디어)" value="' + esc(S.ncsQuery) + '"></div>' +
      direct + '<p class="cs-foot">기준: NCS ' + esc((K.NCS && K.NCS.degree) || "") + "차 분류체계 참조 목록(" + esc((K.NCS && K.NCS.collectedAt) || "") + " ncs.go.kr 수집, " + ((K.NCS && K.NCS.units.length) || 0) +
      '개 능력단위). 분류번호는 현행 체계를 그대로 쓰며 개정 시 코드가 바뀔 수 있으니 사용 전 <a href="https://www.ncs.go.kr/unity/th03/ncsSearchMain.do" target="_blank" rel="noopener noreferrer">ncs.go.kr</a>에서 확인하세요.</p></div>';
  }

  /* ---------- ④ 산출물 — 차시(1차시 = 1시간)별 교수안·슬라이드 편성안 + 단원 교재 ---------- */
  function sessionRows(u, o) {
    // 조립한 뒤에는 조립 시점의 차시를, 조립 전에는 지금 블록 설계로 나눈 차시를 보여 준다
    var list = o ? o.sessions : C.unitSessions(u).map(function (s, si, all) {
      return { no: si + 1, title: C.sessionTitle(u, s), minutes: s.minutes, steps: C.sessionSteps(u, s, si, all.length) };
    });
    var rows = list.map(function (s, i) {
      var act = o ? '<button class="cs-link" data-act="dl-sess" data-s="' + i + '" data-k="docMd">⤓ 교수안</button>' +
        '<button class="cs-link" data-act="dl-sess" data-s="' + i + '" data-k="deckMd">⤓ 편성안</button>' +
        '<button class="cs-link" data-act="open-review" data-s="' + i + '">빌드 →</button>' : "";
      return "<tr><td class=\"cs-sess-no\"><b>" + s.no + "차시</b><span>" + esc(s.title) + "</span></td><td>" + C.fmtMin(s.minutes) + '</td><td class="cs-sess-steps">' +
        s.steps.map(function (st) { return "<span><b>" + esc(st.label) + "</b> " + esc(st.text) + " <i>" + C.fmtMin(st.minutes) + "</i></span>"; }).join("") +
        '</td><td class="cs-sess-act">' + act + "</td></tr>";
    }).join("");
    return { n: list.length, html: '<div class="cs-sess"><div class="cs-sess-head"><b>차시 구성</b><span class="cs-muted">1차시 = 1시간 · ' + list.length + "차시" +
      (o ? "" : " · 조립 전 미리 보기") + '</span></div><div class="cs-tbl"><table class="cs-table"><thead><tr><th>차시</th><th>시간</th><th>진행 단계</th><th></th></tr></thead><tbody>' +
      rows + "</tbody></table></div></div>" };
  }
  function renderOutputs(u) {
    var o = u.outputs;
    var lintN = u.modules.reduce(function (a, m) { return a + ((m.content && m.content.lint) || []).length; }, 0);
    var written = u.modules.filter(function (m) { return m.content; }).length;
    var qn = u.modules.reduce(function (a, m) { return a + m.questions.length; }, 0);
    var ills = u.modules.reduce(function (a, m) { return a + (m.ills || []).filter(function (x) { return x.placement != null; }).length; }, 0);
    var sess = sessionRows(u, o);
    var card = function (icon, title, desc, key, file, btn) {
      return '<div class="cs-out"><div class="cs-out-ic">' + icon + '</div><div class="cs-out-main"><b>' + title + "</b><p>" + desc + "</p></div>" +
        '<button class="btn btn-ghost" data-act="dl-out" data-k="' + key + '" data-file="' + esc(file) + '"' + (o ? "" : " disabled") + ">⤓ " + (btn || "MD") + "</button></div>";
    };
    return '<div class="cs-card"><div class="cs-card-head"><h3>산출물 — 단원 ' + (S.unit + 1) + ". " + esc(u.title) + " (" + u.hours + "시간 · " + sess.n + "차시)</h3></div>" +
      '<p class="cs-sub">' + (o ? "조립일 " + esc(o.generatedAt) + " · " : "아직 조립 전입니다. · ") + "교재 작성 블록 " + written + "/" + u.modules.length + " · NCS " + (u.ncs || []).length + "개 · 문항 " + qn + "개 · 배치한 삽화 " + ills + "개" +
      (lintN ? ' · <span class="cs-warn">교재 검수 ' + lintN + "건</span>" : "") + "</p>" +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="gen-unit"' + (aiReady("write") ? "" : " disabled") + ">📝 " + (written ? "AI로 교수안·슬라이드 다시 작성" : "AI로 교안 작성") + "</button>" +
      '<button class="btn btn-ghost" data-act="assemble">↻ 현재 내용으로 조립' + (written ? "" : "(템플릿)") + "</button></div>" +
      sess.html +
      card("📖", "교수안 — 차시별 " + sess.n + "개", "차시마다 기존 교수안 형식 — 도입 / 전개 N / 정리, 단계 제목에 소요 시간, 수업 흐름 표. 블록 도입·정리로 시작하거나 끝나지 않는 차시에는 5분 연결 단계를 넣습니다.", "doc", "교수안 - " + u.title + " (차시별).md", "전체 차시 MD") +
      card("📘", "교재(교습안).md", "학습자용 — 블록마다 개요 → 학습목표 → 학습내용(삽화 포함) → 학습 후 체크리스트, 메타데이터(상태·소요 시간·툴·선행 모듈·NCS·변경 이력). 차시별 빌드에는 그 차시에 걸친 블록만 붙습니다.", "text", "교재 - " + u.title + ".md") +
      card("🎬", "슬라이드 편성안 — 차시별 " + sess.n + "개", "기존 편성안 형식 — 차시마다 표지·목차·마무리, 블록 슬라이드는 블록이 걸친 차시에 시간 비율대로 나눕니다.", "deck", "슬라이드 편성안 - " + u.title + " (차시별).md", "전체 차시 MD") +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="open-review"' + (o ? "" : " disabled") + ">🎬 검토 후 슬라이드·문서로 빌드 (" + sess.n + "개 차시 · 드롭다운으로 이동) →</button>" +
      '<button class="btn btn-ghost" data-act="dl-qcsv"' + (qn ? "" : " disabled") + ">⤓ 이 단원 문제은행 CSV</button></div></div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>과정 전체</h3></div><div class="cs-actions">' +
      '<button class="btn btn-primary" data-act="open-review-all"' + (S.course.units.some(function (x) { return x.outputs; }) ? "" : " disabled") +
      '>🎬 조립된 단원 모두 빌드 (단원·차시 드롭다운으로 이동)</button>' +
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
    if (S.course) {
      var n = C.allModules(S.course).length;
      if (!confirm("지금 과정(학습모듈 " + n + "개 — 교재·NCS·삽화·문항·휴지통 포함)을 새 설계로 바꿉니다. 되돌릴 수 없으니 필요하면 먼저 「과정 설계서.md」와 「전체 교재.md」를 내려받으세요. 계속할까요?")) return;
    }
    var course = C.buildCourse(parsed, d.total, { target: d.target, tool: d.tool });
    S.course = C.ensureCourse(course); S.unit = 0; S.tab = "blocks"; S.showSetup = false; S.ncsPending = null; S.mod = null;
    save();
    if (!useAi) { render(); return; }
    run("AI 블록 설계 준비 중…", function (prog) { return K.courseAI.planCourse(course, prog).then(function () { C.ensureCourse(course); }); });
  }

  /* 검토·빌드 화면으로 넘길 차시 목록 — 드롭다운으로 차시를 오간다 (교재는 그 차시에 걸친 블록만) */
  function sessionParts(u, prefix) {
    return u.outputs.sessions.map(function (s) {
      return { label: prefix + s.no + "차시. " + s.title + " (" + C.fmtMin(s.minutes) + ")", title: s.title, docMd: s.docMd, deckMd: s.deckMd, textMd: C.sessionTextMd(S.course, u, s) };
    });
  }

  function questionCtx(u, m) {
    return { unit: u.title, moduleTitle: m.title, module: m, objectives: m.objectives };
  }
  function moduleCsvRows(u, m) {
    return C.questionsToCsv(m.questions, questionCtx(u, m)).replace(/^﻿/, "").split("\r\n");
  }
  /* 학습모듈을 휴지통으로 (30일 보관 · 되살리기 가능) */
  function trashModule(id) {
    var hit = locate(id);
    if (!hit) return;
    if (hit.unit.modules.length <= 1) { alert("단원에는 블록이 하나 이상 있어야 합니다. 새 블록을 먼저 추가하세요."); return false; }
    hit.unit.modules.splice(hit.mi, 1);
    S.course.trash = (S.course.trash || []).concat([{ module: hit.module, unitId: hit.unit.id, unitTitle: hit.unit.title, at: Date.now() }]);
    if (S.mod === id) S.mod = null;
    save();
    return true;
  }

  var actions = {
    "clear-error": function () { S.error = ""; render(); },
    "busy-stop": function () { if (S.abort) S.abort.abort(); },
    "dlg-close": function () { closeDialog(); },
    "show-setup": function () { S.showSetup = true; render(); },
    "hide-setup": function () { S.showSetup = false; render(); },
    "fill-example": function () { S.draft.topic = EXAMPLE; render(); },
    "new-course": function () {
      if (!confirm("현재 과정 설계를 지우고 새로 시작할까요? (내려받지 않은 내용은 사라집니다)")) return;
      S.course = null; S.showSetup = false; S.unit = 0; S.mod = null; save(); render();
    },
    "plan-ai": function () { startCourse(true); },
    "plan-basic": function () { startCourse(false); },
    "pick-unit": function (el) { S.unit = Number(el.dataset.u); S.ncsPending = null; save(); render(); },
    "tab": function (el) { S.tab = el.dataset.tab; save(); render(); },
    "fit-hours": function () {
      var c = S.course;
      var hrs = C.allocateHours(c.units.length, c.totalHours, c.units.map(function (u) { return u.hours; }));
      c.units.forEach(function (u, i) { u.hours = hrs[i]; C.normalizeUnit(u); });
      save(); render();
    },
    "fit-unit": function () { C.normalizeUnit(unit()); save(); render(); },
    "del-module": function (el) {
      var m = unit().modules[Number(el.dataset.m)];
      if (!m || !confirm("「" + m.title + "」을(를) 휴지통으로 옮길까요? " + TRASH_DAYS + "일 동안 ② 학습모듈 → 휴지통에서 되살릴 수 있습니다.")) return;
      if (trashModule(m.id)) { toast("휴지통으로 옮겼습니다."); render(); }
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
      var u = unit(), old = u.modules.slice();
      if (!confirm("이 단원의 블록을 새로 설계합니다. 지금 블록 " + old.length + "개(교재·NCS·삽화·문항 포함)는 휴지통으로 옮겨 " + TRASH_DAYS + "일 동안 되살릴 수 있습니다. 계속할까요?")) return;
      run("단원 블록 다시 설계 중… (" + aiName("plan") + ")", function () {
        return K.courseAI.planUnit(S.course, u).then(function () {
          var at = Date.now();
          S.course.trash = (S.course.trash || []).concat(old.map(function (m) { return { module: m, unitId: u.id, unitTitle: u.title, at: at }; }));
          if (S.mod && !locate(S.mod)) S.mod = null;
          toast("새 블록으로 바꿨습니다. 이전 블록 " + old.length + "개는 휴지통에 있습니다.");
        });
      });
    },
    "gen-unit": function () {
      var u = unit();
      if (u.modules.some(function (m) { return !m.objectives.length; }) && !confirm("학습목표가 없는 블록이 있습니다. 블록 제목 기준으로 작성할까요?")) return;
      run("교안 작성 준비 중…", function (prog) {
        return K.courseAI.generateUnit(S.course, u, prog).then(function () { S.tab = "outputs"; });
      });
    },
    "assemble": function () { K.courseAI.buildOutputs(S.course, unit()); save(); render(); },
    "open-review": function (el) {
      var u = unit();
      if (u.outputs && K.app) K.app.openReview({ parts: sessionParts(u, ""), index: Number(el.dataset.s) || 0 });
    },
    "open-review-all": function () {
      var list = [], start = 0;
      S.course.units.forEach(function (u, i) {
        if (!u.outputs) return;
        if (i === S.unit) start = list.length;
        list = list.concat(sessionParts(u, (i + 1) + "단원 "));
      });
      if (list.length && K.app) K.app.openReview({ parts: list, index: start });
    },
    "dl-out": function (el) {
      var u = unit(), o = u.outputs, k = el.dataset.k;
      if (!o) return;
      var md = k === "doc" ? C.sessionsDocMd(S.course, u, o) : k === "deck" ? C.sessionsDeckMd(S.course, u, o) : o.textMd;
      download(safeName(el.dataset.file.replace(/\.md$/, "")) + ".md", md);
    },
    "dl-sess": function (el) {
      var u = unit(), s = u.outputs && u.outputs.sessions[Number(el.dataset.s)];
      if (!s) return;
      download(safeName((el.dataset.k === "deckMd" ? "슬라이드 편성안" : "교수안") + " - " + u.title + " " + s.no + "차시") + ".md", s[el.dataset.k]);
    },
    "dl-course": function () { download(safeName("과정 설계서 - " + S.course.title) + ".md", C.courseMd(S.course)); },
    "dl-all-text": function () {
      var c = S.course;
      download(safeName("교재 - " + c.title) + ".md", c.units.map(function (u) { return C.textbookMd(c, u); }).join("\n\n---\n\n"));
    },
    "dl-qcsv": function () {
      var u = unit(), rows = [];
      u.modules.forEach(function (m) { if (m.questions.length) { var r = moduleCsvRows(u, m); rows = rows.concat(rows.length ? r.slice(1) : r); } });
      download(safeName("문제은행 - " + u.title) + ".csv", "﻿" + rows.join("\r\n"), "text/csv");
    },
    "dl-all-qcsv": function () {
      var rows = [];
      S.course.units.forEach(function (u) { u.modules.forEach(function (m) { if (m.questions.length) { var r = moduleCsvRows(u, m); rows = rows.concat(rows.length ? r.slice(1) : r); } }); });
      if (!rows.length) { alert("아직 문항이 없습니다."); return; }
      download(safeName("문제은행 - " + S.course.title) + ".csv", "﻿" + rows.join("\r\n"), "text/csv");
    },
    /* 교과목 NCS */
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
        if (!n) return null;
        return { code: n.code, name: n.name, level: n.level, subd: n.subd, path: n.path, objectives: n.objectives || [], reason: n.reason || "", score: n.score != null ? n.score : n.match, cross: !!n.cross };
      }).filter(function (n) { return n && n.code; });
      S.ncsPending = null;
      if (u.outputs) K.courseAI.buildOutputs(S.course, u);
      save(); render();
    },
    "ncs-recommend": function () {
      var u = unit();
      run("NCS 능력단위 추천 중…", function (prog) {
        return K.courseAI.recommendNcs(S.course, u, function (l) { prog(l); }).then(function (list) { u.ncsDraft = list; });
      });
    }
  };

  /* 다른 화면 모듈(K.courseWS · K.courseTabs.*)의 동작까지 한 곳에서 찾는다 */
  function findAction(name) {
    if (actions[name]) return actions[name];
    if (K.courseWS && K.courseWS.actions[name]) return K.courseWS.actions[name];
    var T = K.courseTabs || {};
    for (var k in T) if (T[k].actions && T[k].actions[name]) return T[k].actions[name];
    return null;
  }
  var FREE_WHEN_BUSY = /^(clear-error|busy-stop|tab|pick-unit|ws-pick|ws-sub|ws-group|ws-status|ws-fold|dlg-close|tb-pv|ref-view|q-filter)$/;
  function onClick(e) {
    var el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
    var fn = findAction(el.dataset.act);
    if (!fn || el.disabled) return;
    if (S.busy && !FREE_WHEN_BUSY.test(el.dataset.act)) { e.preventDefault(); return; }
    if (el.tagName === "INPUT" && el.type === "checkbox") e.preventDefault();
    fn(el, ctx(), e);
  }
  root.addEventListener("click", onClick);
  modal.addEventListener("click", onClick);

  function eachHandler(kind, el, c) {
    var hs = [K.courseWS].concat(Object.keys(K.courseTabs || {}).map(function (k) { return K.courseTabs[k]; }));
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i] && hs[i][kind];
      if (!h) continue;
      var r = h(el, c);
      if (r) return r;
    }
    return false;
  }
  function onChange(e) {
    var el = e.target;
    if (el.dataset.f && root.contains(el)) { setPath(el.dataset.f, el); return; }
    eachHandler("change", el, ctx());
  }
  root.addEventListener("change", onChange);
  modal.addEventListener("change", onChange);

  /* 입력 처리: 화면 모듈이 문자열(선택자)을 돌려주면 잠시 뒤 다시 그리고 그 칸에 커서를 돌려준다 */
  var refocusT = null;
  function onInput(e) {
    var el = e.target;
    S.composing = !!e.isComposing;
    if (el.id === "cs-topic") { S.draft.topic = el.value; save(); return; }
    if (el.id === "cs-ncs-q") { S.ncsQuery = el.value; refocusLater("#cs-ncs-q", el); return; }
    var r = eachHandler("input", el, ctx());
    if (typeof r === "string") refocusLater(r, el);
  }
  /* 검색 칸: 입력이 멈추면 다시 그린다. 한글 조합 중이면 미루고, 사용자가 다른 곳으로 옮겼으면 포커스를 빼앗지 않는다 */
  function refocusLater(sel, el) {
    clearTimeout(refocusT);
    refocusT = setTimeout(function () {
      if (S.composing) { refocusLater(sel, el); return; }
      var had = document.activeElement === el, pos = el.selectionStart;
      render();
      if (!had) return;
      var n = root.querySelector(sel) || modal.querySelector(sel);
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e2) {} }
    }, 350);
  }
  function onCompEnd(e) { S.composing = false; onInput({ target: e.target, isComposing: false }); }
  root.addEventListener("input", onInput);
  modal.addEventListener("input", onInput);
  root.addEventListener("compositionend", onCompEnd);
  modal.addEventListener("compositionend", onCompEnd);

  document.addEventListener("kb-ai-change", function () { if (document.getElementById("app").dataset.screen === "course") render(); });

  load();
  K.cui = {
    S: S, esc: esc, opt: opt, render: render, save: save, run: run, toast: toast,
    openDialog: openDialog, closeDialog: closeDialog, dialogOpen: dialogOpen, dialogEl: function () { return dlgBox; },
    aiReady: aiReady, aiName: aiName, download: download, safeName: safeName, ctx: ctx, locate: locate, unit: unit,
    trashModule: trashModule, TRASH_DAYS: TRASH_DAYS, renderProgress: renderProgress
  };
  K.courseUI = {
    open: function () { render(); },
    state: function () { return S; }
  };
})();
