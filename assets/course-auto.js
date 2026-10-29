/* course-auto.js — 과정 설계의 자동 단계
 *   · NCS 자동 배정: 교과목(단원)에는 능력단위, 학습모듈에는 능력단위요소를 적합도 순으로 먼저 골라 둔다(미확정).
 *     사용자가 「확정」하거나 선택을 고쳐 「저장」하면 확정된다. 확정한 선택은 다시 자동 배정하지 않는다.
 *   · 삽화 자동 생성: 교재 학습내용마다 SVG 삽화를 그려 그 자리에 배치한다(과정 아트 스타일 가이드·기준 삽화를 따름).
 *     기준 삽화가 없으면 처음 그린 삽화를 기준으로 삼아 과정 전체의 화풍을 맞춘다.
 *   · 교안 본문 이미지: 학습내용의 소제목 아래에 그 내용을 보여 주는 그림을 넣는다(lesson-images.js — 이미지 자동 생성 설정·Google 키가 있을 때).
 *   K.courseAuto = { settings, topPicks, unitEntry, assignUnit, assignUnits, assignModule, illustrate, afterTextbook } */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var C = function () { return K.course; };
  var AI = function () { return K.courseAI; };
  var PICK_MIN = 70, PICK_MAX = 3, PICK_FLOOR = 40;

  function isCancel(e) { return !!(e && (e.code === "cancelled" || e.name === "AbortError")); }
  function settings(course) { var a = (course && course.auto) || {}; return { art: a.art !== false }; }

  /* 적합도 70점 이상을 높은 순으로 최대 3개 — 없으면 40점 이상인 1위 하나 */
  function topPicks(list, scoreOf, codeOf) {
    var sorted = (list || []).filter(function (r) { return codeOf(r); }).slice().sort(function (a, b) { return scoreOf(b) - scoreOf(a); });
    var picks = sorted.filter(function (r) { return scoreOf(r) >= PICK_MIN; }).slice(0, PICK_MAX);
    if (!picks.length && sorted[0] && scoreOf(sorted[0]) >= PICK_FLOOR) picks = [sorted[0]];
    return picks;
  }
  /* 교과목 NCS 저장 형식 */
  function unitEntry(n) {
    return { code: n.code, name: n.name, level: n.level, subd: n.subd, path: n.path, objectives: n.objectives || [], reason: n.reason || "",
      score: n.score != null ? n.score : n.match, cross: !!n.cross };
  }

  /* 교과목(단원) ↔ 능력단위 자동 배정 — 확정한 선택이 있으면 건드리지 않는다 */
  function assignUnit(course, unit, onLabel) {
    if ((unit.ncs || []).length && !unit.ncsAuto) return Promise.resolve(false);
    unit.ncsAutoTried = true;
    return AI().recommendNcs(course, unit, onLabel).then(function (list) {
      unit.ncsDraft = list;
      var picks = topPicks(list, function (r) { return +r.score || 0; }, function (r) { return r.code; });
      unit.ncs = picks.map(unitEntry);
      unit.ncsAuto = picks.length > 0;
      return unit.ncsAuto;
    });
  }
  function assignUnits(course, prog) {
    var units = course.units || [], ok = 0, fail = 0, chain = Promise.resolve();
    var p = typeof prog === "function" ? prog : function () {};
    units.forEach(function (u, i) {
      chain = chain.then(function () {
        var head = "NCS 능력단위 자동 배정 " + (i + 1) + "/" + units.length + " · " + u.title;
        p(i, units.length, head);
        return assignUnit(course, u, function (l) { p(i, units.length, head + " — " + l); })
          .then(function (did) { if (did) ok++; })
          .catch(function (e) { if (isCancel(e)) throw e; fail++; });
      });
    });
    return chain.then(function () { p(units.length, units.length, "NCS 자동 배정 완료"); return { ok: ok, fail: fail }; });
  }

  /* 학습모듈 ↔ 능력단위요소 자동 배정 */
  function assignModule(course, unit, m) {
    if (!(m.objectives || []).length || ((m.ncs.chosen || []).length && !m.ncs.auto)) return Promise.resolve(false);
    m.ncs.autoTried = true;
    return AI().recommendElements(course, unit, m).then(function (res) {
      m.ncs.recs = res.recs; m.ncs.note = res.note; m.ncs.at = Date.now();
      var picks = topPicks(res.recs, function (r) { return +r.fit || 0; }, function (r) { return r.elementCode || r.unitCode; });
      m.ncs.chosen = picks.map(function (r) { return r.elementCode || r.unitCode; });
      m.ncs.auto = m.ncs.chosen.length > 0;
      if (m.ncs.auto) C().logChange(m, "NCS 자동 배정 " + m.ncs.chosen.length + "개 (확정 전)");
      return m.ncs.auto;
    });
  }

  function canDraw(course) { return settings(course).art && !!K.courseArt && !!K.courseTB && !!(AI() && AI().drawSvg) && !!(K.ai && K.ai.available("write")); }
  /* 삽화가 없는 학습내용(본문 있음) 번호 */
  function bareSections(m) {
    return K.courseTB.tbOf(m).sections.map(function (s, i) { return String(s.body || "").trim() && !(m.ills || []).some(function (il) { return il.placement === i; }) ? i : -1; })
      .filter(function (i) { return i !== -1; });
  }

  /* 학습내용마다 삽화 하나 — 이미 배치한 삽화가 있는 학습내용은 건너뛴다. 다 돌면 m.autoArtDone 표시(기존 교재 보강을 한 번만) */
  function illustrate(course, unit, m, onLabel) {
    if (!canDraw(course)) return Promise.resolve(0);
    var label = typeof onLabel === "function" ? onLabel : function () {};
    var tb = K.courseTB.tbOf(m);
    var todo = tb.sections.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) {
      return String(x.s.body || "").trim() && !(m.ills || []).some(function (il) { return il.placement === x.i; });
    });
    var made = 0, chain = Promise.resolve();
    todo.forEach(function (x, k) {
      chain = chain.then(function () {
        var A = course.art || K.courseArt.DEFAULT_ART;
        var idea = (m.ideas || []).filter(function (d) { return d.section === x.i; })[0];
        var topic = x.s.title || m.objectives[x.i] || m.title;
        var desc = idea ? idea.description : "「" + topic + "」의 핵심 개념을 한눈에 보여 주는 개념도. 핵심 요소를 단순한 도형으로 나누고 관계를 화살표로 잇는다.";
        var context = topic + ": " + (K.courseRules ? K.courseRules.plain(x.s.body) : x.s.body).replace(/\s+/g, " ").slice(0, 800);
        label("삽화 자동 생성 " + (k + 1) + "/" + todo.length + " · " + topic);
        return AI().drawSvg(A, A.anchorSvg, { kind: "개념도", desc: desc, context: context }, "640 360").then(function (raw) {
          var svg = K.courseArt.snapPalette(K.courseArt.sanitizeSvg(raw), A.palette);
          var ill = { id: C().uid("ill"), title: String(topic).slice(0, 40), kind: "개념도", prompt: desc, svg: svg, caption: x.s.title || "", placement: x.i, at: Date.now(), auto: true };
          m.ills = (m.ills || []).concat([ill]);
          if (!A.anchorSvg) course.art = Object.assign(JSON.parse(JSON.stringify(A)), { anchorId: ill.id, anchorSvg: svg });
          made++;
        }).catch(function (e) { if (isCancel(e)) throw e; }); // 한 장 실패는 건너뛴다
      });
    });
    return chain.then(function () {
      m.autoArtDone = true;
      if (made) C().logChange(m, "삽화 자동 생성 " + made + "개 (학습내용에 배치)");
      return made;
    });
  }

  /* 교안 본문 이미지 — 실패해도 교재 작성은 이어 간다 */
  function photos(course, unit, m, label) {
    if (!K.lessonImages || !K.lessonImages.enabled()) return Promise.resolve(0);
    return K.lessonImages.generate(course, unit, m, label).then(function (r) { return (r.made || 0) + (r.replaced || 0); }, function (e) { if (isCancel(e)) throw e; return 0; });
  }
  function needsPhotos(m) { return !!(K.lessonImages && K.lessonImages.needs(m)); }

  /* 교재를 쓴 직후: 삽화 자동 생성 → 교안 본문 이미지 → 능력단위요소 자동 배정 */
  function afterTextbook(course, unit, m, onLabel) {
    var out = { ills: 0, photos: 0, ncs: false };
    var label = typeof onLabel === "function" ? onLabel : function () {};
    return illustrate(course, unit, m, label).then(function (n) {
      out.ills = n;
      return photos(course, unit, m, label);
    }).then(function (n) {
      out.photos = n;
      label("NCS 능력단위요소 자동 배정 · " + m.title);
      return assignModule(course, unit, m).catch(function (e) { if (isCancel(e)) throw e; return false; });
    }).then(function (did) { out.ncs = did; return out; });
  }

  /* ---------- 기존에 써 둔 교재 보강 (새 기능을 예전 내용에도) ----------
     교재가 있는 학습모듈: 아직 자동 삽화를 돌려 본 적 없으면 삽화, 능력단위요소를 배정해 본 적 없으면 NCS — 학습모듈마다 한 번만 */
  function needsArt(course, m) { return canDraw(course) && !m.autoArtDone && bareSections(m).length > 0; }
  function needsNcs(m) { return (m.objectives || []).length > 0 && !(m.ncs.chosen || []).length && !m.ncs.autoTried; }
  function needsFill(course, m) { return !!(K.courseAI && K.courseAI.hasTextbook(m)) && (needsArt(course, m) || needsPhotos(m) || needsNcs(m)); }
  function needsUnitNcs(u) { return !(u.ncs || []).length && !u.ncsAutoTried; }
  function fillModule(course, unit, m, onLabel) {
    var out = { ills: 0, photos: 0, ncs: false };
    var label = typeof onLabel === "function" ? onLabel : function () {};
    return (needsArt(course, m) ? illustrate(course, unit, m, label) : Promise.resolve(0)).then(function (n) {
      out.ills = n;
      return needsPhotos(m) ? photos(course, unit, m, label) : 0;
    }).then(function (n) {
      out.photos = n;
      if (!needsNcs(m)) return false;
      label("NCS 능력단위요소 자동 배정 · " + m.title);
      return assignModule(course, unit, m).catch(function (e) { if (isCancel(e)) throw e; return false; });
    }).then(function (did) { out.ncs = did; return out; });
  }
  /* 과정 전체의 기존 내용 보강 대상 — {modules:[{unit, module}], units:[unit]} */
  function existingWork(course) {
    var mods = [], units = [];
    (course.units || []).forEach(function (u) {
      if (needsUnitNcs(u)) units.push(u);
      (u.modules || []).forEach(function (m) { if (needsFill(course, m)) mods.push({ unit: u, module: m }); });
    });
    return { modules: mods, units: units };
  }
  /* 기존 내용 보강 실행 — 단원 NCS → 학습모듈 삽화·NCS → 조립해 둔 산출물 다시 조립. onModule() 은 학습모듈마다(저장) */
  function applyExisting(course, prog, onModule) {
    var p = typeof prog === "function" ? prog : function () {};
    var w = existingWork(course), total = w.units.length + w.modules.length, k = 0, fail = 0, chain = Promise.resolve();
    var touched = [];
    var mark = function (u) { if (touched.indexOf(u) === -1) touched.push(u); };
    w.units.forEach(function (u) {
      chain = chain.then(function () {
        p(k++, total, "기존 내용 보강 · NCS 능력단위 자동 배정 · " + u.title);
        return assignUnit(course, u, function (l) { p(k, total, "기존 내용 보강 · " + u.title + " — " + l); })
          .then(function () { mark(u); }, function (e) { if (isCancel(e)) throw e; fail++; });
      });
    });
    w.modules.forEach(function (x) {
      chain = chain.then(function () {
        var head = "기존 내용 보강 " + (k + 1) + "/" + total + " · " + x.module.title;
        p(k++, total, head);
        return fillModule(course, x.unit, x.module, function (l) { p(k, total, head + " — " + l); })
          .then(function () { mark(x.unit); if (onModule) onModule(x.module); }, function (e) { if (isCancel(e)) throw e; fail++; });
      });
    });
    return chain.then(function () {
      touched.forEach(function (u) { if (u.outputs && K.courseAI) K.courseAI.buildOutputs(course, u); });
      p(total, total, "기존 내용 보강 완료");
      return { modules: w.modules.length, units: w.units.length, fail: fail };
    });
  }

  K.courseAuto = { settings: settings, topPicks: topPicks, unitEntry: unitEntry, assignUnit: assignUnit, assignUnits: assignUnits,
    assignModule: assignModule, illustrate: illustrate, afterTextbook: afterTextbook, isCancel: isCancel,
    needsFill: needsFill, needsPhotos: needsPhotos, needsUnitNcs: needsUnitNcs, fillModule: fillModule, existingWork: existingWork, applyExisting: applyExisting };
})();
