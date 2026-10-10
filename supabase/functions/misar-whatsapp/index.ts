// Supabase Edge Function: misar-whatsapp
// إرسال إشعارات WhatsApp للبائع عبر WhatsApp Cloud API (Official API).
//
// نشرها بـ:
//   npx supabase functions deploy misar-whatsapp --project-ref wwojtkxwmgkrudtevbcb
//
// Secrets (لا تُوضع أبداً فيFrontend):
//   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=...
//   supabase secrets set WHATSAPP_ACCESS_TOKEN=...
//   supabase secrets set WHATSAPP_BUSINESS_NAME="MISAR SYSTEMS"
//   supabase secrets set WHATSAPP_VERIFY_TOKEN=...   (Webhook Verification من Meta)
//   supabase secrets set WHATSAPP_APP_SECRET=...     (App Secret لتوقيع X-Hub-Signature-256)
//
// أمان POST:
// - verify_jwt = false لأن Meta لا ترسل Authorization header.
// - لذلك يتم قبول POST من Meta فقط عبر التحقق من X-Hub-Signature-256
//   بـ WHATSAPP_APP_SECRET، أو عبر Authorization صالح لمشارك في الطلب.

// ملاحظات مهمة:
// - لا يتم لمس جدول orders ولا أي RLS Policy قائم.
// - التحقق من الصلاحية يتم على الخادم بـ service role: لا يمكن لأي مستخدم
//   إرسال رسالة باسم بائع آخر غير مشارك في الطلب.
// - أي فشل (رقم غير صالح / خطأ من المزود / timeout) يُسجَّل ولا يُرفع كخطأ
//   أمام العميل، حتى لا يفشل إنشاء الطلب.
// - قابل للتوسع: أضف event جديد فقط إلى TEMPLATES بلا تعديل في البنية.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// ============================ الإعدادات ============================
const GRAPH_VERSION = "v21.0";
const DEFAULT_BUSINESS_NAME = "MISAR SYSTEMS";

// رسالة الطلب + الأحداث التي ستُضاف لاحقاً في ملف واحد فقط.
const TEMPLATES: Record<string, (o: OrderInfo) => string> = {
  order_created: (o) =>
    `🔔 طلب جديد على ${DEFAULT_BUSINESS_NAME}\n\n` +
    `مرحبًا ${o.sellerName} 👋\n` +
    `لديك طلب جديد.\n\n` +
    `📦 رقم الطلب: #${o.orderShort}\n` +
    `🛍️ المنتج: ${o.productName}\n` +
    `🔢 الكمية: ${o.quantity}\n` +
    `💰 الإجمالي: ${o.totalPrice} ج.م\n` +
    `📍 عنوان التسليم: ${o.shippingAddress}\n\n` +
    `يرجى الدخول إلى حسابك في MISAR لمراجعة الطلب واتخاذ الإجراء المناسب.`,

  // ----- الأحداث القادمة (تُفعّل عند ربط الاستدعاءات) -----
  order_accepted: (o) =>
    `✅ تم قبول الطلب على ${DEFAULT_BUSINESS_NAME}\n\n` +
    `مرحبًا ${o.sellerName} 👋\n` +
    `تم قبول الطلب #${o.orderShort} الخاص بالمنتج ${o.productName}.`,

  order_prepared: (o) =>
    `📦 طلبك جاهز على ${DEFAULT_BUSINESS_NAME}\n\n` +
    `الطلب #${o.orderShort} - ${o.productName} أصبح جاهزاً للاستلام.`,

  order_delivered: (o) =>
    `✅ تم تسليم الطلب على ${DEFAULT_BUSINESS_NAME}\n\n` +
    `تم تسليم الطلب #${o.orderShort}\n` +
    `🛍️ المنتج: ${o.productName}\n` +
    `💰 الإجمالي: ${o.totalPrice} ج.م\n\n` +
    `شكراً لتعاملكم مع MISAR. ل有任何 استفسار تواصلوا معنا.`,

  order_cancelled: (o) =>
    `❌ تم إلغاء الطلب على ${DEFAULT_BUSINESS_NAME}\n\n` +
    `مرحبًا ${o.sellerName} 👋\n` +
    `تم إلغاء الطلب #${o.orderShort}\n` +
    `🛍️ المنتج: ${o.productName}\n\n` +
    `لا حاجة لأي إجراء من طرفك. راجع الطلب في حسابك على MISAR للتفاصيل.`,

  return_requested: (o) =>
    `↩️ طلب إرجاع جديد على ${DEFAULT_BUSINESS_NAME}\n\n` +
    `مرحبًا ${o.sellerName} 👋\n` +
    `تم تقديم طلب إرجاع على الطلب #${o.orderShort}\n` +
    `🛍️ المنتج: ${o.productName}\n` +
    `🔢 الكمية: ${o.quantity}\n\n` +
    `يرجى الدخول إلى حسابك في MISAR لمراجعة طلب الإرجاع واتخاذ الإجراء المناسب.`,
};

