/* course-workspace.js — 과정 설계 ② 학습모듈 화면
 *   왼쪽: 학습모듈 목록(단원별/카테고리별 묶음) · 검색 · 상태 칩(작성중/검수중/완료/개선필요) · NCS 필터 · 휴지통
 *   오른쪽: 모듈 머리(메타데이터·도구·상태·삭제) + 하위 탭(교재 / NCS / 삽화 / 문제은행 — K.courseTabs)
 *   대화상자: 새 학습모듈 · 메타데이터(이름 중복 검사, 카테고리 관리, 선행 모듈 연결, 툴·버전, 변경 이력·직접 기록) · 휴지통 · NCS 필터
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var C = function () { return K.course; };
  var U = function () { return K.cui; };
  var esc = function (s) { return U().esc(s); };
  var SUBS = ["textbook", "ncs", "art", "qbank"];
  var ws = { q: "", status: "", group: "unit", ncsF: null, fold: {}, meta: null, trashQ: "" };

  function dt(at) {
    var d = new Date(at), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function rel(at) {
    var s = Math.round((Date.now() - at) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return Math.round(s / 60) + "분 전";
    if (s < 86400) return Math.round(s / 3600) + "시간 전";
    return Math.round(s / 86400) + "일 전";
  }
  function stClass(st) { return "st-" + C().STATUSES.indexOf(st); }
  function categories(course) {
    var set = {};
    (course.categories || []).forEach(function (c) { set[c] = 0; });
    C().allModules(course).forEach(function (x) { if (x.module.category) set[x.module.category] = (set[x.module.category] || 0) + 1; });
    return Object.keys(set).sort().map(function (k) { return { name: k, n: set[k] }; });
  }

  /* ---------- 목록 ---------- */
  function matches(m) {
    var q = ws.q.trim().toLowerCase();
    if (q && (m.title + " " + (m.category || "") + " " + m.objectives.join(" ")).toLowerCase().indexOf(q) === -1) return false;
    if (ws.status && m.status !== ws.status) return false;
    if (ws.ncsF && ws.ncsF.length) {
      var ch = (m.ncs && m.ncs.chosen) || [];
      var hit = ch.some(function (c) { return ws.ncsF.indexOf(c) !== -1; }) || (!ch.length && ws.ncsF.indexOf("__none") !== -1);
      if (!hit) return false;
    }
    return true;
  }
  function itemHtml(x, cur) {
    var m = x.module;
    var lint = m.content ? K.courseRules.lintTextbook(m) : [];
    var bad = lint.filter(function (v) { return v.sev === "bad"; }).length;
    return '<button class="cs-mi' + (cur && cur.id === m.id ? " on" : "") + '" data-act="ws-pick" data-id="' + m.id + '">' +
      '<span class="cs-dot ' + stClass(m.status) + '" title="' + esc(m.status) + '"></span>' +
      '<span class="cs-mi-t">' + esc(m.title) + "</span>" +
      '<span class="cs-mi-s">' + (x.ui + 1) + "-" + (x.mi + 1) + " · " + C().fmtMin(m.minutes) +
      (m.content ? (bad ? ' · <b class="cs-warn">필수 위반 ' + bad + "</b>" : " · 교재") : "") +
      ((m.ncs.chosen || []).length ? " · NCS " + m.ncs.chosen.length : "") + (m.questions.length ? " · 문항 " + m.questions.length : "") + "</span></button>";
  }
  function sidebar(c) {
    var all = C().allModules(c.course);
    var counts = {};
    all.forEach(function (x) { counts[x.module.status] = (counts[x.module.status] || 0) + 1; });
    var list = all.filter(function (x) { return matches(x.module); });
    var groups = [];
    if (ws.group === "unit") {
      c.course.units.forEach(function (u, ui) { groups.push({ key: "u" + u.id, title: (ui + 1) + ". " + u.title, items: list.filter(function (x) { return x.ui === ui; }) }); });
    } else {
      var cats = {};
      list.forEach(function (x) { var k = x.module.category || "(카테고리 없음)"; (cats[k] = cats[k] || []).push(x); });
      Object.keys(cats).sort().forEach(function (k) { groups.push({ key: "c" + k, title: k, items: cats[k] }); });
    }
    var chips = '<button class="cs-stc' + (ws.status ? "" : " on") + '" data-act="ws-status" data-v="">전체 <b>' + all.length + "</b></button>" +
      C().STATUSES.map(function (s) { return '<button class="cs-stc ' + stClass(s) + (ws.status === s ? " on" : "") + '" data-act="ws-status" data-v="' + esc(s) + '">' + esc(s) + " <b>" + (counts[s] || 0) + "</b></button>"; }).join("");
    var trashN = (c.course.trash || []).length;
    var rest = K.courseAI.remainingModules(c.course).length;
    return '<aside class="cs-side">' +
      '<div class="cs-side-top"><input class="cs-search" data-ws-q placeholder="학습모듈 검색 (이름·카테고리·목표)" value="' + esc(ws.q) + '">' +
      '<button class="btn btn-primary" data-act="ws-new">＋ 새 학습모듈</button>' +
      (rest ? '<button class="btn btn-ghost cs-gen-rest" data-act="gen-course"' + (U().aiReady("write") ? "" : ' disabled title="AI 키 필요"') + ">📝 남은 교안 " + rest + "개 모두 만들기</button>" : "") + "</div>" +
      '<div class="cs-stchips">' + chips + "</div>" +
      '<div class="cs-side-row"><span class="cs-seg2"><button class="' + (ws.group === "unit" ? "on" : "") + '" data-act="ws-group" data-v="unit">단원별</button><button class="' + (ws.group === "category" ? "on" : "") + '" data-act="ws-group" data-v="category">카테고리별</button></span>' +
      '<button class="cs-link" data-act="ws-ncsf">NCS 필터' + (ws.ncsF && ws.ncsF.length ? " (" + ws.ncsF.length + ")" : "") + "</button>" +
      (ws.ncsF && ws.ncsF.length ? '<button class="cs-x" data-act="ws-ncsf-clear" title="NCS 필터 해제">✕</button>' : "") + "</div>" +
      '<div class="cs-mlist">' + (groups.map(function (g) {
        if (!g.items.length && (ws.q || ws.status || ws.ncsF)) return "";
        var folded = ws.fold[g.key];
        return '<div class="cs-mg"><button class="cs-mg-h" data-act="ws-fold" data-k="' + esc(g.key) + '">' + (folded ? "▸" : "▾") + " " + esc(g.title) + ' <span class="cs-muted">' + g.items.length + "</span></button>" +
          (folded ? "" : g.items.map(function (x) { return itemHtml(x, c.module); }).join("") || '<div class="cs-muted cs-mg-e">학습모듈 없음</div>') + "</div>";
      }).join("") || '<div class="cs-empty">조건에 맞는 학습모듈이 없습니다.</div>') + "</div>" +
      '<button class="cs-trash-btn" data-act="ws-trash">🗑 휴지통 <b>' + trashN + "</b></button></aside>";
  }

  /* ---------- 모듈 머리 ---------- */
  function prereqBadges(c, m) {
    return (m.prereqs || []).map(function (p) {
      var f = C().findPrereq(c.course, p, m.id);
      if (f.state === "ok") return '<span class="cs-pre ok" title="' + esc(f.module.status) + '"><i class="cs-dot ' + stClass(f.module.status) + '"></i>' + esc(f.module.title) + "</span>";
      if (f.state === "self") return '<span class="cs-pre bad">' + esc(p.name) + " (자기 자신)</span>";
      return '<span class="cs-pre warn" title="등록된 학습모듈과 이름이 맞지 않습니다">' + esc(p.name) + " (미등록)</span>";
    }).join("");
  }
  function head(c) {
    var m = c.module;
    var tools = (m.tools || []).filter(function (t) { return t.name; });
    return '<div class="cs-mhead"><div class="cs-mhead-main">' +
      '<div class="cs-crumb">단원 ' + (c.ui + 1) + ". " + esc(c.unit.title) + " · 블록 " + (c.ui + 1) + "-" + (c.mi + 1) + "</div>" +
      "<h3>" + esc(m.title) + "</h3>" +
      '<div class="cs-meta">' + (m.category ? '<span class="cs-cat">' + esc(m.category) + "</span>" : '<span class="cs-muted">카테고리 없음</span>') +
      "<span>예상 소요 " + C().fmtMin(m.minutes) + "</span>" +
      (tools.length ? tools.map(function (t) { return '<span class="cs-tool">' + esc(t.name) + (t.version ? ' <b class="mono">' + esc(t.version) + "</b>" : "") + "</span>"; }).join("")
        : (c.course.tool ? '<span class="cs-tool">' + esc(c.course.tool) + ' <span class="cs-muted">(과정 기본)</span></span>' : "")) +
      ((m.prereqs || []).length ? '<span class="cs-muted">선행</span>' + prereqBadges(c, m) : "") + "</div></div>" +
      '<div class="cs-mhead-act"><select data-ws-status-sel class="cs-st-sel ' + stClass(m.status) + '">' + C().STATUSES.map(function (s) { return U().opt(s, s, m.status); }).join("") + "</select>" +
      '<button class="btn btn-ghost" data-act="ws-meta">메타데이터</button><button class="cs-danger" data-act="ws-del">삭제</button></div></div>';
  }
  function subtabs(c) {
    return '<div class="cs-subtabs">' + SUBS.map(function (k) {
      var T = K.courseTabs[k];
      if (!T) return "";
      return '<button class="cs-subtab' + (U().S.sub === k ? " on" : "") + '" data-act="ws-sub" data-sub="' + k + '">' + esc(T.label) + (T.badge ? T.badge(c.module) : "") + "</button>";
    }).join("") + "</div>";
  }

  function render(c) {
    var S = U().S;
    if (!c.module) {
      var first = C().allModules(c.course).filter(function (x) { return x.ui === S.unit; })[0] || C().allModules(c.course)[0];
      if (first) { S.mod = first.module.id; c = U().ctx(); }
    }
    if (SUBS.indexOf(S.sub) === -1) S.sub = "textbook";
    var main;
    if (!c.module) main = '<div class="cs-empty">학습모듈이 없습니다. 「＋ 새 학습모듈」로 만드세요.</div>';
    else {
      var T = K.courseTabs[S.sub];
      main = head(c) + subtabs(c) + '<div class="cs-subbody">' + (T ? T.render(c) : "") + "</div>";
    }
    return '<div class="cs-ws">' + sidebar(c) + '<section class="cs-wmain">' + main + "</section></div>";
  }
  function after(c) {
    var T = K.courseTabs[U().S.sub];
    if (c.module && T && T.after) T.after(c);
  }

  /* ---------- 메타데이터 / 새 학습모듈 대화상자 ---------- */
  function metaFrom(c, m) {
    return {
      isNew: !m, id: m ? m.id : null, unit: m ? c.ui : (ws.newUnit != null ? ws.newUnit : U().S.unit),
      title: m ? m.title : "", category: m ? m.category || "" : "", minutes: m ? m.minutes : 60,
      prereqs: m ? (m.prereqs || []).map(function (p) { return p.name || ""; }) : [],
      tools: m && (m.tools || []).length ? m.tools.map(function (t) { return { name: t.name || "", version: t.version || "" }; }) : [{ name: "", version: "" }],
      log: "", catMgr: false
    };
  }
  function titleTaken(course, title, selfId) {
    var t = String(title || "").trim();
    return C().allModules(course).some(function (x) { return x.module.title.trim() === t && x.module.id !== selfId; });
  }
  function metaDialog() {
    var c = U().ctx(), d = ws.meta, course = c.course;
    var m = d.isNew ? null : C().allModules(course).filter(function (x) { return x.module.id === d.id; })[0];
    m = m ? m.module : null;
    var taken = d.title.trim() && titleTaken(course, d.title, d.id);
    var names = C().allModules(course).map(function (x) { return x.module.title; }).filter(function (t) { return !m || t !== m.title; });
    var cats = categories(course);
    var pre = d.prereqs.map(function (p, i) {
      var f = p.trim() ? C().findPrereq(course, { name: p }, d.id) : { state: "empty" };
      var badge = f.state === "ok" ? '<span class="cs-pre ok"><i class="cs-dot ' + stClass(f.module.status) + '"></i>' + esc(f.module.status) + "</span>"
        : f.state === "self" ? '<span class="cs-pre bad">자기 자신</span>' : f.state === "none" ? '<span class="cs-pre warn">미등록</span>' : "";
      return '<div class="cs-chrow"><input list="cs-mod-names" data-md="pre" data-i="' + i + '" value="' + esc(p) + '" placeholder="선행 학습모듈 이름">' + badge +
        '<button class="cs-x" data-act="md-pre-del" data-i="' + i + '">✕</button></div>';
    }).join("");
    var tools = d.tools.map(function (t, i) {
      return '<div class="cs-chrow"><input data-md="tool-name" data-i="' + i + '" value="' + esc(t.name) + '" placeholder="툴 이름 (예: Unity)"><input class="mono cs-ver" data-md="tool-ver" data-i="' + i + '" value="' + esc(t.version) + '" placeholder="버전 (예: 6000.0 LTS)">' +
        '<button class="cs-x" data-act="md-tool-del" data-i="' + i + '">✕</button></div>';
    }).join("");
    var log = m ? (m.changelog || []).slice().reverse().map(function (x) { return '<li><span class="mono cs-muted">' + dt(x.at) + "</span> " + esc(x.t) + "</li>"; }).join("") : "";
    U().openDialog('<div class="cs-dlg-h"><h3>' + (d.isNew ? "새 학습모듈" : "메타데이터") + '</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<datalist id="cs-mod-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
      '<datalist id="cs-cats">' + cats.map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join("") + "</datalist>" +
      '<label class="cs-lab">학습모듈 이름 <span class="cs-muted">(과정 안에서 겹치지 않게)</span></label><input data-md="title" value="' + esc(d.title) + '" placeholder="예: 프롬프트 구조 설계">' +
      '<div class="cs-error-t" data-md-dup>' + (taken ? "같은 이름의 학습모듈이 이미 있습니다." : "") + "</div>" +
      '<div class="cs-q-form"><label>단원(교과목) <select data-md="unit">' + course.units.map(function (u, i) { return U().opt(i, (i + 1) + ". " + u.title, d.unit); }).join("") + "</select></label>" +
      '<label>카테고리 <input list="cs-cats" data-md="category" value="' + esc(d.category) + '" placeholder="예: 생성형 AI 기초"></label>' +
      '<label>예상 소요 시간 <input type="number" min="10" step="5" data-md="minutes" value="' + esc(d.minutes) + '"> 분</label></div>' +
      '<button class="cs-link" data-act="md-cat-mgr">카테고리 관리 ' + (d.catMgr ? "접기" : "펼치기") + "</button>" +
      (d.catMgr ? '<div class="cs-catmgr">' + (cats.map(function (x) {
        return '<div class="cs-chrow"><span>' + esc(x.name) + ' <span class="cs-muted">' + x.n + "개 모듈</span></span><button class=\"cs-link\" data-act=\"md-cat-ren\" data-v=\"" + esc(x.name) + '">이름 바꾸기</button><button class="cs-link cs-danger-t" data-act="md-cat-del" data-v="' + esc(x.name) + '">삭제</button></div>';
      }).join("") || '<p class="cs-muted">카테고리가 없습니다.</p>') + "</div>" : "") +
      '<label class="cs-lab">선행 학습모듈 <span class="cs-muted">(메타데이터 전용 — 교재 본문에서는 언급하지 않습니다)</span></label>' + pre +
      '<button class="cs-link" data-act="md-pre-add">＋ 선행 모듈</button>' +
      '<label class="cs-lab">사용 툴과 버전 <span class="cs-muted">(버전 의존 정보는 본문이 아니라 여기서 관리합니다)</span></label>' + tools +
      '<button class="cs-link" data-act="md-tool-add">＋ 툴</button>' +
      (m ? '<label class="cs-lab">변경 이력</label><div class="cs-chrow"><input data-md="log" value="' + esc(d.log) + '" placeholder="직접 기록 (예: 교과목 담당자 검토 반영)"><button class="btn btn-ghost" data-act="md-log">기록</button></div><ul class="cs-log">' + log + "</ul>" : "") +
      '</div><div class="cs-dlg-f"><button class="btn btn-ghost" data-act="dlg-close">취소</button><button class="btn btn-primary" data-act="md-save"' + (taken || !d.title.trim() ? " disabled" : "") + ">" + (d.isNew ? "만들기" : "저장") + "</button></div>");
  }
  /* 이름 칸: 대화상자를 다시 그리지 않고 중복 안내와 저장 버튼만 바꾼다 (한글 조합·자동 완성 목록 유지) */
  function refreshTitleState() {
    var d = ws.meta, box = U().dialogEl();
    var taken = d.title.trim() && titleTaken(U().ctx().course, d.title, d.id);
    var w = box.querySelector("[data-md-dup]"), b = box.querySelector('[data-act="md-save"]');
    if (w) w.textContent = taken ? "같은 이름의 학습모듈이 이미 있습니다." : "";
    if (b) b.disabled = !!taken || !d.title.trim();
  }

  function saveMeta() {
    var c = U().ctx(), d = ws.meta, course = c.course;
    var title = d.title.trim();
    if (!title || titleTaken(course, title, d.id)) return;
    var tools = d.tools.filter(function (t) { return t.name.trim(); }).map(function (t) { return { name: t.name.trim(), version: t.version.trim() }; });
    var prereqs = d.prereqs.map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      var f = C().findPrereq(course, { name: p }, d.id);
      return { id: f.state === "ok" ? f.module.id : null, name: p };
    });
    var minutes = Math.max(10, Math.round((Number(d.minutes) || 60) / 5) * 5);
    var target = course.units[d.unit] || course.units[0];
    if (d.isNew) {
      var m = C().newModule({ title: title, minutes: minutes, category: d.category.trim(), tools: tools, prereqs: prereqs });
      target.modules.push(m);
      U().S.mod = m.id; U().S.sub = "textbook"; U().S.tab = "modules"; U().S.unit = d.unit;
      U().toast("학습모듈을 만들었습니다. 블록 시간 합계를 확인하세요.");
    } else {
      var hit = U().locate(d.id), mm = hit.module, changed = [];
      if (mm.title !== title) changed.push("이름");
      if ((mm.category || "") !== d.category.trim()) changed.push("카테고리");
      if (mm.minutes !== minutes) changed.push("소요 시간");
      if (JSON.stringify(mm.tools || []) !== JSON.stringify(tools)) changed.push("툴·버전");
      if (JSON.stringify((mm.prereqs || []).map(function (p) { return p.name; })) !== JSON.stringify(prereqs.map(function (p) { return p.name; }))) changed.push("선행 모듈");
      mm.title = title; mm.category = d.category.trim(); mm.minutes = minutes; mm.tools = tools; mm.prereqs = prereqs;
      if (hit.unit !== target) {
        hit.unit.modules.splice(hit.mi, 1); target.modules.push(mm); changed.push("단원 이동");
        if (!hit.unit.modules.length) hit.unit.modules.push(C().newModule({ title: hit.unit.title + " — 새 블록", minutes: 60 }));
        U().S.unit = d.unit;
      }
      if (changed.length) C().logChange(mm, "메타데이터 수정 (" + changed.join(", ") + ")");
    }
    ws.meta = null;
    U().closeDialog(); U().save(); U().render();
  }

  /* ---------- 휴지통 ---------- */
  function trashDialog() {
    var c = U().ctx(), T = (c.course.trash || []).slice().sort(function (a, b) { return b.at - a.at; });
    var days = U().TRASH_DAYS;
    U().openDialog('<div class="cs-dlg-h"><h3>휴지통</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<p class="cs-muted">지운 학습모듈은 ' + days + "일 동안 보관한 뒤 영구 삭제합니다. 교재·NCS 대응·삽화·문항이 함께 보관됩니다.</p>" +
      (T.length ? '<table class="cs-table"><thead><tr><th>학습모듈</th><th>단원</th><th>지운 날</th><th>남은 기간</th><th></th></tr></thead><tbody>' + T.map(function (t) {
        var left = Math.max(0, days - Math.floor((Date.now() - t.at) / 864e5));
        var m = t.module;
        return "<tr><td><b>" + esc(m.title) + '</b><div class="cs-muted">' + (m.content ? "교재 있음 · " : "") + (m.questions || []).length + "문항 · 삽화 " + (m.ills || []).length + "</div></td><td>" + esc(t.unitTitle) +
          '</td><td class="mono">' + dt(t.at) + "</td><td>" + left + '일</td><td><button class="btn btn-ghost" data-act="tr-restore" data-id="' + m.id + '">되살리기</button> <button class="cs-danger" data-act="tr-purge" data-id="' + m.id + '">영구 삭제</button></td></tr>';
      }).join("") + "</tbody></table>" : '<div class="cs-empty">휴지통이 비어 있습니다.</div>') + "</div>" +
      '<div class="cs-dlg-f"><button class="cs-danger" data-act="tr-empty"' + (T.length ? "" : " disabled") + '>휴지통 비우기</button><div class="cs-spacer"></div><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div>');
  }

  /* ---------- NCS 필터 ---------- */
  function ncsFilterDialog() {
    var c = U().ctx(), use = {}, none = 0;
    C().allModules(c.course).forEach(function (x) {
      var ch = (x.module.ncs && x.module.ncs.chosen) || [];
      if (!ch.length) none++;
      ch.forEach(function (code) { use[code] = (use[code] || 0) + 1; });
    });
    var sel = ws.ncsDraft || (ws.ncsF || []).slice();
    ws.ncsDraft = sel;
    var codes = Object.keys(use).sort();
    U().openDialog('<div class="cs-dlg-h"><h3>NCS 필터</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<p class="cs-muted">고른 능력단위요소(또는 능력단위)에 대응한 학습모듈만 목록에 보입니다.</p>' +
      '<label class="cs-tree-row"><input type="checkbox" data-act="nf-toggle" data-code="__none"' + (sel.indexOf("__none") !== -1 ? " checked" : "") + "><span>NCS 미대응 학습모듈</span><span class=\"mono cs-muted\">" + none + "</span></label>" +
      (codes.length ? codes.map(function (code) {
        var f = K.ncsRef ? K.ncsRef.find(code) : null;
        var name = f ? (f.elem ? f.elem.name : f.unit.name) : code;
        return '<label class="cs-tree-row"><input type="checkbox" data-act="nf-toggle" data-code="' + esc(code) + '"' + (sel.indexOf(code) !== -1 ? " checked" : "") + "><span>" + esc(name) +
          ' <span class="mono cs-muted">' + esc(code) + '</span></span><span class="mono cs-muted">' + use[code] + "</span></label>";
      }).join("") : '<p class="cs-muted">아직 NCS를 대응한 학습모듈이 없습니다.</p>') + "</div>" +
      '<div class="cs-dlg-f"><button class="btn btn-ghost" data-act="nf-clear">해제</button><div class="cs-spacer"></div><button class="btn btn-primary" data-act="nf-apply">적용 (' + sel.length + ")</button></div>");
  }

  var actions = {
    "ws-open": function (el) { U().S.mod = el.dataset.id; U().S.tab = "modules"; U().save(); U().render(); },
    "ws-pick": function (el) { U().S.mod = el.dataset.id; var h = U().locate(el.dataset.id); if (h) U().S.unit = h.ui; U().save(); U().render(); },
    "ws-sub": function (el) { U().S.sub = el.dataset.sub; U().render(); },
    "ws-status": function (el) { ws.status = el.dataset.v; U().render(); },
    "ws-group": function (el) { ws.group = el.dataset.v; U().render(); },
    "ws-fold": function (el) { ws.fold[el.dataset.k] = !ws.fold[el.dataset.k]; U().render(); },
    "ws-new": function (el) {
      ws.newUnit = el.dataset.u != null ? Number(el.dataset.u) : U().S.unit;
      ws.meta = metaFrom(U().ctx(), null); metaDialog();
    },
    "ws-meta": function (el, c) { ws.meta = metaFrom(c, c.module); metaDialog(); },
    "ws-del": function (el, c) {
      if (!confirm("「" + c.module.title + "」을(를) 휴지통으로 옮길까요? " + U().TRASH_DAYS + "일 동안 되살릴 수 있습니다.")) return;
      if (U().trashModule(c.module.id)) { U().toast("휴지통으로 옮겼습니다."); U().render(); }
    },
    "ws-trash": function () { trashDialog(); },
    "ws-ncsf": function () { ws.ncsDraft = null; ncsFilterDialog(); },
    "ws-ncsf-clear": function () { ws.ncsF = null; U().render(); },
    "nf-toggle": function (el) {
      var s = ws.ncsDraft, i = s.indexOf(el.dataset.code);
      if (i === -1) s.push(el.dataset.code); else s.splice(i, 1);
      ncsFilterDialog();
    },
    "nf-clear": function () { ws.ncsF = null; ws.ncsDraft = null; U().closeDialog(); U().render(); },
    "nf-apply": function () { ws.ncsF = ws.ncsDraft.length ? ws.ncsDraft.slice() : null; ws.ncsDraft = null; U().closeDialog(); U().render(); },
    "md-pre-add": function () { ws.meta.prereqs.push(""); metaDialog(); },
    "md-pre-del": function (el) { ws.meta.prereqs.splice(Number(el.dataset.i), 1); metaDialog(); },
    "md-tool-add": function () { ws.meta.tools.push({ name: "", version: "" }); metaDialog(); },
    "md-tool-del": function (el) { ws.meta.tools.splice(Number(el.dataset.i), 1); metaDialog(); },
    "md-cat-mgr": function () { ws.meta.catMgr = !ws.meta.catMgr; metaDialog(); },
    "md-cat-ren": function (el) {
      var from = el.dataset.v, to = prompt("새 카테고리 이름", from);
      if (to == null || !to.trim() || to.trim() === from) return;
      var c = U().ctx(), n = 0;
      C().allModules(c.course).forEach(function (x) { if (x.module.category === from) { x.module.category = to.trim(); C().logChange(x.module, "카테고리 이름 변경: " + from + " → " + to.trim()); n++; } });
      c.course.categories = (c.course.categories || []).map(function (k) { return k === from ? to.trim() : k; });
      if (ws.meta.category === from) ws.meta.category = to.trim();
      U().save(); U().toast(n + "개 학습모듈의 카테고리를 바꿨습니다."); metaDialog();
    },
    "md-cat-del": function (el) {
      var name = el.dataset.v;
      if (!confirm("카테고리 「" + name + "」를 지울까요? 이 카테고리를 쓰던 학습모듈은 카테고리 없음이 됩니다.")) return;
      var c = U().ctx();
      C().allModules(c.course).forEach(function (x) { if (x.module.category === name) { x.module.category = ""; C().logChange(x.module, "카테고리 삭제: " + name); } });
      c.course.categories = (c.course.categories || []).filter(function (k) { return k !== name; });
      if (ws.meta.category === name) ws.meta.category = "";
      U().save(); metaDialog();
    },
    "md-log": function () {
      var t = ws.meta.log.trim();
      if (!t) return;
      var h = U().locate(ws.meta.id);
      if (h) { C().logChange(h.module, t); ws.meta.log = ""; U().save(); metaDialog(); }
    },
    "md-save": function () { saveMeta(); },
    "tr-restore": function (el) {
      var c = U().ctx(), course = c.course;
      var t = (course.trash || []).filter(function (x) { return x.module.id === el.dataset.id; })[0];
      if (!t) return;
      var u = course.units.filter(function (x) { return x.id === t.unitId; })[0] || course.units[Math.min(U().S.unit, course.units.length - 1)];
      var m = t.module;
      if (titleTaken(course, m.title, m.id)) m.title += " (복원)";
      C().logChange(m, "휴지통에서 되살림");
      u.modules.push(m);
      course.trash = course.trash.filter(function (x) { return x !== t; });
      U().S.mod = m.id; U().S.tab = "modules";
      U().save(); U().toast("「" + m.title + "」을(를) 되살렸습니다. 블록 시간 합계를 확인하세요."); trashDialog(); U().render();
    },
    "tr-purge": function (el) {
      if (!confirm("영구 삭제하면 되돌릴 수 없습니다. 삭제할까요?")) return;
      var c = U().ctx();
      c.course.trash = (c.course.trash || []).filter(function (x) { return x.module.id !== el.dataset.id; });
      U().save(); trashDialog(); U().render();
    },
    "tr-empty": function () {
      if (!confirm("휴지통의 학습모듈을 모두 영구 삭제할까요? 되돌릴 수 없습니다.")) return;
      U().ctx().course.trash = [];
      U().save(); trashDialog(); U().render();
    }
  };

  function input(el) {
    if (el.hasAttribute("data-ws-q")) { ws.q = el.value; return "[data-ws-q]"; }
    var k = el.dataset.md;
    if (!k || !ws.meta) return false;
    var i = Number(el.dataset.i), d = ws.meta;
    if (k === "title") { d.title = el.value; refreshTitleState(); return true; }
    if (k === "category") d.category = el.value;
    else if (k === "minutes") d.minutes = el.value;
    else if (k === "log") d.log = el.value;
    else if (k === "tool-name") d.tools[i].name = el.value;
    else if (k === "tool-ver") d.tools[i].version = el.value;
    else if (k === "pre") d.prereqs[i] = el.value; // 연결 표시는 칸을 벗어날 때(change) 갱신
    return true;
  }
  function change(el, c) {
    if (el.hasAttribute("data-ws-status-sel") && c.module) {
      var from = c.module.status;
      c.module.status = el.value;
      C().logChange(c.module, "상태 변경: " + from + " → " + el.value);
      U().save(); U().render();
      return true;
    }
    if (el.dataset.md === "unit" && ws.meta) { ws.meta.unit = Number(el.value); return true; }
    if (el.dataset.md === "pre" && ws.meta) { ws.meta.prereqs[Number(el.dataset.i)] = el.value; metaDialog(); return true; }
    return false;
  }

  K.courseWS = { render: render, after: after, actions: actions, input: input, change: change };
})();
