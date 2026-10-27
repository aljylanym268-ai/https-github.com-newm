// Supabase Edge Function: misar-daily-report
// تقرير يومي لمنصة مسار — بعت الطلبات والمبيعات على WhatsApp عبر CallMeBot.
//
// النشر:
//   npx supabase functions deploy misar-daily-report --no-verify-jwt --project-ref wwojtkxwmgkrudtevbcb
// Secrets:
//   supabase secrets set CALLMEBOT_PHONE=+201080562909
//   supabase secrets set CALLMEBOT_APIKEY=...
//   supabase secrets set REPORT_CRON_SECRET=...   (إلزامي لحماية النداء الخارجي)

// @ts-ignore
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Allow": "POST" },
    });
  }

  const cronSecret = Deno.env.get("REPORT_CRON_SECRET");
  if (!cronSecret) {
    console.error("misar-daily-report: REPORT_CRON_SECRET is not configured");
    return new Response(JSON.stringify({ error: "Server authorization is not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-cron-secret") || "";
  if (!timingSafeEqual(provided, cronSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const phone = Deno.env.get("CALLMEBOT_PHONE");
  const apikey = Deno.env.get("CALLMEBOT_APIKEY");
  if (!phone || !apikey) {
    return new Response(JSON.stringify({ error: "CALLMEBOT_PHONE / CALLMEBOT_APIKEY غير مضبوطة" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // هات طلبات النهارده (بداية اليوم بتوقيت مصر +02:00)
  const now = new Date();
  const egyptNow = new Date(now.getTime() + (2 * 60 - now.getTimezoneOffset()) * 60000);
  const egyptToday = egyptNow.toISOString().split("T")[0];
  const startOfDayUtc = new Date(`${egyptToday}T00:00:00+02:00`).toISOString();

  const { data: orders, error } = await supabase
    .from("orders")
    .select("total_price")
    .gte("created_at", startOfDayUtc);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const count = orders?.length || 0;
  const total = (orders || []).reduce((s, o) => s + (Number(o.total_price) || 0), 0);

  const text = `تقرير مسار اليوم 📊\nعدد الطلبات: ${count}\nإجمالي المبيعات: ${total.toLocaleString("en-US")} جنيه`;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("misar-daily-report: callmebot failed:", res.status, (await res.text()).slice(0, 300));
      return new Response(JSON.stringify({ ok: false, error: "callmebot_failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, sent: text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("misar-daily-report: network error:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: "network_error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
});
