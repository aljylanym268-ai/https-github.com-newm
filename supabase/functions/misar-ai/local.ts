// تشغيل محلي لدالة misar-ai بدون Docker:
// deno run -A supabase/functions/misar-ai/local.ts
// ثم ضع المفتاح في متغير البيئة OPENAI_API_KEY
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  try {
    const { messages } = await req.json();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 700, temperature: 0.5 }),
    });
    if (!res.ok) return new Response(JSON.stringify({ error: "AI provider error" }), { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() ?? null;
    return new Response(JSON.stringify({ reply }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