// ============================ الأنواع ============================
interface OrderInfo {
  id: string;
  orderShort: string;
  sellerName: string;
  productName: string;
  quantity: number;
  totalPrice: string;
  shippingAddress: string;
}

// ============================ أدوات مساعدة ============================

/**
 * مقارنة ثابتة الزمن (constant-time) لتفادي timing attacks.
 * تُستخدم لمقارنة التوكن وتوقيع HMAC.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** يحوّل ArrayBuffer إلى نص hex صغير الأحرف. */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * يتحقق من أن الطلب صادر فعلاً من Meta عبر توقيع X-Hub-Signature-256.
 * يجب استدعاؤها على نص الجسم الخام (raw body) لا على كائن JSON.
 */
async function verifyMetaSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret) {
    console.error("misar-whatsapp: WHATSAPP_APP_SECRET secret is not set");
    return false;
  }

  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;
  const providedHex = signatureHeader.slice(expectedPrefix.length).toLowerCase();
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
    console.error("misar-whatsapp: signature computation failed:", (e as Error).message);
    return false;
  }
}

/** تطبيع الرقم المصري إلى صيغة دولية 20xxxxxxxxx بدون + أو مسافات. */
function normalizeEgyptPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;
  // إزالة رمز الدولة إن موجود
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("+20")) digits = digits.slice(1);

  if (digits.startsWith("0")) {
    const local = digits.slice(1);
    // يقبل 010 / 011 / 012 / 015  (بائع أو مشتري) - غير ذلك يُرفض
    if (!/^1[0125]\d{8}$/.test(local)) return null;
    return `20${local}`;
  }
  if (/^1[0125]\d{8}$/.test(digits)) return `20${digits}`;
  if (/^201[0125]\d{8}$/.test(digits)) return digits;
  return null;
}

