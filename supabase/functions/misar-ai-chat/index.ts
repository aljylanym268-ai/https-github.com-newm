// Supabase Edge Function: misar-ai-chat
// مساعد ذكاء اصطناعي لمنصة مسار — يستقبل رسائل WhatsApp من رقم المؤس فقط،
// يقرأ بيانات المنصة (orders) ويرد على نفس رقم WhatsApp.
//
// النشر:
//   npx supabase functions deploy misar-ai-chat --no-verify-jwt
// Secrets (تُضبط في Supabase ولا تُوضع أبداً في قاعدة البيانات أو الفرونت):أ
//   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=...
//   supabase secrets set WHATSAPP_ACCESS_TOKEN=...
//   supabase secrets set WHATSAPP_APP_SECRET=...      (موصى به)
//   supabase secrets set OWNER_WHATSAPP_NUMBER=201080562909

// @ts-ignore
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GRAPH_VERSION = "v20.0";
const DEFAULT_OWNER = "201080562909";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// ============================ أدوات مساعدة ============================
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** يتحقق من توقيع Meta على الجسم الخام. */
async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret || !signatureHeader) return false;

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const providedHex = signatureHeader.slice(prefix.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    return timingSafeEqual(toHex(mac), providedHex);
  } catch (e) {
    console.error("misar-ai-chat: signature computation failed:", (e as Error).message);
    return false;
  }
}

function normalizeEgyptPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0")) {
    const local = digits.slice(1);
    if (!/^1[0125]\d{8}$/.test(local)) return null;
    return `20${local}`;
  }
  if (/^1[0125]\d{8}$/.test(digits)) return `20${digits}`;
  if (/^201[0125]\d{8}$/.test(digits)) return digits;
  return null;
}

// ============================ الإرسال ============================
async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId || !accessToken) {
    console.error("misar-ai-chat: WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN غير مضبوطة");
    return false;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body: text },
        }),
      },
    );
    if (!res.ok) {
      console.error("misar-ai-chat: send failed:", res.status, (await res.text()).slice(0, 400));
      return false;
    }
    return true;
  } catch (e) {
    console.error("misar-ai-chat: send network error:", (e as Error).message);
    return false;
  }
}

// ============================ المعالج ============================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // ===== Webhook Verification من Meta (GET) =====
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (!expected) {
      console.error("misar-ai-chat: WHATSAPP_VERIFY_TOKEN secret is not set");
      return json({ error: "Server configuration error" }, 500);
    }
    if (mode === "subscribe" && typeof verifyToken === "string" && timingSafeEqual(verifyToken, expected)) {
      return new Response(challenge ?? "", {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return json({ error: "Verification failed" }, 403);
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // الجسم الخام مطلوب للتحقق من توقيع Meta
    const rawBody = await req.text();
    const signatureOk = await verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"));

    let body: Record<string, any> = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    // إن كان السر مضبوطاً، لا نقبل إلا توقيع Meta صالحاً
    if (Deno.env.get("WHATSAPP_APP_SECRET") && !signatureOk) {
      console.warn("misar-ai-chat: rejected POST - invalid Meta signature");
      return json({ error: "Invalid signature" }, 401);
    }

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const msg: string | undefined = message?.text?.body;
    const fromRaw: string | undefined = message?.from;

    // نتجاهل أي تحديث ليس رسالة نصية (statuses / receipts ...)
    if (!msg || !fromRaw) return new Response("OK", { status: 200 });

    const from = normalizeEgyptPhone(fromRaw);
    const owner = normalizeEgyptPhone(Deno.env.get("OWNER_WHATSAPP_NUMBER") || DEFAULT_OWNER);

    // بس المؤس هو اللي يقدر يكلم المساعد الذكي
    if (!from || !owner || from !== owner) {
      console.log(`misar-ai-chat: ignored message from ${String(fromRaw)}`);
      return new Response("OK", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("misar-ai-chat: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
      return new Response("OK", { status: 200 });
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ===== هنا المساعد الذكي يبص على قاعدة بيانات مسار =====
    const text = msg.toLowerCase();
    let reply = "";

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (text.includes("طلب") && (text.includes("النهارده") || text.includes("اليوم") || text.includes("كم"))) {
      const { count } = await admin
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfToday.toISOString());
      reply =
        `يا هلا! 🔥\n` +
        `النهارده جه ${count || 0} طلب في منصة مسار.\n` +
        `عايز تفاصيل الطلبات؟ قولي "تفاصيل الطلبات"`;
    } else if (text.includes("مبيعات") || text.includes("فلوس") || text.includes("إجمالي") || text.includes("اجمالي")) {
      const { data } = await admin.from("orders").select("total_price");
      const total = (data || []).reduce((s: number, o: any) => s + (Number(o?.total_price) || 0), 0);
      reply = `إجمالي مبيعات مسار حتى الآن: ${total.toLocaleString("en-US")} جنيه 💰`;
    } else {
      reply =
        `أنا مساعد منصة مسار الذكي 🤖\n` +
        `تقدر تسألني:\n` +
        `- "كم طلب النهارده؟"\n` +
        `- "إجمالي المبيعات كام؟"\n` +
        `جرب تسألني!`;
    }

    await sendWhatsApp(from, reply);

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("misar-ai-chat error:", e);
    return new Response("OK", { status: 200 });
  }
});
