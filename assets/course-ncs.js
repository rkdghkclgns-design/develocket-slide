/* course-ncs.js — NCS 참조 목록(능력단위 + 사용자 등록 능력단위요소) · 학습모듈 NCS 요소 대응 화면
 *
 *   K.ncsRef  : 내장 목록(ncs-catalog.js, 현행 분류번호·수준) + 이 브라우저에 저장한 보강(요소·직접 추가 단위·검증 표시)
 *   K.courseTabs.ncs : 학습모듈 'NCS' 탭 — NCS 선정(대기 → 저장), AI 추천(교재 분석), 직접 선택, 참조 목록 편집
 *
 * 지침: 능력단위요소는 학습모듈에, 능력단위는 교과목에 대응한다. 분류번호는 현행 체계를 그대로 쓰고
 *       학습모듈의 식별자로 쓰지 않는다(NCS 는 개정되며 코드가 바뀐다).
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  var STORE = "kb-ncs-overlay";

  /* ---------- 참조 목록 보강 저장소 ---------- */
  function loadOverlay() {
    try { var j = JSON.parse(localStorage.getItem(STORE) || "null"); if (j && j.units) return j; } catch (e) {}
    return { units: {}, custom: [] };
  }
  var OV = loadOverlay();
  function saveOverlay() { try { localStorage.setItem(STORE, JSON.stringify(OV)); } catch (e) {} }

  function catalogUnit(code) { return K.course ? K.course.ncsUnit(code) : null; }
  /* 단위 객체 = {code, name, level, subclass, path, elements:[{code,name}], verified, custom} */
  function unitInfo(code) {
    var c = catalogUnit(code);
    var o = OV.units[code] || {};
    if (c) return { code: c.code, name: c.name, level: c.level, subclass: c.path[3], path: c.path, duty: c.duty, elements: o.elements || [], verified: o.verified !== false, custom: false };
    var u = OV.custom.filter(function (x) { return x.code === code || (!x.code && x.name === code); })[0];
    if (u) return { code: u.code, name: u.name, level: u.level, subclass: u.subclass || "", path: ["", "", "", u.subclass || ""], duty: "", elements: u.elements || [], verified: u.verified !== false, custom: true };
    return null;
  }
  /* 요소·직접 추가가 있는 단위 (참조 목록 편집 화면에 먼저 보인다) */
  function enrichedUnits() {
    var codes = Object.keys(OV.units).filter(function (k) { return (OV.units[k].elements || []).length || OV.units[k].verified === false; });
    return codes.map(unitInfo).filter(Boolean).concat(OV.custom.map(function (u) { return unitInfo(u.code || u.name); }));
  }
  function find(code) {
    code = String(code || "");
    var unitCode = code.split(".")[0];
    var u = unitInfo(unitCode) || unitInfo(code);
    if (!u) return null;
    if (code === u.code) return { unit: u };
    var e = (u.elements || []).filter(function (x) { return x.code === code; })[0];
    return e ? { unit: u, elem: e } : { unit: u };
  }
  function search(q, limit) {
    q = String(q || "").trim();
    if (!q) return [];
    var hits = K.course.ncsSearch(q, limit || 20, { perSubd: 6 }).map(function (u) { return unitInfo(u.code); });
    var low = q.toLowerCase();
    var extra = enrichedUnits().filter(function (u) {
      return (u.code + " " + u.name + " " + (u.subclass || "") + " " + u.elements.map(function (e) { return e.code + " " + e.name; }).join(" ")).toLowerCase().indexOf(low) !== -1;
    });
    var seen = {}, out = [];
    extra.concat(hits).forEach(function (u) { if (u && !seen[u.code || u.name]) { seen[u.code || u.name] = 1; out.push(u); } });
    // 코드를 직접 입력한 경우
    var exact = find(q);
    if (exact && !seen[exact.unit.code]) out.unshift(exact.unit);
    return out.slice(0, limit || 20);
  }
  function saveUnit(u) {
    var elems = (u.elements || []).filter(function (e) { return e.name; });
    if (catalogUnit(u.code)) {
      OV.units[u.code] = { elements: elems, verified: u.verified !== false };
    } else {
      OV.custom = OV.custom.filter(function (x) { return (x.code || x.name) !== (u.code || u.name); });
      OV.custom.push({ code: u.code, name: u.name, level: u.level || null, subclass: u.subclass || "", elements: elems, verified: u.verified !== false });
    }
    saveOverlay();
  }
  function deleteUnit(code) {
    if (catalogUnit(code)) delete OV.units[code];
    else OV.custom = OV.custom.filter(function (x) { return (x.code || x.name) !== code; });
    saveOverlay();
  }
  /* "0803020529_18v4.1 게임 UI 구현하기" 한 줄 → {code, name} */
  function parseElementLine(line, unitCode) {
    var m = String(line).trim().match(/^(\d{10}_\d{2}v\d+\.\d+)\s+(.*)$/);
    if (m) return { code: m[1], name: m[2].trim() };
    var n = String(line).trim().match(/^(\d+)[.)]\s*(.*)$/);
    if (n && unitCode) return { code: unitCode + "." + n[1], name: n[2].trim() };
    return { code: "", name: String(line).trim() };
  }
  function stats() {
    var cat = (K.NCS && K.NCS.units.length) || 0;
    var els = 0;
    Object.keys(OV.units).forEach(function (k) { els += (OV.units[k].elements || []).length; });
    OV.custom.forEach(function (u) { els += (u.elements || []).length; });
    return { units: cat + OV.custom.length, elements: els, custom: OV.custom.length };
  }

  K.ncsRef = { unitInfo: unitInfo, find: find, search: search, saveUnit: saveUnit, deleteUnit: deleteUnit, enrichedUnits: enrichedUnits, parseElementLine: parseElementLine, stats: stats };

  /* ================= 학습모듈 NCS 탭 ================= */
  function C() { return K.cui; }
  var esc = function (s) { return C().esc(s); };
  var ui = { pend: null, pendFor: null, recLow: false, refQ: "", pickQ: "" };

  function pending(m) {
    if (ui.pendFor !== m.id) { ui.pend = null; ui.pendFor = m.id; }
    return ui.pend || (m.ncs.chosen || []).slice();
  }
  function nameOf(code) { var f = find(code); return f ? (f.elem ? f.elem.name : f.unit.name) : ""; }

  function chosenCard(m) {
    var saved = m.ncs.chosen || [], P = pending(m), dirty = !!ui.pend;
    var added = P.filter(function (c) { return saved.indexOf(c) === -1; }), removed = saved.filter(function (c) { return P.indexOf(c) === -1; });
    var all = P.concat(removed);
    var units = {};
    P.forEach(function (c) { var f = find(c); units[f ? f.unit.code : String(c).split(".")[0]] = f ? f.unit.name : ""; });
    var list = all.map(function (c) {
      var st = added.indexOf(c) !== -1 ? "add" : removed.indexOf(c) !== -1 ? "del" : "keep";
      return '<div class="cs-chosen ' + st + '"><span class="cs-ci-tag">' + (st === "add" ? "추가" : st === "del" ? "해제" : "유지") + "</span><div><div>" + esc(nameOf(c) || c) +
        '</div><div class="mono cs-muted">' + esc(c) + '</div></div><button class="cs-x" data-act="nm-toggle" data-code="' + esc(c) + '" title="선택 해제/되살리기">✕</button></div>';
    }).join("");
    var uc = Object.keys(units);
    var auto = !!m.ncs.auto && !dirty && saved.length > 0;
    return '<div class="cs-card' + (dirty ? " cs-dirty" : auto ? " cs-auto" : "") + '"><div class="cs-card-head"><h3>NCS 선정</h3>' +
      (dirty ? '<span class="cs-badge warn">저장 안 됨 · 추가 ' + added.length + " · 해제 " + removed.length + "</span>"
        : auto ? '<span class="cs-badge auto">자동 배정 · 확정 전</span>' : saved.length ? '<span class="cs-muted">확정됨</span>' : "") +
      '<div class="cs-spacer"></div><button class="btn btn-ghost" data-act="nm-revert"' + (dirty ? "" : " disabled") + ">변경 취소</button>" +
      (auto ? '<button class="btn btn-primary" data-act="nm-confirm">✓ 확정</button>' : '<button class="btn btn-primary" data-act="nm-save"' + (dirty ? "" : " disabled") + ">저장</button>") + "</div>" +
      (auto ? '<p class="cs-sub">교재를 분석해 적합도가 높은 항목을 먼저 배정했습니다. 맞으면 「확정」, 아니면 아래에서 고친 뒤 「저장」하세요.</p>' : "") +
      (all.length ? list + (uc.length ? '<div class="cs-uc"><div class="cs-uc-h">교과목 대응 후보 (능력단위)</div>' + uc.map(function (u) { return '<div class="cs-uc-row"><span>' + esc(units[u] || u) + '</span><span class="mono cs-muted">' + esc(u) + "</span></div>"; }).join("") + "</div>" : "")
        : '<p class="cs-sub">AI 추천이나 직접 선택에서 체크한 항목이 여기에 모입니다. 「저장」을 눌러야 반영됩니다.</p>') + "</div>";
  }

  function recRow(r, P) {
    var code = r.elementCode || r.unitCode;
    var f = find(code), inRef = !!f;
    var badge = !inRef ? '<span class="cs-badge bad" title="참조 목록에 없음 · ncs.go.kr에서 확인 필요">목록 밖</span>'
      : f.unit.verified === false ? '<span class="cs-badge warn" title="참조 목록에 있으나 ncs.go.kr 확인 전">미검증</span>' : '<span class="cs-badge ref">참조 목록</span>';
    return '<label class="cs-ncs' + (P.indexOf(code) !== -1 ? " on" : "") + '"><input type="checkbox" data-act="nm-toggle" data-code="' + esc(code) + '"' + (P.indexOf(code) !== -1 ? " checked" : "") + (code ? "" : " disabled") + ">" +
      '<div class="cs-ncs-main"><div class="cs-ncs-name">' + esc(r.elementName || r.unitName) + "</div>" +
      '<dl class="cs-ncs-dl"><dt>요소 코드</dt><dd class="mono">' + esc(r.elementCode || "없음") + "</dd><dt>능력단위</dt><dd>" + esc(r.unitName || "—") + '</dd><dt>단위 코드</dt><dd class="mono">' + esc(r.unitCode || "없음") + "</dd>" +
      (r.level ? "<dt>수준</dt><dd>" + esc(r.level) + "수준</dd>" : "") + "</dl>" +
      ((r.covers || []).length ? '<div class="cs-ncs-obj">학습목표 ' + r.covers.map(function (x) { return x + 1; }).join(" · ") + "</div>" : "") +
      (r.reason ? '<p class="cs-ncs-why">' + esc(r.reason) + "</p>" : "") + "</div>" +
      '<div class="cs-ncs-side">' + badge + '<div class="cs-meter"><i style="width:' + Math.max(4, Math.min(100, +r.fit || 0)) + '%"></i></div><span class="cs-score">적합도 <b>' + (+r.fit || 0) + "</b></span></div></label>";
  }

  function unitTreeHTML(units, P) {
    if (!units.length) return '<div class="cs-muted">찾는 항목이 없습니다. 참조 목록에 없는 능력단위는 「참조 목록 보기·편집」에서 먼저 추가하세요.</div>';
    var bySub = {};
    units.forEach(function (u) { var k = u.subclass || "기타"; (bySub[k] = bySub[k] || []).push(u); });
    return Object.keys(bySub).map(function (sub) {
      return '<div class="cs-tree-sub"><div class="cs-tree-h">' + esc(sub) + "</div>" + bySub[sub].map(function (u) {
        var head = u.elements.length
          ? '<div class="cs-tree-row u"><span></span><span>' + esc(u.name) + (u.verified ? "" : ' <span class="cs-badge warn">미검증</span>') + '</span><span class="mono cs-muted">' + esc(u.code || "코드 없음") + "</span></div>"
          : '<label class="cs-tree-row u"><input type="checkbox" data-act="nm-toggle" data-code="' + esc(u.code || u.name) + '"' + (P.indexOf(u.code || u.name) !== -1 ? " checked" : "") + "><span>" + esc(u.name) +
            ' <span class="cs-muted">· 요소 미등록</span>' + (u.verified ? "" : ' <span class="cs-badge warn">미검증</span>') + '</span><span class="mono cs-muted">' + esc(u.code || "코드 없음") + "</span></label>";
        return head + u.elements.map(function (e) {
          var code = e.code || (u.code + ":" + e.name);
          return '<label class="cs-tree-row e"><input type="checkbox" data-act="nm-toggle" data-code="' + esc(code) + '"' + (P.indexOf(code) !== -1 ? " checked" : "") + "><span>" + esc(e.name) + '</span><span class="mono cs-muted">' + esc(e.code ? "." + e.code.split(".").pop() : "코드 없음") + "</span></label>";
        }).join("");
      }).join("") + "</div>";
    }).join("");
  }

  function render(c) {
    var m = c.module, P = pending(m);
    var recs = (m.ncs.recs || []).slice().sort(function (a, b) { return (+b.fit || 0) - (+a.fit || 0); });
    var shown = ui.recLow ? recs : recs.slice(0, 3);
    var st = stats();
    var pickRes = ui.pickQ.trim() ? unitTreeHTML(search(ui.pickQ, 15), P) : '<p class="cs-muted">코드나 명칭을 입력하면 참조 목록에서 찾아 보여줍니다. 요소가 등록된 능력단위는 요소 단위로, 등록되지 않은 능력단위는 능력단위 자체를 고릅니다.</p>';
    return '<div class="cs-grid2"><div class="cs-stack">' + chosenCard(m) +
      '<div class="cs-card"><div class="cs-card-head"><h3>AI 추천</h3><span class="cs-muted">' + (C().aiReady("plan") ? esc(C().aiName("plan")) : "AI 키 필요") + '</span><div class="cs-spacer"></div>' +
      '<button class="btn btn-primary" data-act="nm-recommend"' + (C().aiReady("plan") && m.objectives.length ? "" : " disabled") + ">" + (recs.length ? "다시 추천" : "교재 분석해서 추천") + "</button></div>" +
      (recs.length ? shown.map(function (r) { return recRow(r, P); }).join("") +
        (recs.length > 3 ? '<button class="cs-link" data-act="nm-reclow">' + (ui.recLow ? "접기" : "후보 " + (recs.length - 3) + "개 더 보기") + "</button>" : "")
        : '<div class="cs-empty">교재를 분석해 참조 목록에서 맞는 능력단위요소(요소가 없으면 능력단위)를 고릅니다.</div>') +
      (m.ncs.note ? '<p class="cs-muted">' + esc(m.ncs.note) + "</p>" : "") + "</div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>직접 선택</h3><input class="cs-search" data-nm-q placeholder="코드·능력단위·요소 이름으로 찾기" value="' + esc(ui.pickQ) + '"></div>' + pickRes + "</div>" +
      '</div><div class="cs-stack"><div class="cs-card"><div class="cs-card-head"><h3>NCS 참조 목록</h3><div class="cs-spacer"></div><button class="btn btn-ghost" data-act="nm-ref">목록 보기·편집</button></div>' +
      '<div class="cs-stats"><div><b class="mono">' + st.units.toLocaleString() + '</b><span class="cs-muted">능력단위</span></div><div><b class="mono">' + st.elements + '</b><span class="cs-muted">능력단위요소</span></div></div>' +
      '<p class="cs-muted">현행 분류(NCS ' + esc((K.NCS && K.NCS.degree) || "") + "차) 능력단위가 들어 있습니다. 능력단위요소는 ncs.go.kr 원문에서 확인해 「목록 보기·편집」으로 등록합니다. 목록에 없는 코드는 AI 추천에서 <b>목록 밖</b>으로 표시합니다.</p></div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>NCS 대응 규칙</h3></div><ul class="cs-guide">' +
      "<li><b>능력단위요소는 학습모듈에, 능력단위는 교과목에 대응합니다.</b> 「NCS 선정」의 교과목 대응 후보는 선정한 요소가 속한 능력단위입니다.</li>" +
      "<li><b>분류번호는 학습모듈 식별자로 쓰지 않습니다.</b> NCS는 개정되며 코드가 바뀝니다.</li>" +
      '<li><b>현행 분류번호를 그대로 씁니다.</b> 최종 확인은 <a href="https://www.ncs.go.kr" target="_blank" rel="noopener noreferrer">ncs.go.kr</a>에서 합니다.</li></ul></div></div></div>';
  }

  /* ---------- 참조 목록 보기·편집 대화상자 ---------- */
  function refDialog(editCode) {
    var q = ui.refQ.trim();
    var rows = q ? search(q, 30) : enrichedUnits();
    var e = editCode ? unitInfo(editCode) : null;
    var tr = rows.map(function (u) {
      return '<tr><td class="mono">' + esc(u.code || "—") + "</td><td><b>" + esc(u.name) + "</b>" + (u.elements.length ? '<div class="cs-muted">' + u.elements.map(function (x) { return esc(x.code ? x.code.split(".").pop() : "·") + ". " + esc(x.name); }).join("<br>") + "</div>" : '<div class="cs-muted">요소 미등록</div>') +
        '</td><td class="mono">' + esc(u.level || "") + '</td><td>' + esc(u.subclass || "") + (u.custom ? ' <span class="cs-badge">직접 추가</span>' : "") + "</td><td>" + (u.verified ? '<span class="cs-badge ref">확인</span>' : '<span class="cs-badge warn">미검증</span>') +
        '</td><td><button class="btn btn-ghost" data-act="nm-ref-edit" data-code="' + esc(u.code || u.name) + '">편집</button></td></tr>';
    }).join("");
    C().openDialog('<div class="cs-dlg-h"><h3>NCS 참조 목록</h3><button class="btn btn-ghost" data-act="dlg-close">닫기</button></div><div class="cs-dlg-b">' +
      '<p class="cs-muted">추천기는 이 목록 안에서 먼저 고릅니다. 현행 분류번호를 그대로 씁니다. 내장 능력단위는 ' + esc((K.NCS && K.NCS.collectedAt) || "") + " ncs.go.kr에서 수집한 값입니다. 능력단위요소와 직접 추가한 능력단위는 이 브라우저에 저장됩니다. 미검증 항목은 ncs.go.kr에서 확인한 뒤 검증 표시를 바꾸세요.</p>" +
      '<input class="cs-search" data-nm-ref-q placeholder="코드·이름·세분류 검색 (비우면 요소를 등록한 능력단위만 보입니다)" value="' + esc(ui.refQ) + '">' +
      '<div class="cs-tbl"><table class="cs-table"><thead><tr><th>코드</th><th>능력단위 / 요소</th><th>수준</th><th>세분류</th><th>검증</th><th></th></tr></thead><tbody>' + (tr || '<tr><td colspan="6" class="cs-muted">' + (q ? "찾는 항목이 없습니다." : "아직 요소를 등록한 능력단위가 없습니다. 위에서 검색해 편집하세요.") + "</td></tr>") + "</tbody></table></div>" +
      '<div class="cs-card cs-ncs-form"><h3>' + (e ? "능력단위 편집" : "능력단위 추가") + "</h3>" +
      '<div class="cs-q-form"><label>분류번호 <input data-nu="code" class="mono" placeholder="0803020529_18v4" value="' + esc(e ? e.code : "") + '"' + (e && !e.custom ? " readonly" : "") + "></label>" +
      '<label>능력단위명 <input data-nu="name" value="' + esc(e ? e.name : "") + '"' + (e && !e.custom ? " readonly" : "") + "></label>" +
      '<label>수준 <input data-nu="level" type="number" min="1" max="8" value="' + esc(e ? e.level || "" : "") + '"' + (e && !e.custom ? " readonly" : "") + "></label>" +
      '<label>세분류 <input data-nu="subclass" value="' + esc(e ? e.subclass || "" : "") + '"' + (e && !e.custom ? " readonly" : "") + "></label></div>" +
      '<label class="cs-lab">능력단위요소 (한 줄에 하나: 「코드 이름」 또는 「번호. 이름」)</label><textarea data-nu="elements" class="mono" rows="4" placeholder="0803020529_18v4.1 게임 UI 구현하기">' +
      esc(e ? e.elements.map(function (x) { return (x.code + " " + x.name).trim(); }).join("\n") : "") + "</textarea>" +
      '<label class="cs-check"><input type="checkbox" data-nu="verified"' + (!e || e.verified ? " checked" : "") + "> ncs.go.kr에서 확인함</label>" +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="nm-ref-save">목록에 저장</button>' + (e ? '<button class="btn btn-ghost" data-act="nm-ref-new">새로 추가</button><button class="cs-danger" data-act="nm-ref-del" data-code="' + esc(e.code || e.name) + '">' + (e.custom ? "이 능력단위 삭제" : "요소·검증 표시 지우기") + "</button>" : "") + "</div></div></div>");
  }

  var actions = {
    "nm-toggle": function (el, c) {
      var m = c.module, P = pending(m).slice(), code = el.dataset.code, i = P.indexOf(code);
      if (i === -1) P.push(code); else P.splice(i, 1);
      var saved = (m.ncs.chosen || []).slice().sort().join("|");
      ui.pend = P.slice().sort().join("|") === saved ? null : P;
      C().render();
    },
    "nm-revert": function () { ui.pend = null; C().render(); },
    "nm-save": function (el, c) {
      var m = c.module, P = pending(m);
      m.ncs.chosen = P.slice();
      m.ncs.auto = false; // 사용자가 고쳐 저장 = 확정
      K.course.logChange(m, "NCS 대응 변경·확정 (" + P.length + "개)");
      ui.pend = null;
      C().save(); C().render();
    },
    "nm-confirm": function (el, c) {
      var m = c.module;
      m.ncs.auto = false;
      K.course.logChange(m, "NCS 자동 배정 확정 (" + (m.ncs.chosen || []).length + "개)");
      C().save(); C().render(); C().toast("NCS 능력단위요소를 확정했습니다.");
    },
    "nm-reclow": function () { ui.recLow = !ui.recLow; C().render(); },
    "nm-recommend": function (el, c) {
      var m = c.module;
      C().run("NCS 능력단위요소 추천 중… (" + C().aiName("plan") + ")", function () {
        return K.courseAI.recommendElements(c.course, c.unit, m).then(function (res) {
          m.ncs.recs = res.recs; m.ncs.note = res.note; m.ncs.at = Date.now();
        });
      });
    },
    "nm-ref": function () { refDialog(null); },
    "nm-ref-edit": function (el) { refDialog(el.dataset.code); },
    "nm-ref-new": function () { refDialog(null); },
    "nm-ref-save": function () {
      var g = function (k) { var x = document.querySelector('[data-nu="' + k + '"]'); return x ? (x.type === "checkbox" ? x.checked : x.value.trim()) : ""; };
      var code = g("code"), name = g("name");
      var known = code && catalogUnit(code);
      if (!known && !name) { C().toast("능력단위명을 입력하세요."); return; }
      if (code && !/^\d{10}_\d{2}v\d+$/.test(code)) { C().toast("분류번호 형식은 0803020529_18v4 처럼 씁니다."); return; }
      var els = g("elements").split("\n").filter(function (l) { return l.trim(); }).map(function (l) { return parseElementLine(l, code); });
      saveUnit({ code: code, name: known ? known.name : name, level: Number(g("level")) || null, subclass: g("subclass"), elements: els, verified: g("verified") });
      C().toast("참조 목록에 저장했습니다.");
      refDialog(code || name);
      C().render();
    },
    "nm-ref-del": function (el) {
      if (!confirm("이 항목을 참조 목록 보강에서 지울까요?")) return;
      deleteUnit(el.dataset.code); refDialog(null); C().render();
    }
  };

  function input(el) {
    if (el.hasAttribute("data-nm-q")) { ui.pickQ = el.value; return "[data-nm-q]"; } // 값 = 다시 그린 뒤 포커스를 돌려줄 선택자
    if (el.hasAttribute("data-nm-ref-q")) {
      ui.refQ = el.value;
      // 입력이 멈추면 목록을 다시 그린다 (한글 조합 중에는 미룸)
      clearTimeout(ui.refT);
      ui.refT = setTimeout(function wait() {
        if (C().S.composing) { ui.refT = setTimeout(wait, 300); return; }
        var cur = document.querySelector("[data-nm-ref-q]");
        if (!cur) return;
        var had = document.activeElement === cur, pos = cur.selectionStart;
        refDialog(null);
        var n = document.querySelector("[data-nm-ref-q]");
        if (had && n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
      }, 300);
      return true;
    }
    return false;
  }

  K.courseTabs = K.courseTabs || {};
  /* 처음 열었을 때 교재는 있는데 선정·추천이 없으면 한 번 자동 배정한다 (확정은 사용자가) */
  function after(c) {
    var m = c.module;
    if (!m || !K.courseAuto || C().S.busy || m.ncs.autoTried || (m.ncs.chosen || []).length || (m.ncs.recs || []).length) return;
    if (!m.objectives.length || !K.courseAI.hasTextbook(m)) return;
    m.ncs.autoTried = true;
    setTimeout(function () {
      C().run("NCS 능력단위요소 자동 배정 중…", function () {
        return K.courseAuto.assignModule(c.course, c.unit, m).then(function (did) {
          C().toast(did ? "적합도가 높은 능력단위요소를 자동 배정했습니다. 확인 후 「확정」하세요." : "자동 배정할 만한 항목을 찾지 못했습니다. 직접 선택하세요.");
        });
      });
    }, 0);
  }

  K.courseTabs.ncs = { label: "NCS", render: render, actions: actions, input: input, after: after,
    badge: function (m) {
      var n = (m.ncs.chosen || []).length;
      return n ? '<span class="cs-cnt' + (m.ncs.auto ? " auto" : "") + '" title="' + (m.ncs.auto ? "자동 배정 · 확정 전" : "확정됨") + '">' + n + (m.ncs.auto ? "?" : "") + "</span>" : "";
    } };
})();
