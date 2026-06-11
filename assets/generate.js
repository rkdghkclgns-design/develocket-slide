/* generate.js — 소스 원고 MD → 교수안.md + 슬라이드 편성안.md (AI 생성)
   AI 백엔드(Supabase 엣지 펑션 slide-gemini → Google Gemini, 폴백: window.claude.complete)를
   섹션 단위로 호출해 조립한다. 백엔드 설정(엔드포인트·모델)은 assets/ai-config.js 참고.
   window.KBuilder.generateFromSource(sourceMd, onProgress) → Promise<{docMd, deckMd}> */
(function () {
  "use strict";

  /* ---------- 소스 정리: HTML·머메이드·잡음 제거 ---------- */
  function cleanSource(md) {
    var s = md.replace(/\r\n/g, "\n");
    s = s.replace(/```mermaid[\s\S]*?```/g, "");      // 머메이드 다이어그램
    s = s.replace(/```[\s\S]*?```/g, "");               // 기타 코드블록
    s = s.replace(/<div class="instructor-callout">[\s\S]*?<\/div>/g, ""); // 강사 콜아웃(원고용)
    s = s.replace(/<[^>]+>/g, "");                       // 잔여 HTML 태그
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  /* ---------- 소스를 섹션 단위로 분할 (##, ### 모두 단위) ---------- */
  function splitSections(md) {
    var clean = cleanSource(md);
    var lines = clean.split("\n");
    var intro = [];
    var sections = [];
    var cur = null;
    var seenSection = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var hd = line.match(/^(#{1,3})\s+(.+?)\s*$/);
      if (hd) {
        var level = hd[1].length;
        var title = hd[2].trim();
        if (level === 1 && !seenSection && !sections.length) { intro.push(title); continue; }
        // 머리말(학습목표/개요)은 intro로
        if (!seenSection && /학습\s*목표|개요|소개|들어가며/.test(title)) { cur = null; intro.push(title); continue; }
        // ## 또는 ### 는 새 단위 시작
        seenSection = true;
        if (cur) sections.push(cur);
        cur = { title: cleanTitle(title), time: extractTime(title), text: "" };
        continue;
      }
      if (cur) cur.text += line + "\n";
      else intro.push(line);
    }
    if (cur) sections.push(cur);

    sections = sections.filter(function (s) { return s.text.trim().length > 30; }).slice(0, 30);
    return { intro: intro.join("\n").trim(), sections: sections };
  }

  function cleanTitle(t) {
    return t.replace(/\(⏱[\s\S]*$/, "")       // (⏱ 60분) 류 제거
            .replace(/[⏱️\s]*\d+\s*분\)?/g, "")
            .replace(/^\d+(\.\d+)*\.?\s*/, "")   // 앞 번호 제거
            .replace(/[()]/g, "")
            .trim() || t.trim();
  }
  function extractTime(t) {
    var m = t.match(/(\d+)\s*분/);
    return m ? parseInt(m[1], 10) : 0;
  }

  /* ---------- AI 호출 (Supabase 엣지 펑션 우선 · Claude 폴백 · 재시도 포함) ---------- */
  function backend() {
    var ai = window.KBuilder && window.KBuilder.AI;
    if (ai && ai.endpoint) return "edge";
    if (window.claude && typeof window.claude.complete === "function") return "claude";
    return null;
  }

  /* 타임아웃 포함 fetch — 엣지 지연 시 진행 화면·스피너가 무한 대기하지 않게 */
  function fetchWithTimeout(url, opts, ms) {
    if (typeof AbortController === "undefined") return fetch(url, opts);
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, ms);
    var merged = {};
    for (var k in opts) merged[k] = opts[k];
    merged.signal = ac.signal;
    return fetch(url, merged).then(
      function (res) { clearTimeout(timer); return res; },
      function (err) {
        clearTimeout(timer);
        if (err && err.name === "AbortError") throw new Error("응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.");
        throw err;
      }
    );
  }

  /* 엣지 펑션 호출: POST {prompt, model} → {text} (원시 Gemini 응답도 허용) */
  function callEdge(prompt) {
    var ai = window.KBuilder.AI;
    return fetchWithTimeout(ai.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, model: ai.model })
    }, 90000).then(function (res) {
      return res.text().then(function (raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
        if (!res.ok || data.error) {
          throw new Error(data.error || ("AI 서버 오류 (HTTP " + res.status + ")"));
        }
        var text = data.text;
        if (text == null && data.candidates && data.candidates[0] && data.candidates[0].content) {
          text = (data.candidates[0].content.parts || []).map(function (p) { return p.text || ""; }).join("");
        }
        if (!text) throw new Error("AI 응답이 비어 있습니다.");
        return text;
      });
    });
  }

  function call(prompt, tries) {
    tries = tries == null ? 2 : tries;
    var kind = backend();
    if (!kind) return Promise.reject(new Error("AI 백엔드가 설정되지 않았습니다. assets/ai-config.js를 확인하세요."));
    var p = kind === "edge" ? callEdge(prompt) : window.claude.complete(prompt);
    return p.catch(function (e) {
      if (tries > 0) {
        return new Promise(function (res) { setTimeout(res, 1200); })
          .then(function () { return call(prompt, tries - 1); });
      }
      throw e;
    });
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

  /* ---------- 메타(머리말) 생성 ---------- */
  function genMeta(intro, sections) {
    var toc = sections.map(function (s, i) { return (i + 1) + ". " + s.title; }).join("\n");
    var totalMin = sections.reduce(function (a, s) { return a + (s.time || 0); }, 0);
    var prompt =
      "당신은 직업훈련 교재 제작 전문가입니다. 아래 강의 원고를 바탕으로 교수안 머리말을 한국어로 작성하세요.\n" +
      "반드시 아래 형식만 출력하고, 다른 설명·머리말은 절대 넣지 마세요.\n\n" +
      "교과목: (원고 전체를 아우르는 과목명)\n" +
      "주제: (이 차시의 주제, 12자 내외)\n" +
      "부제: (한 줄 부제)\n" +
      "[학습목표]\n- (4~6개, 각 항목은 '~할 수 있다'로 끝남)\n" +
      "[개요]\n(2~3문장 한 문단. 이 차시가 무엇을 왜 다루는지)\n" +
      "[유의사항]\n- (강사가 유의할 점 3~4개)\n\n" +
      "[강의 제목/도입]\n" + truncate(intro, 1200) + "\n\n[목차]\n" + toc +
      (totalMin ? "\n\n(참고: 전체 약 " + totalMin + "분)" : "");
    return call(prompt).then(parseMeta);
  }

  function parseMeta(text) {
    var meta = { 교과목: "", 주제: "", 부제: "", 학습목표: [], 개요: "", 유의사항: [] };
    var section = null;
    text.split("\n").forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var kv = line.match(/^(교과목|주제|부제)\s*[:：]\s*(.*)$/);
      if (kv) { meta[kv[1]] = kv[2].trim(); section = null; return; }
      if (/^\[학습목표\]/.test(line)) { section = "학습목표"; return; }
      if (/^\[개요\]/.test(line)) { section = "개요"; return; }
      if (/^\[유의사항\]/.test(line)) { section = "유의사항"; return; }
      var b = line.match(/^[-*]\s+(.*)$/);
      if (section === "학습목표" && b) meta.학습목표.push(b[1].trim());
      else if (section === "유의사항" && b) meta.유의사항.push(b[1].trim());
      else if (section === "개요") meta.개요 += (meta.개요 ? " " : "") + line;
    });
    return meta;
  }

  /* ---------- 섹션별 교수안 블록 + 슬라이드 생성 ---------- */
  function genSection(sec, idx) {
    var prompt =
      "당신은 직업훈련 교재 제작 전문가입니다. 아래 [원고]는 한 강의 섹션입니다.\n" +
      "완전 초보 수강생 대상으로, (1) 강사용 교수안 블록과 (2) 발표 슬라이드 1~2장을 한국어로 간결하게 작성하세요.\n" +
      "반드시 아래 형식만 출력하세요. 다른 설명·머리말 금지.\n\n" +
      "@@GYOSUAN@@\n" +
      "**설명 내용**: (핵심 개념을 쉽게 푼 2~4문장)\n" +
      "**멘트 예시**: \"(강사가 학생에게 건네듯 1~2문장)\"\n" +
      "**학생 활동**: (학생이 할 한 가지, 한 문장)\n" +
      "@@SLIDES@@\n" +
      "### 슬라이드 - (슬라이드 제목)\n" +
      "- 슬라이드 문구:\n" +
      "  - (화면에 띄울 짧은 문구)\n" +
      "  - (핵심 키워드는 ' / '로 나열하거나 단계는 ' → '로 연결해도 됨)\n" +
      "- 이미지/시각: (어울리는 이미지 한 줄 제안)\n" +
      "- 핵심 메시지: (이 슬라이드의 한 줄 메시지)\n\n" +
      "[섹션 제목] " + sec.title + "\n[원고]\n" + truncate(sec.text.trim(), 2400);
    return call(prompt).then(function (text) { return parseSection(text, sec); });
  }

  function parseSection(text, sec) {
    var g = "", s = "";
    var gi = text.indexOf("@@GYOSUAN@@");
    var si = text.indexOf("@@SLIDES@@");
    if (gi !== -1 && si !== -1) {
      g = text.slice(gi + 11, si).trim();
      s = text.slice(si + 10).trim();
    } else if (si !== -1) {
      s = text.slice(si + 10).trim();
    } else {
      g = text.trim();
    }
    // 슬라이드 블록에 제목이 비면 섹션 제목으로 보강
    s = s.replace(/^###\s*슬라이드\s*[-–—:]?\s*$/gm, "### 슬라이드 - " + sec.title);
    s = s.replace(/^###\s*슬라이드\s*[-–—:]\s*/gm, "### 슬라이드 - ");
    return { title: sec.title, gyosuan: g, slides: s };
  }

  /* ---------- 조립 ---------- */
  function todayStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function assembleDoc(meta, results) {
    var L = [];
    L.push("---");
    L.push("교과목: " + (meta.교과목 || "(과목명)"));
    L.push("주제: " + (meta.주제 || "(주제)"));
    if (meta.소요) L.push("소요: " + meta.소요);
    L.push("대상: 완전 초보(직업훈련 수강생)");
    L.push("date: " + todayStr());
    L.push("status: 초안(AI 생성)");
    L.push("---");
    L.push("");
    L.push("# 교수안 - " + (meta.주제 || "신규 차시"));
    L.push("");
    L.push("## 학습 목표");
    L.push("");
    (meta.학습목표.length ? meta.학습목표 : ["이 차시의 핵심 개념을 이해하고 설명할 수 있다."]).forEach(function (g) { L.push("- " + g); });
    L.push("");
    L.push("## 개요");
    L.push("");
    L.push(meta.개요 || "이 차시는 강의 원고를 바탕으로 구성된 초안입니다.");
    L.push("");
    L.push("## 진행");
    L.push("");
    L.push("### 도입 - 오늘의 주제 열기");
    L.push("");
    L.push("**설명 내용**: 오늘 다룰 주제와 그것이 왜 중요한지 가볍게 연다. 학생의 경험과 관심을 먼저 물어 참여를 유도한다.");
    L.push("**멘트 예시**: \"오늘은 " + (meta.주제 || "이 주제") + "에 대해 함께 살펴볼 거예요. 편하게 시작해 봅시다.\"");
    L.push("**학생 활동**: 주제에 대해 떠오르는 생각을 자유롭게 말한다.");
    L.push("");
    results.forEach(function (r, i) {
      L.push("### 전개 " + (i + 1) + " - " + r.title);
      L.push("");
      L.push(r.gyosuan || "**설명 내용**: (원고 내용을 참고해 작성)");
      L.push("");
    });
    L.push("### 정리 - 오늘 배운 것 묶기");
    L.push("");
    L.push("**설명 내용**: 오늘 다룬 핵심을 한두 가지로 압축해 정리하고, 다음 차시와의 연결을 짚는다.");
    L.push("**멘트 예시**: \"오늘 핵심 한 가지만 가져간다면 무엇일까요? 그것부터 챙겨 봅시다.\"");
    L.push("**학생 활동**: 오늘 배운 것 중 가장 기억에 남는 한 가지를 적는다.");
    L.push("");
    L.push("## 강사 유의사항");
    L.push("");
    (meta.유의사항.length ? meta.유의사항 : ["완전 초보 대상이므로 용어를 외우게 하기보다 사례로 푼다.", "AI가 생성한 초안이므로 강의 전 내용을 검토·보완한다."]).forEach(function (g) { L.push("- " + g); });
    L.push("");
    return L.join("\n");
  }

  function assembleDeck(meta, results) {
    var L = [];
    L.push("---");
    L.push("교과목: " + (meta.교과목 || "(과목명)"));
    L.push("주제: " + (meta.주제 || "(주제)"));
    L.push("date: " + todayStr());
    L.push("status: 초안(AI 생성)");
    L.push("---");
    L.push("");
    L.push("# 슬라이드 편성안 - " + (meta.주제 || "신규 차시"));
    L.push("");
    L.push("## 슬라이드 편성");
    L.push("");
    var n = 1;
    // 표지
    L.push("### 슬라이드 " + (n++) + " - 표지");
    L.push("- 대응 교수안: -");
    L.push("- 슬라이드 문구:");
    L.push("  - (제목) " + (meta.주제 || "신규 차시"));
    if (meta.부제) L.push("  - (부제) " + meta.부제);
    L.push("- 이미지/시각: 강의 주제를 상징하는 대표 일러스트");
    L.push("");
    // 목차
    L.push("### 슬라이드 " + (n++) + " - 목차");
    L.push("- 대응 교수안: -");
    L.push("- 슬라이드 문구:");
    L.push("  - 오늘의 여정");
    results.forEach(function (r, i) { L.push("  - " + (i + 1) + ". " + r.title); });
    L.push("- 이미지/시각: 단계를 잇는 흐름 그래픽");
    L.push("");
    // 섹션 슬라이드
    results.forEach(function (r, i) {
      var slides = (r.slides || "").trim();
      if (!slides) {
        // 폴백 슬라이드
        slides = "### 슬라이드 - " + r.title + "\n- 슬라이드 문구:\n  - " + r.title +
          "\n- 이미지/시각: 관련 이미지\n- 핵심 메시지: " + r.title;
      }
      // 슬라이드 번호 부여 + 대응 교수안 주입
      slides.split(/\n(?=###\s)/).forEach(function (block) {
        block = block.trim();
        if (!block) return;
        var blines = block.split("\n");
        // 첫 줄(헤딩)에서 '슬라이드/번호/구분자'를 모두 벗겨 순수 제목만 추출
        var title = blines[0]
          .replace(/^###\s*/, "")
          .replace(/^슬라이드\s*/, "")
          .replace(/^\d+\s*/, "")
          .replace(/^[-–—:.]\s*/, "")
          .replace(/^\d+\s*[-–—:.]\s*/, "")
          .trim();
        blines[0] = "### 슬라이드 " + (n++) + " - " + (title || r.title);
        block = blines.join("\n");
        // 대응 교수안 줄이 없으면 추가
        if (!/대응\s*교수안/.test(block)) {
          block = block.replace(/(\n)/, "\n- 대응 교수안: 전개 " + (i + 1) + "\n");
        }
        L.push(block);
        L.push("");
      });
    });
    // 마무리
    L.push("### 슬라이드 " + (n++) + " - 마무리");
    L.push("- 대응 교수안: 정리");
    L.push("- 슬라이드 문구:");
    L.push("  - (큰 문구) 오늘의 한 걸음");
    L.push("  - 오늘 배운 핵심을 챙겨, 다음으로!");
    L.push("- 이미지/시각: 다음 단계로 나아가는 장면");
    L.push("- 핵심 메시지: 배운 것을 정리하고 이어 간다.");
    L.push("");
    L.push("## 비고");
    L.push("");
    L.push("- AI가 원고에서 생성한 초안입니다. 문구·이미지 제안을 검토해 다듬어 사용하세요.");
    L.push("");
    return L.join("\n");
  }

  /* ---------- 메인 파이프라인 ---------- */
  function generateFromSource(sourceMd, onProgress) {
    var prog = onProgress || function () {};
    var parsed = splitSections(sourceMd);
    var sections = parsed.sections;
    if (!sections.length) {
      // 섹션이 없으면 통째로 한 섹션 처리
      sections = [{ title: "본문", time: 0, text: cleanSource(sourceMd) }];
    }
    var total = sections.length + 1; // 메타 + 섹션들
    var done = 0;
    var tick = function (label) { prog(++done, total, label); };

    prog(0, total, "원고 분석 중…");
    var meta;
    return genMeta(parsed.intro, sections)
      .then(function (m) {
        meta = m;
        // 분량: 섹션 시간 합과 360분 중 큰 값 (최소 6시수 보장)
        var tm = sections.reduce(function (a, s) { return a + (s.time || 0); }, 0);
        tm = Math.max(tm, 360);
        meta.소요 = tm + "분(약 " + Math.round(tm / 60) + "시수)";
        tick("머리말 생성 완료");
        // 섹션 순차 처리 (rate limit 보호)
        var results = [];
        var chain = Promise.resolve();
        sections.forEach(function (sec, i) {
          chain = chain.then(function () {
            prog(done, total, "섹션 " + (i + 1) + "/" + sections.length + " 생성 중… (" + sec.title + ")");
            return genSection(sec, i).then(function (r) { results.push(r); tick("섹션 " + (i + 1) + " 완료"); });
          });
        });
        return chain.then(function () { return results; });
      })
      .then(function (results) {
        prog(total, total, "문서 조립 중…");
        return { docMd: assembleDoc(meta, results), deckMd: assembleDeck(meta, results), meta: meta };
      });
  }

  /* ---------- 이미지 생성 (Gemini 이미지 모델 · slide-image 엣지 펑션) ---------- */
  function genImage(prompt) {
    var ai = (window.KBuilder && window.KBuilder.AI) || {};
    if (!ai.imageEndpoint) return Promise.reject(new Error("이미지 생성 백엔드가 설정되지 않았습니다."));
    return fetchWithTimeout(ai.imageEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, model: ai.imageModel })
    }, 120000).then(function (res) {
      return res.text().then(function (raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
        if (!res.ok || data.error) throw new Error(data.error || ("이미지 서버 오류 (HTTP " + res.status + ")"));
        if (!data.image) throw new Error("이미지 응답이 비어 있습니다.");
        return data.image; // data:image/...;base64,...
      });
    });
  }

  /* ---------- 이미지 생성 추천 프롬프트 ---------- */
  /* 슬롯의 시각 제안 + 슬라이드 제목 + 강의 주제 + 일관 아트 스타일을 묶어
     바로 생성에 쓸 수 있는 한국어 프롬프트를 만든다. (image-slot _aiGen에서 프리필) */
  function recommendImagePrompt(ctx) {
    ctx = ctx || {};
    var visual = String(ctx.visual || "").trim();
    var title = String(ctx.title || "").trim();
    var subject = String(ctx.subject || "").trim();
    var core = visual || title || subject || "교육 내용을 상징하는 장면";
    var parts = [core];
    if (title && title !== core && title !== visual) parts.push("슬라이드 주제: " + title);
    else if (subject && subject !== core) parts.push("강의 주제: " + subject);
    // 슬라이드 톤과 어울리는 일관 아트 스타일 — 글자 없는 깔끔한 일러스트
    parts.push("밝고 친근한 플랫 벡터 일러스트레이션, 부드러운 파스텔 색감, 단순하고 깔끔한 배경, 글자·텍스트 없이, 고해상도 교육용 슬라이드 삽화");
    return parts.join(", ");
  }

  window.KBuilder = window.KBuilder || {};
  window.KBuilder.generateFromSource = generateFromSource;
  window.KBuilder.genImage = genImage;            // 이미지 슬롯 AI 생성에서 사용
  window.KBuilder.recommendImagePrompt = recommendImagePrompt; // 슬롯 추천 프롬프트
  window.KBuilder.splitSections = splitSections; // 디버그용
})();