function money(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** يتحقق من أن صاحب التوكن مشارك فعلي في هذا الطلب. */
async function verifyParticipant(
  admin: ReturnType<typeof createClient>,
  token: string,
  order: { buyer_id: string | null; seller_id: string | null },
): Promise<boolean> {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return false;
  const uid = data.user.id;
  return uid === order.buyer_id || uid === order.seller_id;
}

// ============================ الإرسال ============================
async function sendWhatsApp(to: string, text: string): Promise<{ ok: boolean; detail: string }> {
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId || !accessToken) {
    return { ok: false, detail: "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN غير مضبوطة" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const raw = await res.text();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${raw.slice(0, 400)}` };
    return { ok: true, detail: "sent" };
  } catch (e) {
    return { ok: false, detail: `network: ${(e as Error).message}` };
  }
}

/**
 * تسجيل محاولة الإرسال. جدول whatsapp_notifications يعمل كـ dedupe قسري
 * عبر قيد UNIQUE(order_id, event). إن لم يكن الجدول موجوداً بعد نُكمل بدونه.
 */
async function recordAttempt(
  admin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
): Promise<{ claimed: boolean; tableMissing: boolean }> {
  const { error } = await admin
    .from("whatsapp_notifications")
    .insert({ ...payload, created_at: new Date().toISOString() });

  if (!error) return { claimed: true, tableMissing: false };

  const missing =
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    /does not exist/i.test(error.message || "");
  if (missing) return { claimed: true, tableMissing: true };

  // 23505 = unique violation => الإشعار سبق إرساله => لا نكرر
  if (error.code === "23505") return { claimed: false, tableMissing: false };

  console.error("whatsapp_notifications insert error:", error.message);
  return { claimed: true, tableMissing: false };
}

// ============================ المعالج ============================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // ===== Webhook Verification من Meta (GET) =====
  // GET /functions/v1/misar-whatsapp
  //   ?hub.mode=subscribe
  //   &hub.verify_token=<WHATSAPP_VERIFY_TOKEN>
  //   &hub.challenge=<VALUE>
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const expectedToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (!expectedToken) {
      console.error("misar-whatsapp: WHATSAPP_VERIFY_TOKEN secret is not set");
      return json({ error: "Server configuration error" }, 500);
    }

    // مقارنة آمنة زمنياً لتفادي تسريب التوكن عبر timing attacks
    const tokenMatches =
      typeof verifyToken === "string" && timingSafeEqual(verifyToken, expectedToken);

    if (mode === "subscribe" && tokenMatches) {
      // Meta expects the raw challenge as plain text with HTTP 200
      return new Response(challenge ?? "", {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    console.warn(
      `misar-whatsapp: webhook verification failed (mode=${String(mode)}, token_provided=${Boolean(verifyToken)})`,
    );
    return json({ error: "Verification failed" }, 403);
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("misar-whatsapp: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return json({ error: "Server configuration error" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    // الجسم الخام ضروري للتحقق من توقيع Meta (لا يُقرأ req.json() مباشرة)
    const rawBody = await req.text();

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    // ==== بوابة الأمان: لا يُقبل POST إلا من Meta الموقّع أو مستخدم مشارك ====
    // (verify_jwt = false على البوابة، لذا نُغلق الباب هنا)
    const signatureOk = await verifyMetaSignature(
      rawBody,
      req.headers.get("x-hub-signature-256"),
    );

    let payload: { order_id?: string; event?: string };
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    // إشعارات Meta (messages / statuses) ليس فيها order_id: نؤكد التوقيع فقط وننتهي.
    const isMetaWebhook = signatureOk && !payload.order_id;
    if (isMetaWebhook) {
      // Meta تتطلب 200 سريعاً وإلا أعادت المحاولة. لا ننفّذ أي إرسال هنا.
      return json({ ok: true, received: true }, 200);
    }

    if (!signatureOk) {
      // ليس توقيع Meta صالحاً => يجب أن يكون مستخدماً مصادَقاً
      if (!token) {
        console.warn("misar-whatsapp: rejected POST - no valid signature and no auth token");
        return json({ error: "Missing authorization token" }, 401);
      }
      const { data: authUser, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !authUser?.user) {
        console.warn("misar-whatsapp: rejected POST - invalid auth token");
        return json({ error: "Invalid authorization token" }, 401);
      }
    }

    const orderId = payload.order_id;
    const event = payload.event || "order_created";
    if (!orderId || typeof orderId !== "string") return json({ error: "order_id is required" }, 400);

    const buildTemplate = TEMPLATES[event];
    if (!buildTemplate) return json({ error: `Unsupported event: ${event}` }, 400);

    // 1) جلب الطلب (أعمدة مؤكدة موجودة حالياً في جدول orders)
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select(
        "id, buyer_id, seller_id, product_id, quantity, total_price, shipping_address, " +
        "seller_name, seller_phone, created_at, status",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) {
      console.error("misar-whatsapp: order fetch failed:", orderErr.message);
      return json(
        { ok: false, skipped: "order_fetch_failed", detail: orderErr.message },
        200,
      );
    }
    if (!order) return json({ ok: false, skipped: "order_not_found" }, 200);

    // 2) الصلاحيات: المشتري أو البائع فقط
    //    - طلب موقّع من Meta: موثوق (المُرسِل هو مزوّد الخدمة نفسه).
    //    - طلب بمستخدم: يجب أن يكون مشاركاً فعلياً في الطلب.
    if (!signatureOk && !(await verifyParticipant(admin, token, order))) {
      return json({ error: "Not authorized for this order" }, 403);
    }

    // 3) بيانات الرسالة (fallback إلى products.product_name)
    const { data: product } = order.product_id
      ? await admin.from("products").select("name").eq("id", order.product_id).maybeSingle()
      : { data: null };

    const sellerName = order.seller_name || "البائع";
    const info: OrderInfo = {
      id: order.id,
      orderShort: String(order.id).slice(0, 8),
      sellerName,
      productName: product?.name || "منتج MISAR",
      quantity: Number(order.quantity || 1),
      totalPrice: money(order.total_price),
      shippingAddress: order.shipping_address || "غير محدد",
    };

    // 4) تحديد المستقبِل: seller_phone من الـ snapshot، ثم user_data.phone
    let rawPhone = order.seller_phone;
    if (!rawPhone && order.seller_id) {
      const { data: sellerProfile } = await admin
        .from("user_data")
        .select("phone")
        .eq("id", order.seller_id)
        .maybeSingle();
      rawPhone = sellerProfile?.phone || null;
    }
    const to = normalizeEgyptPhone(rawPhone);

    if (!to) {
      // شرط 13: لا نفشل الطلب، نسجّل فقط
      console.warn(
        `misar-whatsapp: no valid seller phone for order ${info.orderShort} (raw=${String(rawPhone ?? "null")})`,
      );
      await recordAttempt(admin, {
        order_id: order.id,
        event,
        recipient: null,
        status: "skipped_no_phone",
        error_detail: "seller phone missing or invalid",
      });
      return json({ ok: false, skipped: "invalid_or_missing_seller_phone" }, 200);
    }

    // 5) منع التكرار
    const claim = await recordAttempt(admin, {
      order_id: order.id,
      event,
      recipient: to,
      status: "pending",
      seller_name: sellerName,
    });
    if (!claim.claimed) {
      return json({ ok: true, skipped: "already_sent" }, 200);
    }

    // 6) الإرسال
    const result = await sendWhatsApp(to, buildTemplate(info));

    await admin
      .from("whatsapp_notifications")
      .update({
        status: result.ok ? "sent" : "failed",
        error_detail: result.ok ? null : result.detail,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq("order_id", order.id)
      .eq("event", event);

    if (!result.ok) console.error("misar-whatsapp: send failed:", result.detail);

    return json(
      { ok: result.ok, event, order_id: order.id, dedupe_table: !claim.tableMissing },
      200,
    );
  } catch (e) {
    // أي خطأ غير متوقع: نسجّله ولا نُفشل الطلب
    console.error("misar-whatsapp error:", e);
    return json({ ok: false, skipped: "internal_error" }, 200);
  }
});