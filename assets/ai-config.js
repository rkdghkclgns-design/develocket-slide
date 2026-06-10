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
  model: "gemini-2.5-pro"
};
