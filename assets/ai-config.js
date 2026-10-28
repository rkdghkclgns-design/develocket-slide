/* ai-config.js — AI 생성 백엔드 설정 (Google Gemini · Anthropic Claude · 역할별 라우팅)
 *
 * 백엔드 우선순위:
 *   1) edge   — Supabase 엣지 펑션 (⛔ 현재 차단: endpoint = null)
 *   2) BYOK   — 사용자가 직접 입력한 Google API 키(Gemini) / Claude API 키
 *   3) host   — window.claude.complete 가 있는 호스트 환경의 로컬 폴백
 *
 * 🔑 API 키(BYOK)
 *   - 사용자가 화면의 키 입력칸에 직접 넣으면 이 브라우저의 localStorage 에만 저장된다.
 *     서버로 수집되지 않으며, 소스코드나 내보낸 HTML 에 포함되지 않는다.
 *   - 키는 URL 이 아니라 요청 헤더로만 전송된다 (Gemini: x-goog-api-key / Claude: x-api-key).
 *   - 발급: Google https://aistudio.google.com/apikey · Claude https://console.anthropic.com/settings/keys
 *
 * 🔀 혼합 모드 (두 키가 모두 있을 때) — 각 모델의 장점에 맞춰 역할을 나눈다.
 *   plan   구조 설계·시간 배분·NCS 판단      → Claude (지시 준수·추론)
 *   write  교재·교수안 본문(어투 규칙 준수)  → Claude (장문 한국어 품질)
 *   fast   슬라이드 문구·요약·이미지 제안      → Gemini Flash (빠르고 저렴)
 *   qgen   문제은행 문항 대량 초안            → Gemini (빠른 대량 생성)
 *   review 문항·교재 교차 검수               → Claude (생성 모델과 다른 모델이 검수)
 *   image  슬라이드 삽화                     → Gemini 이미지 (Claude 는 이미지 생성 불가)
 *   NCS 추천은 두 모델이 각자 고른 뒤 합의 여부를 '교차 검증'으로 표시한다.
 *
 * ⛔ 외부 API 차단 가드
 *   - supabase.co 로 나가는 호출은 항상 차단.
 *   - generativelanguage.googleapis.com 은 Google 키가 저장된 경우에만 허용.
 *   - api.anthropic.com 은 Claude 키가 저장된 경우에만 허용.
 */
window.KBuilder = window.KBuilder || {};
window.KBuilder.AI = {
  endpoint: null,       // ⛔ 차단 (이전: https://…supabase.co/functions/v1/slide-gemini)
  apiBase: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-2.5-pro",
  fastModel: "gemini-2.5-flash",
  models: [
    { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro · 최고 품질(느림)" },
    { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash · 빠른 균형" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite · 가장 빠름·저렴" }
  ],
  imageEndpoint: null,  // ⛔ 차단 (이전: https://…supabase.co/functions/v1/slide-image)
  imageModel: "gemini-2.5-flash-image",

  /* ---- Claude (Anthropic) ---- */
  claudeSdkUrl: "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm",
  claudeModel: "claude-opus-5-5",
  claudeModels: [
    { id: "claude-opus-5-5",   label: "Claude Opus 5.5 · 최고 품질(기본)" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 · 빠른 균형" },
    { id: "claude-haiku-5-5",  label: "Claude Haiku 5.5 · 가장 빠름·저렴" }
  ],

  /* ---- 사용자 키 (localStorage 전용, 외부 유출 없음) ---- */
  _KEY_STORE: "kb-gemini-key",
  _CLAUDE_KEY_STORE: "kb-claude-key",
  _read: function (k) {
    try { return (localStorage.getItem(k) || "").trim(); } catch (e) { return ""; }
  },
  _write: function (k, v) {
    try {
      v = String(v || "").trim();
      if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
    } catch (e) {}
  },
  getKey: function () { return this._read(this._KEY_STORE); },
  setKey: function (key) { this._write(this._KEY_STORE, key); },
  hasKey: function () { return !!this.getKey(); },
  getClaudeKey: function () { return this._read(this._CLAUDE_KEY_STORE); },
  setClaudeKey: function (key) { this._write(this._CLAUDE_KEY_STORE, key); },
  hasClaudeKey: function () { return !!this.getClaudeKey(); },

  /* ---- 역할별 라우팅 ---- */
  ROLE_LABELS: {
    plan: "구조 설계", write: "본문 작성", fast: "슬라이드·요약",
    qgen: "문항 생성", review: "교차 검수", image: "삽화 생성"
  },
  MIXED_ROUTE: { plan: "claude", write: "claude", fast: "gemini", qgen: "gemini", review: "claude", image: "gemini" },

  /* 현재 사용 가능한 공급자 목록 */
  providers: function () {
    var host = typeof window.claude === "object" && window.claude && typeof window.claude.complete === "function";
    return {
      edge: !!this.endpoint,
      gemini: this.hasKey(),
      claude: this.hasClaudeKey(),
      host: !!host
    };
  },
  isMixed: function () { var p = this.providers(); return p.gemini && p.claude; },

  /* role → "edge" | "gemini" | "claude" | "host" | null */
  route: function (role) {
    var p = this.providers();
    if (role === "image") return (this.imageEndpoint || p.gemini) ? "gemini" : null;
    if (p.edge) return "edge";
    if (p.gemini && p.claude) return this.MIXED_ROUTE[role] || "claude";
    if (p.claude) return "claude";
    if (p.gemini) return "gemini";
    if (p.host) return "host";
    return null;
  },
  anyText: function () { return !!this.route("write"); }
};

/* ── 외부 API 호출 차단 가드 ──────────────────────────────────────────
 * supabase.co 는 항상 차단. Google·Anthropic API 는 각 키가 저장됐을 때만 허용한다.
 * 폰트·라이브러리 CDN 등 정적 리소스는 허용.
 */
(function () {
  var ALWAYS_BLOCKED = ["supabase.co"];
  var KEY_GATED = [
    { host: "generativelanguage.googleapis.com", has: function (ai) { return ai.hasKey(); }, label: "Google API 키" },
    { host: "api.anthropic.com", has: function (ai) { return ai.hasClaudeKey(); }, label: "Claude API 키" }
  ];
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = "";
    try { url = typeof input === "string" ? input : (input && input.url) || String(input || ""); } catch (e) {}
    var i;
    for (i = 0; i < ALWAYS_BLOCKED.length; i++) {
      if (url.indexOf(ALWAYS_BLOCKED[i]) !== -1) {
        console.warn("[ai-config] 외부 API 호출 차단:", url);
        return Promise.reject(new Error("외부 API 호출이 차단되어 있습니다: " + url));
      }
    }
    for (i = 0; i < KEY_GATED.length; i++) {
      var g = KEY_GATED[i];
      if (url.indexOf(g.host) !== -1 && !g.has(window.KBuilder.AI)) {
        console.warn("[ai-config] " + g.label + "가 없어 호출 차단:", url);
        return Promise.reject(new Error(g.label + "가 저장되어 있지 않아 호출이 차단됐습니다. 시작 화면의 'AI 키' 칸에 키를 입력해 주세요."));
      }
    }
    return origFetch.apply(this, arguments);
  };
})();
