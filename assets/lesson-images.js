/* lesson-images.js — 교안(교재) 본문 이미지
 *   기존 교안 양식처럼 소제목(##) 바로 아래에 그 내용을 보여 주는 그림을 넣는다.
 *   학습내용마다 내용이 가장 많은 소제목 하나(소제목이 4개 이상이면 둘)를 골라, 과정·블록·학습내용 이름과
 *   그 소제목의 글머리 문장으로 프롬프트를 만든다(내용과 상관없는 그림이 나오지 않게).
 *   m.photos = [{id, sec, sub, title, points, prompt, at, auto}] — 그림은 auto-images 보관소(IndexedDB)에,
 *   교안 MD 에는 [이미지:id] 줄로 들어간다(course-model placePhotos). 이미지 자동 생성이 '끔'이거나 Google 키가 없으면 만들지 않는다.
 *   K.lessonImages = { targets, missing, needs, generate, remove, redo, forSession, gc } */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var C = function () { return K.course; };
  var A = function () { return K.autoImages; };

  function isCancel(e) { return !!(e && (e.code === "cancelled" || e.name === "AbortError")); }
  function aborted() { return !!(K.courseAI && K.courseAI.callAborted && K.courseAI.callAborted()); }
  function enabled() { return !!(A() && A().enabled() && K.recommendImagePrompt); }
  function sectionsOf(m) { return (m.content && m.content.sections) || []; }

  /* 학습내용 본문 → 소제목 묶음 [{sub, points}] (소제목 앞 글머리는 이름 없는 묶음) */
  function subtopics(body) {
    var groups = [], cur = null;
    var lines = String(C().lessonBody(body) || "").split("\n"), fz = C().fenced(lines);
    lines.forEach(function (line, i) {
      if (fz[i]) return; // 코드 블록 속 '## …'·'- …' 는 소제목·글머리가 아니다
      var h = line.match(/^##\s+(.*)$/);
      if (h) { cur = { sub: h[1].trim(), points: [] }; groups.push(cur); return; }
      var b = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
      if (!b) return;
      if (!cur) { cur = { sub: "", points: [] }; groups.push(cur); }
      cur.points.push(b[1].replace(/\*\*|`/g, "").trim());
    });
    return groups.filter(function (g) { return g.sub || g.points.length; });
  }

  /* 그림을 넣을 자리 — [{sec, sub, title, points, secTitle}] */
  function targets(m) {
    var out = [];
    sectionsOf(m).forEach(function (s, i) {
      if (!String(s.body || "").trim()) return;
      var groups = subtopics(s.body), want = groups.length >= 4 ? 2 : 1;
      groups.map(function (g, k) { return { g: g, k: k }; })
        .sort(function (a, b) { return b.g.points.length - a.g.points.length || a.k - b.k; })
        .slice(0, want).sort(function (a, b) { return a.k - b.k; })
        .forEach(function (x) {
          out.push({ sec: i, sub: x.g.sub, title: x.g.sub || s.title || (m.objectives || [])[i] || m.title, points: x.g.points.slice(0, 5), secTitle: s.title || "" });
        });
    });
    return out;
  }
  /* 아직 그림이 없는 자리 — 학습내용마다 원하는 수만큼 이미 있으면(소제목 이름이 바뀐 경우 등) 더 만들지 않는다 */
  function missing(m) {
    var photos = m.photos || [], all = targets(m), out = [];
    var secs = all.map(function (t) { return t.sec; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    secs.forEach(function (sec) {
      var want = all.filter(function (t) { return t.sec === sec; }), have = photos.filter(function (p) { return p.sec === sec; });
      var room = want.length - have.length;
      want.filter(function (t) { return !have.some(function (p) { return p.sub === t.sub; }); }).slice(0, Math.max(0, room)).forEach(function (t) { out.push(t); });
    });
    return out;
  }
  function needs(m) {
    return enabled() && !m.autoPhotoDone && !!(K.courseAI && K.courseAI.hasTextbook && K.courseAI.hasTextbook(m)) && missing(m).length > 0;
  }
  function promptFor(course, m, t) {
    return K.recommendImagePrompt({ title: t.title, subject: [course.title, m.title, t.secTitle !== t.title ? t.secTitle : ""].filter(Boolean).join(" › "), points: t.points });
  }
  function photoOf(t, id, prompt) {
    return { id: id, sec: t.sec, sub: t.sub, title: String(t.title).slice(0, 60), points: t.points, prompt: prompt, at: Date.now(), auto: true };
  }

  /* 빠진 자리에 그림을 만든다 — 연달아 두 번 실패하면(키·할당량) 멈춘다.
     한 번 돌면(실패로 멈춰도) m.autoPhotoDone — 자동 보강은 블록마다 한 번만, 다시 하려면 교재 탭 「빈 소제목에 이미지 만들기」.
     사용자가 중지한 경우만 표시하지 않아 다음에 이어 간다 */
  function generate(course, unit, m, onLabel, cancelled) {
    if (!enabled()) return Promise.resolve({ made: 0, failed: 0, stopped: false, skipped: true });
    var label = typeof onLabel === "function" ? onLabel : function () {};
    var stopNow = function () { return aborted() || !!(cancelled && cancelled()); };
    var todo = missing(m), made = 0, failed = 0, inRow = 0, stop = false, chain = Promise.resolve();
    todo.forEach(function (t, k) {
      chain = chain.then(function () {
        if (stop || stopNow()) return;
        label("교안 본문 이미지 " + (k + 1) + "/" + todo.length + " · " + t.title);
        var prompt = promptFor(course, m, t);
        return A().genOne(prompt, t.title, true).then(function (id) {
          m.photos = (m.photos || []).concat([photoOf(t, id, prompt)]);
          made++; inRow = 0;
        }).catch(function (e) {
          if (isCancel(e)) throw e;
          failed++; inRow++;
          if (inRow >= 2) stop = true;
        });
      });
    });
    return chain.then(function () {
      if (!stopNow()) m.autoPhotoDone = true;
      if (made) C().logChange(m, "교안 본문 이미지 " + made + "장 (소제목 아래)");
      return { made: made, failed: failed, stopped: stop };
    });
  }

  /* 보관소 정리 — 과정(휴지통 포함)의 어느 블록도 쓰지 않는 교안 그림을 지운다.
     같은 그림을 두 블록이 함께 쓸 수 있어(같은 프롬프트) 그림을 바로 지우지 않고 여기서 확인한다. 과정을 저장할 때마다 부른다 */
  function gc(course) {
    if (!A() || !A().releasePinned || !course) return;
    var keep = [];
    var add = function (m) { (m && m.photos || []).forEach(function (p) { keep.push(p.id); }); };
    (course.units || []).forEach(function (u) { (u.modules || []).forEach(add); });
    (course.trash || []).forEach(function (t) { add(t.module); });
    A().releasePinned(keep);
  }
  /* 그림 하나 빼기 (다른 블록이 쓰지 않으면 보관소에서도 지움). 같은 자리는 자동으로 다시 만들지 않는다(직접 「다시」를 누를 때만) */
  function remove(course, m, id) {
    var p = (m.photos || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return false;
    m.photos = m.photos.filter(function (x) { return x.id !== id; });
    m.autoPhotoDone = true;
    C().logChange(m, "교안 본문 이미지 빼기: " + p.title);
    gc(course);
    return true;
  }
  /* 같은 자리에 새 그림 — 지금 본문 내용으로 프롬프트를 다시 만든다 */
  function redo(course, unit, m, id) {
    var old = (m.photos || []).filter(function (x) { return x.id === id; })[0];
    if (!old || !enabled()) return Promise.resolve(false);
    var t = targets(m).filter(function (x) { return x.sec === old.sec && x.sub === old.sub; })[0] ||
      { sec: old.sec, sub: old.sub, title: old.title, points: old.points || [], secTitle: "" };
    var prompt = promptFor(course, m, t);
    return A().genOne(prompt, t.title, true, true).then(function (nid) {
      m.photos = (m.photos || []).map(function (x) { return x.id === id ? photoOf(t, nid, prompt) : x; });
      C().logChange(m, "교안 본문 이미지 다시 만들기: " + t.title);
      gc(course);
      return true;
    });
  }

  /* 차시에 걸친 블록들의 본문 이미지 — 슬라이드가 내용이 같으면 새로 만들지 않고 이 그림을 쓴다 (auto-images part.images)
     s.mods 는 조립해 둔 산출물이면 블록 id, 계산 중인 차시면 블록 번호 */
  function forSession(unit, s) {
    var out = [], mods = s.mods || [];
    (unit.modules || []).forEach(function (m, mi) {
      if (mods.indexOf(m.id) === -1 && mods.indexOf(mi) === -1) return;
      (m.photos || []).forEach(function (p) { out.push({ id: p.id, title: p.title, text: (p.points || []).join(" ") }); });
    });
    return out;
  }

  K.lessonImages = { enabled: enabled, subtopics: subtopics, targets: targets, missing: missing, needs: needs, generate: generate, gc: gc,
    remove: remove, redo: redo, forSession: forSession };
})();
