/* course-outputs.js — 과정 설계 ④ 산출물 화면 (그리기만 · 동작은 course-ui.js)
 *   단원: 차시 구성 표 · 교안 작성(남은 블록만 / 다시) · 자동 생성 설정 · 교수안/교재/편성안 내려받기 · 검토 후 빌드
 *   과정 전체: 모든 단원 교안 작성(남은 블록) · 조립된 단원 모두 빌드 · 과정 설계서·전체 교재·전체 문제은행 */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var C = K.course;
  function U() { return K.cui; }
  function esc(s) { return U().esc(s); }
  function aiReady(role) { return U().aiReady(role); }

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
    var done = u.modules.filter(K.courseAI.moduleDone).length;
    var qn = u.modules.reduce(function (a, m) { return a + m.questions.length; }, 0);
    var ills = u.modules.reduce(function (a, m) { return a + (m.ills || []).filter(function (x) { return x.placement != null; }).length; }, 0);
    var sess = sessionRows(u, o);
    var course = U().S.course, rest = K.courseAI.remainingModules(course).length, allN = C.allModules(course).length;
    var ex = K.courseAuto ? K.courseAuto.existingWork(course) : { modules: [], units: [] }, extra = ex.modules.length + ex.units.length;
    var card = function (icon, title, desc, key, file, btn) {
      return '<div class="cs-out"><div class="cs-out-ic">' + icon + '</div><div class="cs-out-main"><b>' + title + "</b><p>" + desc + "</p></div>" +
        '<button class="btn btn-ghost" data-act="dl-out" data-k="' + key + '" data-file="' + esc(file) + '"' + (o ? "" : " disabled") + ">⤓ " + (btn || "MD") + "</button></div>";
    };
    return '<div class="cs-card"><div class="cs-card-head"><h3>산출물 — 단원 ' + (U().S.unit + 1) + ". " + esc(u.title) + " (" + u.hours + "시간 · " + sess.n + "차시)</h3></div>" +
      '<p class="cs-sub">' + (o ? "조립일 " + esc(o.generatedAt) + " · " : "아직 조립 전입니다. · ") + "교재 작성 블록 " + written + "/" + u.modules.length + " · NCS " + (u.ncs || []).length + "개 · 문항 " + qn + "개 · 배치한 삽화 " + ills + "개" +
      (lintN ? ' · <span class="cs-warn">교재 검수 ' + lintN + "건</span>" : "") + "</p>" +
      '<div class="cs-actions">' + (done && done < u.modules.length
        ? '<button class="btn btn-primary" data-act="gen-unit-rest"' + (aiReady("write") ? "" : " disabled") + ">📝 남은 블록 " + (u.modules.length - done) + "개 작성</button>" +
          '<button class="btn btn-ghost" data-act="gen-unit"' + (aiReady("write") ? "" : " disabled") + ">모든 블록 다시 작성</button>"
        : '<button class="btn btn-primary" data-act="gen-unit"' + (aiReady("write") ? "" : " disabled") + ">📝 " + (done ? "AI로 교수안·슬라이드 다시 작성" : "AI로 교안 작성") + "</button>") +
      '<button class="btn btn-ghost" data-act="assemble">↻ 현재 내용으로 조립' + (written ? "" : "(템플릿)") + "</button></div>" +
      sess.html +
      '<div class="cs-autobar"><b>자동 생성</b>' +
      '<label class="cs-check"><input type="checkbox" data-act="auto-art"' + (K.courseAuto && K.courseAuto.settings(course).art ? " checked" : "") + '> 교재 학습내용마다 삽화(SVG) 그려 넣기</label>' +
      '<label class="cs-check">🖼 빌드할 때 슬라이드 이미지 <select data-auto-img></select></label>' +
      '<span class="cs-muted">삽화는 글 AI가 SVG로, 슬라이드 이미지는 Google 키(Gemini)로 만들어 참고 이미지와 슬라이드 칸에 넣습니다.</span></div>' +
      card("📖", "교수안 — 차시별 " + sess.n + "개", "차시마다 기존 교수안 형식 — 도입 / 전개 N / 정리, 단계 제목에 소요 시간, 수업 흐름 표. 블록 도입·정리로 시작하거나 끝나지 않는 차시에는 5분 연결 단계를 넣습니다.", "doc", "교수안 - " + u.title + " (차시별).md", "전체 차시 MD") +
      card("📘", "교안(교재).md — 기존 교안 양식", "학습자용 — 블록마다 # 개요(학습 목표·학습 개요) → # 학습내용(## 소주제 + 글머리 문장, 삽화) → ✅ 체크리스트 → ❗오늘의 퀘스트(제출 파일명). 차시별 빌드에는 그 차시에 걸친 블록만 붙습니다.", "text", "교재 - " + u.title + ".md") +
      card("🎬", "슬라이드 편성안 — 차시별 " + sess.n + "개", "기존 편성안 형식 — 차시마다 표지·목차·마무리, 블록 슬라이드는 블록이 걸친 차시에 시간 비율대로 나눕니다.", "deck", "슬라이드 편성안 - " + u.title + " (차시별).md", "전체 차시 MD") +
      '<div class="cs-actions"><button class="btn btn-primary" data-act="open-review"' + (o ? "" : " disabled") + ">🎬 검토 후 슬라이드·문서로 빌드 (" + sess.n + "개 차시 · 드롭다운으로 이동) →</button>" +
      '<button class="btn btn-ghost" data-act="dl-qcsv"' + (qn ? "" : " disabled") + ">⤓ 이 단원 문제은행 CSV</button></div></div>" +
      '<div class="cs-card"><div class="cs-card-head"><h3>과정 전체</h3><span class="cs-muted">교안 완료 ' + (allN - rest) + "/" + allN + '개 블록</span></div><div class="cs-actions">' +
      '<button class="btn btn-primary" data-act="gen-course"' + (aiReady("write") && (rest || extra) ? "" : " disabled") + ">📝 모든 단원 교안 작성 (남은 블록 " + rest + "개" + (extra ? " · 기존 보강 " + extra + "건" : "") + ")</button>" +
      '<button class="btn btn-primary" data-act="open-review-all"' + (course.units.some(function (x) { return x.outputs; }) ? "" : " disabled") +
      '>🎬 조립된 단원 모두 빌드 (단원·차시 드롭다운으로 이동)</button>' +
      '<button class="btn btn-ghost" data-act="dl-course">⤓ 과정 설계서.md (단원·블록 시간표)</button>' +
      '<button class="btn btn-ghost" data-act="dl-all-text">⤓ 전체 교재.md</button>' +
      '<button class="btn btn-ghost" data-act="dl-all-qcsv">⤓ 전체 문제은행 CSV</button></div>' +
      '<p class="cs-foot">출제 이력·회차 결과·오답률 집계는 LMS에서 관리합니다(이 도구는 문항 자체만 만듭니다).</p></div>';
  }

  K.courseOutputs = { render: renderOutputs };
})();
