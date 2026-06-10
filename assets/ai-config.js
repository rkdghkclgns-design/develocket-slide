/* ai-config.js — AI 생성(소스 원고 → 교수안·편성안) 백엔드 설정
 *
 * AI 모드는 Supabase 엣지 펑션(slide-gemini)을 통해 Google Gemini를 호출한다.
 * GEMINI_API_KEY 는 엣지 펑션 시크릿(서버)에만 존재하며 이 파일/클라이언트에는 키가 없다.
 * 엣지 펑션은 verify_jwt=false + 오리진 허용목록으로 GitHub Pages 도메인만 받는다.
 *
 * 다른 백엔드로 교체하려면 endpoint(POST {prompt} → {text} 규약)만 바꾸면 된다.
 */
window.KBuilder = window.KBuilder || {};
window.KBuilder.AI = {
  endpoint: "https://pkwbqbxuujpcvndpacsc.supabase.co/functions/v1/slide-gemini",
  // 현재 선택된 모델(기본값). UI 셀렉터/localStorage로 바뀐다.
  model: "gemini-2.5-pro",
  // 선택 가능한 모델 — 여기에 추가/삭제하면 셀렉터에 바로 반영된다.
  // (Gemini 2.5 계열만 사용: 2.0-flash 등 구버전은 2026년 현재 지원 종료)
  models: [
    { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro · 최고 품질(느림)" },
    { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash · 빠른 균형" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite · 가장 빠름·저렴" }
  ]
};
