// Supabase Edge Function: misar-ai
// تستخدم Google Gemini عبر السر GEMINI_API_KEY
// نشرها بـ: supabase functions deploy misar-ai
//
// وضع المؤس (mode: "founder"):
// لا يُقبل إلا إذا كان توكن المستخدم صالحاً وكان account_type = founder أو admin
// في جدول user_data. التحقق يتم على الخادم بمفتاح service role، فلا يمكن
// للمستخدم انتحال دور المؤس من المتصفح.
// ضبط السر: supabase secrets set GEMINI_API_KEY=AQ...
// @ts-ignore
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }});

/** يتحقق من أن صاحب التوكن مؤسس/مدير فعلاً (التحقق على الخادم). */
async function verifyFounderRole(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("verifyFounderRole: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return false;
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("verifyFounderRole: invalid token", userErr?.message);
      return false;
    }
    const { data: row, error: rowErr } = await admin
      .from("user_data")
      .select("account_type")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (rowErr) {
      console.error("verifyFounderRole: user_data read failed", rowErr.message);
      return false;
    }
    return row?.account_type === "founder" || row?.account_type === "admin";
  } catch (e) {
    console.error("verifyFounderRole error:", e);
    return false;
  }
}

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
    const { messages, mode } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages is required" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }

    // وضع المؤس: لا يُسمح به إلا لمؤس/مدير حقي وفقاً لجدول user_data
    if (mode === "founder" && !(await verifyFounderRole(req))) {
      return json({ error: "founder mode not allowed" }, 403);
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
