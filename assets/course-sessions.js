/* course-sessions.js — 차시(1차시 = 1시간) 분할과 차시별 산출물
 *   단원의 진행 단계(학습모듈 → 도입·전개·정리)를 60분마다 잘라 차시마다 교수안·슬라이드 편성안을 만든다.
 *   K.course 에 덧붙인다: unitSessions · sessionSteps · sessionTitle · sessionPlanMd · sessionDeckMd ·
 *   assembleOutputs · sessionTextMd · sessionsDocMd · sessionsDeckMd · sessionTableLines
 *   K.course.ensureCourse 를 감싸, 예전(단원 한 덩어리)으로 조립해 둔 산출물을 불러올 때 차시별로 다시 조립한다. */
(function () {
  "use strict";
  var K = (window.KBuilder = window.KBuilder || {});
  var C = K.course;
  if (!C) return;
  var MIN_PER_HOUR = C.MIN_PER_HOUR, fmtMin = C.fmtMin, todayStr = C.todayStr, ncsLine = C.ncsLine;
  var textbookMd = C.textbookMd, textbookModuleMd = C.textbookModuleMd;

  /* 단원의 진행 단계를 시간 순서로 이어 붙여 60분마다 자른다.
   * 한 단계가 차시 경계에 걸치면 앞부분(다음 차시에 계속)과 이어지는 부분(이어서)으로 나눈다.
   * 블록 설계 자체는 바꾸지 않는다 — 차시는 산출물(교수안·슬라이드)을 나누는 단위다. */
  var FRAME_MIN = 5; // 차시 앞뒤 연결(도입·정리) 시간
  function unitSessions(unit) {
    var sessions = [], cur = null;
    function open() { cur = { minutes: 0, items: [] }; sessions.push(cur); }
    open();
    (unit.modules || []).forEach(function (m, mi) {
      var flow = m.flow && m.flow.length ? m.flow : [{ phase: "전개", title: m.title, minutes: m.minutes }];
      flow.forEach(function (f, fi) {
        var left = Math.max(0, Math.round(Number(f.minutes) || 0)), part = 0;
        while (left > 0) {
          if (cur.minutes >= MIN_PER_HOUR) open();
          var take = Math.min(left, MIN_PER_HOUR - cur.minutes);
          cur.items.push({ module: mi, flow: fi, f: f, minutes: take, cont: part > 0, more: left > take });
          cur.minutes += take; left -= take; part++;
        }
      });
    });
    sessions.forEach(function (s) {
      s.mods = [];
      s.items.forEach(function (x) { if (s.mods.indexOf(x.module) === -1) s.mods.push(x.module); });
    });
    return sessions;
  }

  /* 차시 제목 — 그 차시의 전개 활동 제목(한 블록이 여러 차시에 걸쳐도 차시마다 구별되게), 전개가 없으면 블록 제목 */
  function sessionTitle(unit, s) {
    var pick = function (list) {
      list = list.filter(function (t, i, a) { return t && a.indexOf(t) === i; });
      return list.length > 2 ? list[0] + " 외 " + (list.length - 1) + "개" : list.join(" · ");
    };
    return pick(s.items.filter(function (x) { return x.f.phase === "전개"; }).map(function (x) { return String(x.f.title || "").trim(); })) ||
      pick(s.mods.map(function (mi) { return unit.modules[mi].title; })) || unit.title;
  }

  /* 차시 하나의 진행 단계 — 차시가 블록 도입으로 시작하지 않거나 블록 정리로 끝나지 않으면
     가장 긴 전개 단계에서 5분씩 덜어 차시 도입·정리를 넣는다 (차시 합계 시간은 그대로) */
  function sessionSteps(unit, s, si, n) {
    var items = s.items.map(function (x) { return Object.assign({}, x); });
    var first = items[0], last = items[items.length - 1];
    var natIntro = !!(first && first.f.phase === "도입" && !first.cont);
    var natClose = !!(last && last.f.phase === "정리" && !last.more);
    function carve() {
      var pick = function (pred) {
        return items.reduce(function (best, x) { return pred(x) && x.minutes >= 15 && (!best || x.minutes > best.minutes) ? x : best; }, null);
      };
      var best = pick(function (x) { return x.f.phase === "전개"; }) || pick(function () { return true; });
      if (!best) return false;
      best.minutes -= FRAME_MIN;
      best.trimmed = (best.trimmed || 0) + FRAME_MIN;
      return true;
    }
    var addIntro = !natIntro && items.length > 0 && carve();
    var addClose = !natClose && items.length > 0 && carve();
    var steps = [];
    if (addIntro) steps.push({ kind: "도입", synthetic: "intro", minutes: FRAME_MIN, text: si > 0 ? "이전 차시 연결과 이번 차시 목표 확인" : "이번 차시 목표 확인" });
    items.forEach(function (x, k) {
      var kind = k === 0 && natIntro ? "도입" : k === items.length - 1 && natClose ? "정리" : "전개";
      steps.push({ kind: kind, module: x.module, flow: x.flow, f: x.f, minutes: x.minutes, cont: x.cont, more: x.more, trimmed: x.trimmed || 0 });
    });
    if (addClose) steps.push({ kind: "정리", synthetic: "close", minutes: FRAME_MIN, text: si < n - 1 ? "이번 차시 핵심 정리와 다음 차시 안내" : "단원 핵심 정리" });
    var e = 0;
    steps.forEach(function (st) {
      st.label = st.kind === "전개" ? "전개 " + (++e) : st.kind;
      if (!st.synthetic) {
        var prefix = st.kind === "전개" && st.f.phase !== "전개" ? "[" + unit.modules[st.module].title + " · " + st.f.phase + "] " : "";
        st.text = prefix + st.f.title + (st.cont ? " (이어서)" : "") + (st.more ? " (다음 차시에 계속)" : "");
      }
      st.heading = st.label + " - " + st.text + " (" + fmtMin(st.minutes) + ")";
    });
    return steps;
  }

  /* 차시 도입·정리 지침 (블록 지침이 없는 연결 단계) */
  function frameGuide(st, steps, title, nextTitle, si) {
    var body = steps.filter(function (x) { return !x.synthetic; }).map(function (x) { return x.f.title; })
      .filter(function (t, i, a) { return a.indexOf(t) === i; });
    if (st.synthetic === "intro") {
      return [
        "**강사 활동**: " + (si > 0 ? "이전 차시에서 다룬 내용을 질문 한두 개로 확인하고, " : "") + "이번 차시의 목표와 진행 순서를 안내한다.",
        "**설명 내용**: 이번 차시 흐름 — " + (body.join(" → ") || title) + ".",
        "**멘트 예시**: \"" + (si > 0 ? "지난 시간에 이어서, " : "") + "이번 시간에는 「" + title + "」 내용을 다룹니다.\"",
        "**학생 활동**: " + (si > 0 ? "이전 차시의 핵심을 한 문장으로 떠올려 답한다." : "이번 차시 목표를 확인하고 궁금한 점을 메모한다.")
      ].join("\n");
    }
    return [
      "**강사 활동**: 이번 차시에서 다룬 핵심을 요약하고 " + (nextTitle ? "다음 차시에서 이어질 내용을 예고한다." : "단원 학습목표에 도달했는지 체크리스트로 확인하게 한다."),
      "**설명 내용**: 핵심 정리 — " + (body.join(" / ") || title) + ".",
      "**멘트 예시**: \"오늘은 「" + title + "」 내용을 다뤘습니다. " + (nextTitle ? "다음 시간에는 「" + nextTitle + "」 내용을 이어 갑니다." : "체크리스트로 스스로 확인해 봅시다.") + "\"",
      "**학생 활동**: 핵심을 한 문장으로 정리하고 궁금한 점을 적는다."
    ].join("\n");
  }

  function moduleEndsIn(unit, s, mi) {
    var m = unit.modules[mi];
    var lastFi = Math.max(0, ((m.flow && m.flow.length) || 1) - 1);
    return s.items.some(function (x) { return x.module === mi && x.flow === lastFi && !x.more; });
  }
  function moduleStartsIn(s, mi) {
    return s.items.some(function (x) { return x.module === mi && x.flow === 0 && !x.cont; });
  }
  function sessionFront(course, unit, title, si, n, minutes, date) {
    return ["---", "교과목: " + unit.title, "주제: " + title, "차시: " + (si + 1) + "/" + n, "소요: 1시수(약 " + minutes + "분)",
      "대상: " + (course.target || "직업훈련 수강생"), "date: " + (date || todayStr()), "status: 초안(과정 설계)", "---", ""];
  }

  /* 차시 교수안 — 기존 교수안 형식(도입 / 전개 N / 정리 + 각부 소요 시간)을 차시마다 */
  function sessionPlanMd(course, unit, sessions, si, date) {
    var s = sessions[si], n = sessions.length;
    var title = sessionTitle(unit, s);
    var nextTitle = si < n - 1 ? sessionTitle(unit, sessions[si + 1]) : "";
    var steps = sessionSteps(unit, s, si, n);
    var L = sessionFront(course, unit, title, si, n, s.minutes, date);
    L.push("# 교수안 - " + (si + 1) + "차시. " + title, "");
    L.push("## 학습 목표", "");
    var objs = [];
    s.mods.forEach(function (mi) { (unit.modules[mi].objectives || []).forEach(function (o) { if (objs.indexOf(o) === -1) objs.push(o); }); });
    objs.forEach(function (o) { L.push("- " + o); });
    if (!objs.length) L.push("- (학습모듈의 학습목표를 입력하세요)");
    var refs = (unit.ncs || []).filter(function (r) {
      return !(r.objectives && r.objectives.length) || r.objectives.some(function (x) { return s.mods.indexOf(Number(String(x).split(".")[0]) - 1) !== -1; });
    });
    L.push("", "## 개요", "", "| 항목 | 내용 |", "|---|---|");
    L.push("| 과정 | " + course.title + " |", "| 교과목 | " + unit.title + " (" + unit.hours + "시간 · " + n + "차시) |");
    L.push("| 차시 | " + (si + 1) + " / " + n + "차시 (약 " + fmtMin(s.minutes) + ") |", "| 대상 | " + (course.target || "직업훈련 수강생") + " |");
    L.push("| 학습모듈 | " + s.mods.map(function (mi) {
      var m = unit.modules[mi];
      var here = s.items.filter(function (x) { return x.module === mi; }).reduce(function (a, x) { return a + x.minutes; }, 0);
      return m.title + "(이 차시 " + fmtMin(here) + " / 블록 " + fmtMin(m.minutes) + ")";
    }).join(", ") + " |");
    L.push("| NCS 능력단위 | " + (refs.map(ncsLine).join(", ") || "-") + " |", "");
    L.push("## 수업 흐름 한눈에 보기", "", "| 단계 | 시간 | 핵심 |", "|---|---|---|");
    steps.forEach(function (st) { L.push("| " + st.label + " | " + fmtMin(st.minutes) + " | " + st.text + " |"); });
    L.push("| **합계** | **" + fmtMin(s.minutes) + "** | " + (si + 1) + "차시 |", "");
    L.push("## 진행", "");
    L.push("각 단계는 **강사 활동 → 설명 내용 → 멘트 예시 → 학생 활동** 순으로 구성한다. 괄호 안은 해당 단계의 소요 시간이다.", "");
    steps.forEach(function (st) {
      var g;
      if (st.synthetic) g = frameGuide(st, steps, title, nextTitle, si);
      else {
        var m = unit.modules[st.module];
        g = (m.content && m.content.guide && m.content.guide[st.flow]) || "**설명 내용**: " + st.f.title + "\n**학생 활동**: (활동을 입력하세요)";
        if (st.cont) g = "*앞 차시에서 시작한 활동을 이어서 진행한다.*\n" + g;
        if (st.more) g += "\n*남은 활동은 다음 차시에 이어서 진행한다.*";
      }
      L.push("### " + st.heading, "", g, "");
    });
    L.push("## 평가·체크포인트", "");
    s.mods.forEach(function (mi) {
      var m = unit.modules[mi];
      var qn = (m.questions || []).length;
      L.push("- " + m.title + ": " + (moduleEndsIn(unit, s, mi)
        ? "학습 후 체크리스트 " + (m.objectives || []).length + "항목" + (qn ? ", 문제은행 " + qn + "문항" : "")
        : "다음 차시에서 이어서 진행한다(체크리스트는 블록을 마치는 차시에 확인)."));
    });
    L.push("", "## 강사 유의사항", "");
    L.push("- 각 단계 제목 옆 시간은 계획 시간이다. 실습 진행 상황에 따라 전개 단계 안에서 조정한다.");
    if (steps.some(function (st) { return st.cont || st.more; })) L.push("- '(이어서)'·'(다음 차시에 계속)'은 한 단계가 차시 경계에 걸쳐 나뉜 것이다.");
    if (steps.some(function (st) { return st.trimmed; })) L.push("- 차시 도입·정리(각 " + FRAME_MIN + "분)를 넣기 위해 가장 긴 전개 단계에서 시간을 덜었다. 블록의 원래 시간은 ① 블록 설계에서 확인한다.");
    L.push("- 학습자용 교재는 경어체로 작성되어 있다. 교재 문장을 그대로 읽기보다 사례로 풀어 설명한다.");
    L.push("- AI가 생성한 초안이므로 강의 전 내용과 NCS 대응을 검토·보완한다.", "");
    return L.join("\n");
  }

  /* 학습모듈 슬라이드를 그 블록이 걸친 차시에 시간 비율대로 나눈다 → share[mi] = [차시 번호, …](슬라이드 블록 순서) */
  function moduleSlideBlocks(m) {
    var slides = (m.content && m.content.slides) || "";
    return slides.trim() ? slides.split(/\n(?=###\s)/).map(function (b) { return b.trim(); }).filter(Boolean) : [];
  }
  function slideShares(unit, sessions) {
    return (unit.modules || []).map(function (m, mi) {
      var blocks = moduleSlideBlocks(m);
      var per = sessions.map(function (s) { return s.items.filter(function (x) { return x.module === mi; }).reduce(function (a, x) { return a + x.minutes; }, 0); });
      var total = per.reduce(function (a, b) { return a + b; }, 0);
      return blocks.map(function (b, k) {
        var target = (k + 0.5) / blocks.length * total, acc = 0;
        for (var si = 0; si < per.length; si++) { acc += per[si]; if (per[si] && target <= acc) return si; }
        return per.length - 1;
      });
    });
  }

  function sessionSlides(course, unit, sessions, si, share, num) {
    var s = sessions[si], n = sessions.length;
    var title = sessionTitle(unit, s);
    var steps = sessionSteps(unit, s, si, n);
    var L = [];
    var head = function (t) { L.push("### 슬라이드 " + num() + " - " + t); };
    var mapOf = function (mi) { return ((steps.filter(function (st) { return st.module === mi && !st.synthetic; })[0]) || {}).label || "-"; };
    head("표지");
    L.push("- 대응 교수안: -", "- 슬라이드 문구:", "  - (제목) " + title, "  - (부제) " + unit.title + " · " + (si + 1) + "차시 / " + n + "차시",
      "- 이미지/시각: 차시 주제를 상징하는 대표 일러스트", "");
    head("목차");
    L.push("- 대응 교수안: 도입", "- 슬라이드 문구:", "  - 이번 차시 흐름");
    steps.forEach(function (st) { L.push("  - " + st.label + ". " + st.text + " (" + fmtMin(st.minutes) + ")"); });
    L.push("- 이미지/시각: 단계를 잇는 흐름 그래픽", "");
    s.mods.forEach(function (mi) {
      var m = unit.modules[mi];
      var label = mapOf(mi);
      if (moduleStartsIn(s, mi)) {
        head("학습목표: " + m.title);
        L.push("- 대응 교수안: " + label, "- 슬라이드 문구:");
        (m.objectives || []).forEach(function (o, oi) { L.push("  - " + (oi + 1) + ". " + o); });
        L.push("- 이미지/시각: 목표 체크 아이콘", "- 핵심 메시지: " + fmtMin(m.minutes) + " 동안 " + ((m.objectives || []).length || 1) + "가지를 할 수 있게 됩니다.", "");
      }
      var blocks = moduleSlideBlocks(m);
      var mine = blocks.filter(function (b, k) { return share[mi][k] === si; });
      if (mine.length) {
        mine.forEach(function (block) {
          var bl = block.split("\n");
          var t = bl[0].replace(/^###\s*/, "").replace(/^슬라이드\s*\d*\s*[-–—:.]?\s*/, "").trim();
          bl[0] = "### 슬라이드 " + num() + " - " + (t || m.title);
          if (!/대응\s*교수안/.test(block)) bl.splice(1, 0, "- 대응 교수안: " + label);
          L.push(bl.join("\n"), "");
        });
      } else {
        // 블록 슬라이드가 없거나 이웃 차시로 모두 배분됐으면, 이 차시의 전개 활동마다 한 장씩
        steps.filter(function (st) { return st.module === mi && !st.synthetic && st.f.phase === "전개" && st.minutes >= 10; }).forEach(function (st) {
          head(st.f.title + (st.cont ? " (이어서)" : ""));
          L.push("- 대응 교수안: " + st.label, "- 슬라이드 문구:", "  - " + st.f.title, "  - (" + fmtMin(st.minutes) + ")",
            "- 이미지/시각: 관련 이미지", "- 핵심 메시지: " + st.f.title, "");
        });
      }
      if (moduleEndsIn(unit, s, mi)) {
        head("체크리스트: " + m.title);
        L.push("- 대응 교수안: " + (steps[steps.length - 1] || {}).label, "- 슬라이드 문구:");
        (m.objectives || []).forEach(function (o, oi) {
          var item = m.content && m.content.checklist && m.content.checklist[oi];
          L.push("  - □ " + (item ? (item.text || item) : o));
        });
        L.push("- 이미지/시각: 체크리스트", "");
      }
    });
    head("마무리");
    L.push("- 대응 교수안: 정리", "- 슬라이드 문구:", "  - (큰 문구) " + (si + 1) + "차시 정리 — " + title,
      si < n - 1 ? "  - 다음 차시: " + sessionTitle(unit, sessions[si + 1]) : "  - 체크리스트로 스스로 확인합니다",
      "- 이미지/시각: 다음 단계로 나아가는 장면", "- 핵심 메시지: " + (si < n - 1 ? "이번 차시 핵심을 확인하고 다음 차시로 이어 갑니다." : "단원 목표를 확인하고 마무리합니다."), "");
    return L;
  }

  function sessionDeckMd(course, unit, sessions, si, share, date) {
    var s = sessions[si], title = sessionTitle(unit, s), no = 1;
    var L = sessionFront(course, unit, title, si, sessions.length, s.minutes, date);
    L.push("# 슬라이드 편성안 - " + (si + 1) + "차시. " + title, "", "## 슬라이드 편성", "");
    L = L.concat(sessionSlides(course, unit, sessions, si, share, function () { return no++; }));
    L.push("## 비고", "", "- 과정 설계에서 생성한 " + (si + 1) + "차시 초안입니다. 문구·이미지 제안을 검토해 사용하세요.", "");
    return L.join("\n");
  }

  /* 단원 산출물 조립 — 차시별 교수안·슬라이드 편성안 + 단원 교재 (조립 시점의 내용을 보관) */
  var OUTPUTS_V = 2;
  function assembleOutputs(course, unit, generatedAt) {
    var date = generatedAt || todayStr();
    var sessions = unitSessions(unit);
    var share = slideShares(unit, sessions);
    return {
      v: OUTPUTS_V,
      generatedAt: date,
      textMd: textbookMd(course, unit),
      sessions: sessions.map(function (s, si) {
        return {
          no: si + 1, title: sessionTitle(unit, s), minutes: s.minutes,
          mods: s.mods.map(function (mi) { return unit.modules[mi].id; }),
          steps: sessionSteps(unit, s, si, sessions.length).map(function (st) { return { label: st.label, text: st.text, minutes: st.minutes }; }),
          docMd: sessionPlanMd(course, unit, sessions, si, date),
          deckMd: sessionDeckMd(course, unit, sessions, si, share, date)
        };
      })
    };
  }

  /* 차시 교재: 그 차시에 걸친 학습모듈만 (지금 내용 기준) */
  function sessionTextMd(course, unit, sess) {
    var head = ["---", "과정: " + course.title, "교과목: " + unit.title, "차시: " + sess.no + "차시", "date: " + todayStr(), "status: 초안", "---", ""];
    var parts = (unit.modules || []).map(function (m, mi) { return sess.mods.indexOf(m.id) !== -1 ? textbookModuleMd(course, unit, mi) : null; }).filter(Boolean);
    return parts.length ? head.join("\n") + parts.join("\n---\n\n") : "";
  }

  function stripFront(md) { return String(md || "").replace(/^﻿?---\s*\n[\s\S]*?\n---\s*\n?/, ""); }
  function sessionsTocLines(o) {
    return ["| 차시 | 시간 | 주제 |", "|---|---|---|"].concat(o.sessions.map(function (s) { return "| " + s.no + "차시 | " + fmtMin(s.minutes) + " | " + s.title + " |"; }));
  }
  /* 차시별 교수안을 한 파일로 (내려받기용) */
  function sessionsDocMd(course, unit, o) {
    var L = ["---", "교과목: " + unit.title, "주제: " + unit.title + " (차시별 교수안)", "소요: " + unit.hours + "시수 · " + o.sessions.length + "차시",
      "대상: " + (course.target || "직업훈련 수강생"), "date: " + o.generatedAt, "status: 초안(과정 설계)", "---", "",
      "# 교수안 - " + unit.title + " (차시별)", ""].concat(sessionsTocLines(o), [""]);
    return L.join("\n") + "\n" + o.sessions.map(function (s) { return stripFront(s.docMd).trim(); }).join("\n\n---\n\n") + "\n";
  }
  /* 차시별 슬라이드 편성안을 한 파일로 — 슬라이드 번호는 '차시-번호' */
  function sessionsDeckMd(course, unit, o) {
    var L = ["---", "교과목: " + unit.title, "주제: " + unit.title + " (차시별 슬라이드)", "date: " + o.generatedAt, "status: 초안(과정 설계)", "---", "",
      "# 슬라이드 편성안 - " + unit.title + " (차시별)", ""];
    o.sessions.forEach(function (s) {
      var body = stripFront(s.deckMd);
      var a = body.search(/^##\s*슬라이드\s*편성\s*$/m), b = body.search(/^##\s*비고/m);
      body = body.slice(a === -1 ? 0 : body.indexOf("\n", a) + 1, b === -1 ? body.length : b).trim();
      L.push("## " + s.no + "차시 슬라이드 편성 — " + s.title, "", body.replace(/^### 슬라이드 (\d+) -/gm, "### 슬라이드 " + s.no + "-$1 -"), "");
    });
    L.push("## 비고", "", "- 과정 설계에서 생성한 차시별 초안입니다. 슬라이드 번호는 '차시-번호'입니다.", "");
    return L.join("\n");
  }

  /* 과정 설계서.md 의 단원별 차시 구성 표 */
  function sessionTableLines(u) {
    var ss = unitSessions(u);
    var L = ["### 차시 구성 (1차시 = 1시간)", "", "| 차시 | 시간 | 진행 단계 |", "|---|---|---|"];
    ss.forEach(function (s, si) {
      L.push("| " + (si + 1) + "차시. " + sessionTitle(u, s) + " | " + fmtMin(s.minutes) + " | " +
        sessionSteps(u, s, si, ss.length).map(function (st) { return st.label + " " + st.text + " (" + fmtMin(st.minutes) + ")"; }).join("<br>") + " |");
    });
    L.push("");
    return L;
  }

  /* 예전(단원 한 덩어리)으로 조립한 산출물은 불러올 때 차시별로 다시 조립한다 — 조립일은 그대로 */
  var baseEnsure = C.ensureCourse;
  function ensureCourse(c) {
    baseEnsure(c);
    ((c && c.units) || []).forEach(function (u) {
      if (u.outputs && u.outputs.v !== OUTPUTS_V) u.outputs = assembleOutputs(c, u, u.outputs.generatedAt);
    });
    return c;
  }

  Object.assign(C, {
    OUTPUTS_V: OUTPUTS_V, unitSessions: unitSessions, sessionSteps: sessionSteps, sessionTitle: sessionTitle,
    sessionPlanMd: sessionPlanMd, sessionDeckMd: sessionDeckMd, assembleOutputs: assembleOutputs, sessionTextMd: sessionTextMd,
    sessionsDocMd: sessionsDocMd, sessionsDeckMd: sessionsDeckMd, sessionTableLines: sessionTableLines, ensureCourse: ensureCourse
  });
})();
