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

  /* 사용자 중지(signal)와 시간 초과를 하나의 AbortController 로 묶는다 */
  function linkedAbort(signal, ms) {
    var ac = new AbortController();
    var state = { timedOut: false };
    var timer = setTimeout(function () { state.timedOut = true; ac.abort(); }, ms);
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener("abort", function () { ac.abort(); });
    }
    return { signal: ac.signal, state: state, done: function () { clearTimeout(timer); } };
  }
  function cancelled() { var e = new Error("중지했습니다."); e.code = "cancelled"; return e; }

  /* Gemini — SSE 스트리밍으로 받아 진행(글자 수)을 알린다. 이미지는 inlineData 로 함께 보낸다 */
  function callGemini(prompt, role, opts) {
    opts = opts || {};
    var ai = cfg();
    var url = ai.apiBase + "/models/" + encodeURIComponent(geminiModelFor(role)) + ":streamGenerateContent?alt=sse";
    var parts = [{ text: prompt }].concat((opts.images || []).map(function (im) { return { inlineData: { mimeType: im.mime, data: im.data } }; }));
    var ab = linkedAbort(opts.signal, 180000);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ai.getKey() },
      body: JSON.stringify({ contents: [{ parts: parts }] }),
      signal: ab.signal
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.getReader) {
        return res.text().then(function (raw) {
          var ps = geminiParse(raw, res, "AI 응답이 비어 있습니다.");
          return ps.map(function (p) { return p.text || ""; }).join("");
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "", text = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return text;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          lines.forEach(function (line) {
            if (line.indexOf("data:") !== 0) return;
            try {
              var j = JSON.parse(line.slice(5));
              var ps = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
              ps.forEach(function (p) { if (p.text) text += p.text; });
            } catch (e) {}
          });
          if (opts.onChars) opts.onChars(text.length);
          return pump();
        });
      }
      return pump();
    }).then(function (text) {
      ab.done();
      if (!String(text).trim()) throw new Error("AI 응답이 비어 있습니다.");
      return text;
    }, function (err) {
      ab.done();
      if (err && err.name === "AbortError") throw ab.state.timedOut ? new Error("응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.") : cancelled();
      throw err;
    });
  }

  /* Blob/File → {mime, data(base64)} — 이미지 입력용 */
  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || "");
        var i = s.indexOf(",");
        resolve({ mime: blob.type || "image/png", data: s.slice(i + 1) });
      };
      fr.onerror = function () { reject(new Error("이미지 파일을 읽지 못했습니다.")); };
      fr.readAsDataURL(blob);
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

  function callClaude(prompt, role, opts) {
    opts = opts || {};
    var ai = cfg();
    return loadClaudeSdk().then(function (Anthropic) {
      var client = new Anthropic({ apiKey: ai.getClaudeKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
      var model = ai.claudeModel;
      var content = (opts.images || []).map(function (im) {
        return { type: "image", source: { type: "base64", media_type: im.mime, data: im.data } };
      }).concat([{ type: "text", text: prompt }]);
      var params = {
        model: model,
        max_tokens: 64000,
        output_config: { effort: CLAUDE_EFFORT[role] || "medium" },
        messages: [{ role: "user", content: content }]
      };
      var reqOpts = opts.signal ? { signal: opts.signal } : undefined;
      var stream;
      if (FALLBACK_MODELS[model]) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";
        stream = client.beta.messages.stream(params, reqOpts);
      } else {
        stream = client.messages.stream(params, reqOpts);
      }
      if (opts.onChars) stream.on("text", function (delta, snapshot) { opts.onChars(String(snapshot || "").length); });
      return stream.finalMessage().then(function (msg) {
        if (msg.stop_reason === "refusal") {
          var cat = msg.stop_details && msg.stop_details.category;
          throw new Error("Claude가 이 요청을 처리하지 않았어요" + (cat ? " (" + cat + ")" : "") + ". 표현을 바꿔 다시 시도해 주세요.");
        }
        var text = (msg.content || []).filter(function (b) { return b.type === "text"; })
          .map(function (b) { return b.text; }).join("");
        if (!text.trim()) throw new Error("AI 응답이 비어 있습니다.");
        return text;
      }, function (err) {
        if ((opts.signal && opts.signal.aborted) || (Anthropic && err instanceof Anthropic.APIUserAbortError)) throw cancelled();
        throw claudeError(Anthropic, err);
      });
    });
  }

  /* ---------- 공통 호출 (재시도 포함) ---------- */
  function providerFor(role) {
    var ai = cfg();
    return ai.route ? ai.route(role || "write") : null;
  }

  function callOnce(prompt, provider, role, opts) {
    if (opts && opts.images && opts.images.length && provider !== "gemini" && provider !== "claude") {
      return Promise.reject(new Error("이미지를 읽으려면 Google 또는 Claude API 키가 필요합니다."));
    }
    if (provider === "edge") return callEdge(prompt);
    if (provider === "gemini") return callGemini(prompt, role, opts);
    if (provider === "claude") return callClaude(prompt, role, opts);
    if (provider === "host") return window.claude.complete(prompt);
    return Promise.reject(new Error("AI 백엔드가 설정되지 않았습니다. 시작 화면에서 Google 또는 Claude API 키를 저장하면 사용할 수 있어요."));
  }

  /* opts.role: plan|write|fast|qgen|review — opts.provider 로 공급자를 강제할 수 있다
     opts.images: [{mime, data(base64)}] · opts.signal: 중지용 AbortSignal · opts.onChars(n): 받은 글자 수 */
  function call(prompt, opts) {
    opts = opts || {};
    var role = opts.role || "write";
    var provider = opts.provider || providerFor(role);
    var tries = opts.tries == null ? 2 : opts.tries;
    return callOnce(prompt, provider, role, opts).catch(function (e) {
      // 키·권한 오류와 사용자 중지는 재시도하지 않는다
      if (tries > 0 && !(e && e.code === "cancelled") && !(opts.signal && opts.signal.aborted) &&
          !/키가 올바르지|권한|백엔드가 설정|키가 필요/.test(String(e && e.message))) {
        return new Promise(function (res) { setTimeout(res, 1200); }).then(function () {
          var next = {};
          for (var k in opts) next[k] = opts[k];
          next.provider = provider; next.tries = tries - 1;
          return call(prompt, next);
        });
      }
      throw e;
    });
  }

  /* ---------- 이미지 생성 (엣지 → 사용자 Google 키로 Gemini 이미지 모델) ----------
     화면비는 프롬프트 글이 아니라 imageConfig 로 정한다 — 글로 '16:9'를 쓰면 정사각 캔버스에 검은 띠를 두른 그림이 나온다 */
  var IMAGE_ASPECT = "16:9";
  function genImageEdge(prompt) {
    var ai = cfg();
    return fetchWithTimeout(ai.imageEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, model: ai.imageModel, aspectRatio: IMAGE_ASPECT })
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

  var aspectUnsupported = false; // 모델이 imageConfig 를 모르면(400) 이 창에서는 빼고 보낸다
  function genImageGemini(prompt) {
    return genImageGeminiOnce(prompt, !aspectUnsupported).catch(function (e) {
      if (aspectUnsupported || !/imageConfig|aspect_?ratio|Unknown name|Invalid JSON payload/i.test(String(e && e.message))) throw e;
      aspectUnsupported = true;
      return genImageGeminiOnce(prompt, false);
    });
  }
  function genImageGeminiOnce(prompt, withAspect) {
    var ai = cfg();
    var url = ai.apiBase + "/models/" + encodeURIComponent(ai.imageModel) + ":generateContent";
    var gc = { responseModalities: ["TEXT", "IMAGE"] };
    if (withAspect) gc.imageConfig = { aspectRatio: IMAGE_ASPECT };
    return fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ai.getKey() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: gc
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
    blobToImage: blobToImage,
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
