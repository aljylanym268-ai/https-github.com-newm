// Supabase Edge Function: misar-ai
// تستخدم Google Gemini عبر السر GEMINI_API_KEY
// نشرها بـ: supabase functions deploy misar-ai --no-verify-jwt
// ضبط السر: supabase secrets set GEMINI_API_KEY=AQ...
// @ts-ignore
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

  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages is required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // تحويل صيغة OpenAI إلى صيغة Gemini
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    // تجربة عدة نماذج بالترتيب حتى ينجح أحدها
    const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
    let lastErr = "";
    for (const model of MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const reply = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim() ?? null;
        return new Response(JSON.stringify({ reply }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      lastErr = await res.text();
      console.error(`Gemini error (${model}):`, lastErr);
    }
    return new Response(JSON.stringify({ error: "AI provider error", details: lastErr.slice(0, 500) }), { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("misar-ai error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
