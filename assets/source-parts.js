/* source-parts.js — 과정 주제 + 하위 주제 → 부(部) 단위 원고·교수안·슬라이드
 *
 *   detectTopicList(text)   : "주제 입력: X" + 하위 주제 글머리 목록이면 {title, units} (아니면 null)
 *   writeSourceParts(...)   : 총 시간(기본 40)을 하위 주제에 나눠 부마다 원시 소스 원고를 쓰고 하나로 합친다
 *   splitParts(md)          : "# N부. 제목 (H시간)" 머리글로 나뉜 원고 → {course, parts[]} (2부 이상일 때만)
 *   generateParts(...)      : 부마다 교수안.md·슬라이드 편성안.md 생성 → 결과 화면에서 드롭다운으로 이동
 *
 * 원고 형식:
 *   # 과정: 생성형 AI와 UGC 산업의 이해
 *   # 1부. 생성형 AI의 종류 (7시간)
 *   ## 학습 목표 …
 *   ## 섹션 제목 (60분) …
 *   # 2부. LLM의 동작 원리 (7시간)
 */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});

  var COURSE_RE = /^#\s+과정\s*[:：]\s*(.+?)\s*$/;
  var PART_RES = [
    /^#\s+(?:제\s*)?(\d+)\s*부(?:\s*[.:)\-–—]\s*|\s+)(.+?)\s*$/,
    /^#\s+part\s*(\d+)(?:\s*[.:)\-–—]\s*|\s+)(.+?)\s*$/i
  ];
  var HOURS_RE = /\s*\(\s*(\d+(?:\.\d+)?)\s*시간\s*\)\s*$/;
  var BULLET_RE = /^\s*([-*•·]|\d+[.)])\s+/;

  function partLabel(p) {
    return p.no + "부. " + p.title + (p.hours ? " (" + p.hours + "시간)" : "");
  }

  /* ---------- 하위 주제 목록 감지 ----------
   * 긴 원고·메모를 잘못 나누지 않도록: 주제 줄 하나 + 나머지 줄이 모두 짧은 글머리여야 한다. */
  function detectTopicList(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n").filter(function (l) { return l.trim(); });
    if (lines.length < 3 || lines.length > 25) return null;
    var titleIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      var plain = lines[i].replace(BULLET_RE, "").trim();
      if (/^(?:과정\s*)?주제(?:\s*입력)?\s*[:：]/.test(plain)) { titleIdx = i; break; }
    }
    if (titleIdx === -1 && !BULLET_RE.test(lines[0])) titleIdx = 0;
    if (titleIdx !== 0) return null;
    var rest = lines.slice(1);
    if (!rest.every(function (l) { return BULLET_RE.test(l) && l.replace(BULLET_RE, "").trim().length <= 80; })) return null;
    var parsed = K.course && K.course.parseTopicInput ? K.course.parseTopicInput(lines.join("\n")) : null;
    var title = parsed ? parsed.title : lines[0].replace(BULLET_RE, "").replace(/^(?:과정\s*)?주제(?:\s*입력)?\s*[:：]\s*/, "").trim();
    var units = parsed ? parsed.units : rest.map(function (l) { return l.replace(BULLET_RE, "").trim(); });
    if (!title || units.length < 2) return null;
    return { title: title, units: units };
  }

  function splitHours(n, total) {
    if (K.course && K.course.allocateHours) return K.course.allocateHours(n, total);
    var base = Math.floor(total / n), extra = total - base * n;
    var out = [];
    for (var i = 0; i < n; i++) out.push(base + (i < extra ? 1 : 0));
    return out;
  }

  /* ---------- 부 단위 원고 작성 ---------- */
  function writeSourceParts(text, onProgress, opts) {
    opts = opts || {};
    var prog = typeof onProgress === "function" ? onProgress : function () {};
    var topic = detectTopicList(text);
    if (!topic) return Promise.reject(new Error("'주제 입력: …' 아래에 하위 주제를 글머리(-, *)로 2개 이상 적어 주세요."));
    if (!K.writeSource) return Promise.reject(new Error("원고 작성 모듈(generate.js)이 로드되지 않았습니다."));
    var total = Math.max(topic.units.length, Math.round(Number(opts.totalHours) || 40));
    var hours = splitHours(topic.units.length, total);
    var n = topic.units.length;
    var plan = topic.units.map(function (u, i) { return (i + 1) + "부 " + u + " (" + hours[i] + "시간)"; });
    var context = "과정: " + topic.title + " — 총 " + total + "시간, " + n + "부 구성\n" + plan.join("\n");
    var done = [];
    var chain = Promise.resolve();
    topic.units.forEach(function (unit, i) {
      chain = chain.then(function () {
        var tag = "[" + (i + 1) + "/" + n + "부 · " + unit + "] ";
        prog(i, n, tag + "개요 설계 중…");
        var brief = "과정: " + topic.title + "\n이 부의 주제: " + unit + " (" + hours[i] + "시간)\n\n[입력 원문]\n" + text;
        return K.writeSource(brief, function (d, t, label) { prog(i + (t ? d / t : 0), n, tag + (label || "")); }, {
          minutes: hours[i] * 60,
          heading: "# " + (i + 1) + "부. " + unit + " (" + hours[i] + "시간)",
          context: context
        }).then(function (md) { done.push(md); });
      });
    });
    function assemble() {
      return "# 과정: " + topic.title + "\n\n> 총 " + total + "시간 · " + n + "부 구성 — " + plan.join(" · ") + "\n\n" + done.join("\n\n");
    }
    return chain.then(function () {
      prog(n, n, "원고 조립 중…");
      return assemble();
    }, function (err) {
      // 오래 걸리는 작업이므로 끝난 부까지는 살려서 돌려준다
      var e = err instanceof Error ? err : new Error(String(err));
      if (done.length) { e.partial = assemble(); e.partialCount = done.length; }
      throw e;
    });
  }

  /* ---------- 원고 → 부 분할 ---------- */
  function splitParts(md) {
    var lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    var course = "", parts = [], cur = null, inFence = false;
    lines.forEach(function (line) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (!inFence) {
        var c = line.match(COURSE_RE);
        if (c && !parts.length) { course = c[1].trim(); return; }
        for (var r = 0; r < PART_RES.length; r++) {
          var m = line.match(PART_RES[r]);
          if (m) {
            var raw = m[2].trim();
            var hm = raw.match(HOURS_RE);
            cur = { no: Number(m[1]), title: raw.replace(HOURS_RE, "").trim(), hours: hm ? Number(hm[1]) : 0, lines: [line] };
            parts.push(cur);
            return;
          }
        }
      }
      if (cur) cur.lines.push(line);
    });
    if (parts.length < 2) return null;
    return {
      course: course,
      parts: parts.map(function (p) {
        return { no: p.no, title: p.title, hours: p.hours, label: partLabel(p), md: p.lines.join("\n").trim() };
      })
    };
  }

  /* ---------- 부마다 교수안·편성안 생성 ---------- */
  function generateParts(sourceMd, onProgress) {
    var prog = typeof onProgress === "function" ? onProgress : function () {};
    var split = splitParts(sourceMd);
    if (!split) return Promise.reject(new Error("부(# N부. 제목) 구분이 있는 원고가 아닙니다."));
    if (!K.generateFromSource) return Promise.reject(new Error("생성 모듈(generate.js)이 로드되지 않았습니다."));
    // 진행 단계 = 부마다 (머리말 1 + 섹션 수)
    var steps = split.parts.map(function (p) {
      var s = K.splitSections ? K.splitSections(p.md).sections.length : 0;
      return Math.max(1, s) + 1;
    });
    var total = steps.reduce(function (a, b) { return a + b; }, 0);
    var offset = 0;
    var out = [];
    var chain = Promise.resolve();
    split.parts.forEach(function (p, i) {
      chain = chain.then(function () {
        var tag = "[" + (i + 1) + "/" + split.parts.length + "부 · " + p.title + "] ";
        return K.generateFromSource(p.md, function (d, t, label) {
          prog(Math.min(total, offset + (d || 0)), total, tag + (label || ""));
        }, { minutes: p.hours ? p.hours * 60 : 0, course: split.course || "", topic: p.title }).then(function (r) {
          offset += steps[i];
          out.push({ no: p.no, title: p.title, hours: p.hours, label: p.label, docMd: r.docMd, deckMd: r.deckMd });
        });
      });
    });
    return chain.then(function () {
      prog(total, total, "부별 문서 조립 완료");
      return { course: split.course, parts: out };
    }, function (err) {
      var e = err instanceof Error ? err : new Error(String(err));
      if (out.length) e.partialParts = out.slice();
      throw e;
    });
  }

  K.parts = {
    detectTopicList: detectTopicList,
    writeSourceParts: writeSourceParts,
    splitParts: splitParts,
    generateParts: generateParts,
    splitHours: splitHours,
    label: partLabel
  };
})();
