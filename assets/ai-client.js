/* ai-client.js — AI 호출 공통 계층
   역할(role)에 따라 공급자를 고른다 (라우팅 규칙은 ai-config.js 의 KBuilder.AI.route 참고).
     K.ai.call(prompt, { role, tries })  → Promise<string>
     K.ai.genImage(prompt)               → Promise<dataURL>
     K.ai.providerFor(role)              → "claude" | "gemini" | "edge" | "host" | null
   Claude 는 공식 SDK(@anthropic-ai/sdk)를 CDN 에서 처음 쓸 때 한 번만 불러온다. */
(function () {
  "use strict";

  var K = (window.KBuilder = window.KBuilder || {});
  function cfg() { return K.AI || {}; }

  /* 타임아웃 포함 fetch — 응답 지연 시 진행 화면이 무한 대기하지 않게 */
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

  /* ---------- 엣지 펑션: POST {prompt, model} → {text} ---------- */
  function callEdge(prompt) {
    var ai = cfg();
    return fetchWithTimeout(ai.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, model: ai.model })
    }, 90000).then(function (res) {
      return res.text().then(function (raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
        if (!res.ok || data.error) throw new Error(data.error || ("AI 서버 오류 (HTTP " + res.status + ")"));
        var text = data.text;
        if (text == null && data.candidates && data.candidates[0] && data.candidates[0].content) {
          text = (data.candidates[0].content.parts || []).map(function (p) { return p.text || ""; }).join("");
        }
        if (!text) throw new Error("AI 응답이 비어 있습니다.");
        return text;
      });
    });
  }

  /* ---------- Gemini (사용자 Google API 키) — 키는 헤더로만 전송 ---------- */
  function geminiParse(raw, res, emptyMsg) {
    var data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
    if (!res.ok || data.error) {
      var msg = (data.error && (data.error.message || data.error)) || ("Gemini API 오류 (HTTP " + res.status + ")");
      if (res.status === 400 && /API key/i.test(String(msg))) msg = "Google API 키가 올바르지 않습니다. 키를 확인해 주세요.";
      if (res.status === 429) msg = "Gemini API 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.";
      throw new Error(msg);
    }
    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    if (!parts.length) throw new Error(emptyMsg);
    return parts;
  }

  function geminiModelFor(role) {
    var ai = cfg();
    // 혼합 모드에서 Gemini 가 맡는 빠른 역할은 Flash 로, 그 외에는 사용자가 고른 모델로
    if (ai.isMixed && ai.isMixed() && (role === "fast" || role === "qgen")) return ai.fastModel || ai.model;
    return ai.model;
  }

  function callGemini(prompt, role) {
    var ai = cfg();
    var url = ai.apiBase + "/models/" + encodeURIComponent(geminiModelFor(role)) + ":generateContent";
    return fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ai.getKey() },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }, 120000).then(function (res) {
      return res.text().then(function (raw) {
        var parts = geminiParse(raw, res, "AI 응답이 비어 있습니다.");
        var text = parts.map(function (p) { return p.text || ""; }).join("");
        if (!text.trim()) throw new Error("AI 응답이 비어 있습니다.");
        return text;
      });
    });
  }

  /* ---------- Claude (사용자 Claude API 키 · 공식 SDK) ---------- */
  var sdkPromise = null;
  function loadClaudeSdk() {
    if (!sdkPromise) {
      sdkPromise = import(cfg().claudeSdkUrl).then(function (mod) { return mod.default || mod.Anthropic; })
        .catch(function (e) {
          sdkPromise = null;
          throw new Error("Claude SDK를 불러오지 못했어요(네트워크 확인): " + (e && e.message ? e.message : e));
        });
    }
    return sdkPromise;
  }

  /* 역할별 사고 깊이 — 빠른 역할은 low, 나머지는 medium (Opus 5.5 기본값과 동일하게 명시) */
  var CLAUDE_EFFORT = { plan: "medium", write: "medium", review: "medium", fast: "low", qgen: "low" };
  /* 서버측 거절 폴백은 Opus·Sonnet 5.5 에서만 지원(Haiku 5.5 는 미지원) */
  var FALLBACK_MODELS = { "claude-opus-5-5": true, "claude-sonnet-5-5": true };

  function claudeError(Anthropic, err) {
    if (Anthropic && err instanceof Anthropic.AuthenticationError) return new Error("Claude API 키가 올바르지 않습니다. 키를 확인해 주세요.");
    if (Anthropic && err instanceof Anthropic.PermissionDeniedError) return new Error("이 Claude API 키로는 선택한 모델을 쓸 수 없어요. 모델을 바꾸거나 키 권한을 확인해 주세요.");
    if (Anthropic && err instanceof Anthropic.RateLimitError) return new Error("Claude API 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.");
    if (Anthropic && err instanceof Anthropic.BadRequestError) return new Error("Claude API 요청 오류: " + err.message);
    if (Anthropic && err instanceof Anthropic.APIError) return new Error("Claude API 오류" + (err.status ? " (HTTP " + err.status + ")" : "") + ": " + err.message);
    return err instanceof Error ? err : new Error(String(err));
  }

  function callClaude(prompt, role) {
    var ai = cfg();
    return loadClaudeSdk().then(function (Anthropic) {
      var client = new Anthropic({ apiKey: ai.getClaudeKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
      var model = ai.claudeModel;
      var params = {
        model: model,
        max_tokens: 64000,
        output_config: { effort: CLAUDE_EFFORT[role] || "medium" },
        messages: [{ role: "user", content: prompt }]
      };
      var stream;
      if (FALLBACK_MODELS[model]) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";
        stream = client.beta.messages.stream(params);
      } else {
        stream = client.messages.stream(params);
      }
      return stream.finalMessage().then(function (msg) {
        if (msg.stop_reason === "refusal") {
          var cat = msg.stop_details && msg.stop_details.category;
          throw new Error("Claude가 이 요청을 처리하지 않았어요" + (cat ? " (" + cat + ")" : "") + ". 표현을 바꿔 다시 시도해 주세요.");
        }
        var text = (msg.content || []).filter(function (b) { return b.type === "text"; })
          .map(function (b) { return b.text; }).join("");
        if (!text.trim()) throw new Error("AI 응답이 비어 있습니다.");
        return text;
      }, function (err) { throw claudeError(Anthropic, err); });
    });
  }

  /* ---------- 공통 호출 (재시도 포함) ---------- */
  function providerFor(role) {
    var ai = cfg();
    return ai.route ? ai.route(role || "write") : null;
  }

  function callOnce(prompt, provider, role) {
    if (provider === "edge") return callEdge(prompt);
    if (provider === "gemini") return callGemini(prompt, role);
    if (provider === "claude") return callClaude(prompt, role);
    if (provider === "host") return window.claude.complete(prompt);
    return Promise.reject(new Error("AI 백엔드가 설정되지 않았습니다. 시작 화면에서 Google 또는 Claude API 키를 저장하면 사용할 수 있어요."));
  }

  /* opts.role: plan|write|fast|qgen|review — opts.provider 로 공급자를 강제할 수 있다 */
  function call(prompt, opts) {
    opts = opts || {};
    var role = opts.role || "write";
    var provider = opts.provider || providerFor(role);
    var tries = opts.tries == null ? 2 : opts.tries;
    return callOnce(prompt, provider, role).catch(function (e) {
      // 키·권한 오류는 재시도해도 같으므로 바로 알린다
      if (tries > 0 && !/키가 올바르지|권한|백엔드가 설정/.test(String(e && e.message))) {
        return new Promise(function (res) { setTimeout(res, 1200); })
          .then(function () { return call(prompt, { role: role, provider: provider, tries: tries - 1 }); });
      }
      throw e;
    });
  }

  /* ---------- 이미지 생성 (엣지 → 사용자 Google 키로 Gemini 이미지 모델) ---------- */
  function genImageEdge(prompt) {
    var ai = cfg();
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
        return data.image;
      });
    });
  }

  function genImageGemini(prompt) {
    var ai = cfg();
    var url = ai.apiBase + "/models/" + encodeURIComponent(ai.imageModel) + ":generateContent";
    return fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ai.getKey() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      })
    }, 120000).then(function (res) {
      return res.text().then(function (raw) {
        var parts = geminiParse(raw, res, "이미지 응답이 비어 있습니다.");
        for (var i = 0; i < parts.length; i++) {
          var inline = parts[i].inlineData || parts[i].inline_data;
          if (inline && inline.data) {
            return "data:" + (inline.mimeType || inline.mime_type || "image/png") + ";base64," + inline.data;
          }
        }
        throw new Error("이미지 응답이 비어 있습니다.");
      });
    });
  }

  function genImage(prompt) {
    var ai = cfg();
    if (ai.imageEndpoint) return genImageEdge(prompt);
    if (typeof ai.hasKey === "function" && ai.hasKey()) return genImageGemini(prompt);
    return Promise.reject(new Error("이미지 생성은 Google API 키가 필요해요 (Claude는 이미지를 만들지 않습니다). 시작 화면에서 Google API 키를 저장해 주세요."));
  }

  /* 응답에서 JSON 덩어리만 꺼낸다 (코드펜스·머리말 허용) */
  function parseJson(text) {
    var s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf("["), o = s.indexOf("{");
    var start = (a !== -1 && (o === -1 || a < o)) ? a : o;
    var end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
    if (start === -1 || end <= start) throw new Error("AI 응답을 해석하지 못했어요. 다시 시도해 주세요.");
    try { return JSON.parse(s.slice(start, end + 1)); }
    catch (e2) { throw new Error("AI 응답을 해석하지 못했어요. 다시 시도해 주세요."); }
  }

  K.ai = {
    call: call,
    genImage: genImage,
    providerFor: providerFor,
    parseJson: parseJson,
    available: function (role) { return !!providerFor(role || "write"); },
    providerLabel: function (p) {
      return p === "claude" ? "Claude" : p === "gemini" ? "Gemini" : p === "edge" ? "서버" : p === "host" ? "호스트 AI" : "없음";
    }
  };
  K.genImage = genImage; // 이미지 슬롯 AI 생성에서 사용 (기존 진입점 유지)
})();
