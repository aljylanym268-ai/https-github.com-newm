// =====================================================================
// Supabase Edge Function: misar-founder-notify
// إرسال إشعارات إدارية/تشغيلية إلى رقم واتساب المؤسس فقط.
// =====================================================================
// المبدأ:
//   • لا ترسل إلا إلى OWNER_WHATSAPP_NUMBER (أو رقم من app_settings).
//   • تقرأ notification_settings من app_settings وتطبّقها فعلياً.
//   • منع التكرار عبر event_key في founder_notifications (UNIQUE).
//   • لا تكشف أرقام عملاء أو عناوين أو بيانات حساسة في الرسالة.
//   • لا تُفشل العملية الأصلية: تُرجع 200 دائماً.
//
// المصادقة (مهم جداً):
//   الدالة تُنشر مع verify_jwt = TRUE (الافتراضي). البوابة ترفض أي رمز غير
//   صالح قبل وصول الطلب إلى هذا الكود، ثم نتحقق إضافياً هنا:
//     1) auth.getUser(token)  → رمز صالح وغير منتهٍ.
//     2) rpc('misar_is_founder') → صاحب الرمز مؤسس فعلاً.
//   لذلك لا حاجة لـ --no-verify-jwt ولا يوجد أي مسار يتخطّى التحقق.
//   (استخدام --no-verify-jwt ممنوع هنا: سيجعل البوابة تعبر أي طلب إلى الكود.)
//
// SERVICES المطلوبه (Secrets على الخادم فقط، لا في المتصفح):
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, OWNER_WHATSAPP_NUMBER
//   (اختياري) CALLMEBOT_APIKEY, CALLMEBOT_PHONE, NOTIFY_CHANNEL
//
// قناة الإرسال:
//   • meta     : عبر WhatsApp Cloud API (يحتاج توكن Meta صالح).
//   • callmebot: عبر CallMeBot (يعمل حتى لو انتهى توكن Meta).
//   • auto     : الافتراضي — Meta أولاً، ثم CallMeBot عند فشل Meta.
//     يمكن ضبط القناة بسر NOTIFY_CHANNEL أو بحقل channel في notification_settings.
//     ملاحظة: CallMeBot قناة شخصية للمؤسس فقط، لا تُستخدم لمراسلة العملاء.
//
// النشر (بدون Docker — الحزم يتم على خادم Supabase):
//   supabase functions deploy misar-founder-notify \
//     --project-ref wwojtkxwmgkrudtevbcb --use-api
//   ⚠️ لا تضف --no-verify-jwt: التحقق من الهوية هو خط الدفاع الأول.
// =====================================================================

// @ts-ignore
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GRAPH_VERSION = "v21.0";
const DEFAULT_BUSINESS_NAME = "MISAR SYSTEMS";

// =====================================================================
// إعدادات موحّدة (config) — تُقرأ مرة واحدة من أسرار الخادم.
// ⚠️ الرقم الاحتياطي هنا «رقم المؤسس»، وليس رقماً ثابتاً في منطق الإرسال:
//    الأولوية دائماً لرقم محفوظ في app_settings، ثم لسر OWNER_WHATSAPP_NUMBER.
// =====================================================================
const config = {
  USER_NUMBER: Deno.env.get("OWNER_WHATSAPP_NUMBER") ?? "201080562909",
  PORT: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "",
  KEY: Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "",
  // قناة CallMeBot الاحتياطية: تعمل حتى لو انتهى توكن Meta.
  // تُستخدم فقط كخط ثانٍ عند فشل الإرسال الرسمي (لا تُستبدل به).
  BOT_KEY: Deno.env.get("CALLMEBOT_APIKEY") ?? "",
  BOT_PHONE: Deno.env.get("CALLMEBOT_PHONE") ?? "",
};

// قناة الإرسال الفعلية: "meta" أو "callmebot" أو "auto".
//   auto = Meta أولاً، ثم CallMeBot تلقائياً عند فشل Meta (الافتراضي).
// يمكن ضبطها عبر السر NOTIFY_CHANNEL، أو عبر notification_settings.channel.
function resolveChannel(settingsChannel?: string): "meta" | "callmebot" | "auto" {
  const raw = String(Deno.env.get("NOTIFY_CHANNEL") ?? settingsChannel ?? "auto").trim().toLowerCase();
  if (raw === "meta" || raw === "callmebot") return raw;
  return "auto";
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** تطبيع الرقم المصري إلى 20xxxxxxxxx */
function normalizeEgyptPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0020")) digits = digits.slice(4);
  else if (digits.startsWith("20") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("+20")) digits = digits.slice(1);
  if (digits.startsWith("0")) {
    const local = digits.slice(1);
    if (!/^1[0125]\d{8}$/.test(local)) return null;
    return `20${local}`;
  }
  if (/^1[0125]\d{8}$/.test(digits)) return `20${digits}`;
  if (/^201[0125]\d{8}$/.test(digits)) return digits;
  return null;
}

// =====================================================================
// قوالب الرسائل — بيانات غير حساسة فقط
// نوع النص ثابت من الخادم (لا نسمح للعميل بإرسال body حر) لمنع إساءة
// استخدام رمز واتساب المدفوع كأداة spam.
// =====================================================================
type EventPayload = Record<string, unknown>;

interface EventConfig {
  enabled: boolean;
  build: (p: EventPayload) => string;
}

const EVENT_CONFIG: Record<string, EventConfig> = {};
function defineEvent(key: string, build: (p: EventPayload) => string) {
  EVENT_CONFIG[key] = { enabled: true, build };
}

function eventText(key: string, payload: EventPayload): string | null {
  const cfg = Object.hasOwn(EVENT_CONFIG, key) ? EVENT_CONFIG[key] : null;
  if (!cfg || cfg.enabled !== true) return null;
  return cfg.build(payload || {});
}

const TEMPLATES: Record<string, (p: EventPayload) => string> = {
  new_client: () =>
    `🔔 ${DEFAULT_BUSINESS_NAME} — حساب عميل جديد\n\nتم تسجيل عميل جديد على المنصة.\n\nادخل إلى لوحة المؤسس للتفاصيل.`,
  new_seller: () =>
    `🔔 ${DEFAULT_BUSINESS_NAME} — بائع جديد\n\nتم تسجيل بائع جديد على المنصة.\n\nادخل إلى لوحة المؤسس للتفاصيل.`,
  new_delivery: () =>
    `🔔 ${DEFAULT_BUSINESS_NAME} — مندوب جديد\n\nتم تسجيل مندوب جديد على المنصة.\n\nادخل إلى لوحة المؤسس للتفاصيل.`,
  account_verification: (p) =>
    `🔔 ${DEFAULT_BUSINESS_NAME} — طلب توثيق حساب\n\nيوجد طلب توثيق حساب جديد${p.account_type ? ` (${String(p.account_type)})` : ""}.\n\nادخل إلى لوحة المؤسس لمراجعته.`,
  order_created: (p) =>
    `🔔 ${DEFAULT_BUSINESS_NAME} — طلب جديد\n\nتم إنشاء طلب جديد${p.order_short ? ` #${String(p.order_short)}` : ""}.\n\nادخل إلى لوحة المؤسس لمتابعته.`,
  order_status_changed: (p) =>
    `🔔 ${DEFAULT_BUSINESS_NAME} — تغيير حالة طلب\n\nالطلب${p.order_short ? ` #${String(p.order_short)}` : ""} تغيّرت حالته${p.status ? ` إلى: ${String(p.status)}` : ""}.`,
  order_accepted: (p) =>
    `✅ ${DEFAULT_BUSINESS_NAME} — قبول طلب\n\nتم قبول الطلب${p.order_short ? ` #${String(p.order_short)}` : ""}.`,
  order_rejected: (p) =>
    `❌ ${DEFAULT_BUSINESS_NAME} — رفض طلب\n\nتم رفض الطلب${p.order_short ? ` #${String(p.order_short)}` : ""}.`,
  order_cancelled: (p) =>
    `⚠️ ${DEFAULT_BUSINESS_NAME} — إلغاء طلب\n\nتم إلغاء الطلب${p.order_short ? ` #${String(p.order_short)}` : ""}.`,
  return_requested: (p) =>
    `↩️ ${DEFAULT_BUSINESS_NAME} — طلب استرجاع\n\nيوجد طلب استرجاع جديد${p.order_short ? ` على الطلب #${String(p.order_short)}` : ""}.`,
  delivery_delayed: () =>
    `⏰ ${DEFAULT_BUSINESS_NAME} — تأخر توصيل\n\nيوجد طلب متأخر في التوصيل. راجع لوحة المؤسس.`,
  delivery_problem: () =>
    `🚚 ${DEFAULT_BUSINESS_NAME} — مشكلة توصيل\n\nتم الإبلاغ عن مشكلة في التوصيل. راجع لوحة المؤسس.`,
  complaint_new: () =>
    `🚩 ${DEFAULT_BUSINESS_NAME} — بلاغ جديد\n\nتم تقديم بلاغ جديد. راجع تبويب البلاغات.`,
  gm_login: (p) =>
    `🔐 ${DEFAULT_BUSINESS_NAME} — تسجيل دخول مدير عام\n\nتم تسجيل دخول مدير عام${p.name ? `: ${String(p.name)}` : ""}.`,
  gm_permissions_changed: (p) =>
    `🛡️ ${DEFAULT_BUSINESS_NAME} — تغيير صلاحيات مدير عام\n\nتم تعديل صلاحيات مدير عام${p.name ? `: ${String(p.name)}` : ""}.`,
  admin_suspended: (p) =>
    `⛔ ${DEFAULT_BUSINESS_NAME} — إيقاف/تفعيل حساب إداري\n\nتم تغيير حالة حساب إداري${p.name ? `: ${String(p.name)}` : ""}.`,
  platform_settings_changed: () =>
    `⚙️ ${DEFAULT_BUSINESS_NAME} — تغيير إعدادات المنصة\n\nتم تعديل إعدادات المنصة. راجع لوحة المؤسس.`,
  unauthorized_access: () =>
    `🚨 ${DEFAULT_BUSINESS_NAME} — محاولة وصول مرفوضة\n\nتم رصد محاولة وصول غير مصرّح بها.`,
  critical_error: (p) =>
    `🛑 ${DEFAULT_BUSINESS_NAME} — خطأ تقني مهم\n\n${p.message ? String(p.message).slice(0, 300) : "حدث خطأ تقني. راجع سجلات النظام."}`,
  notification_failed: () =>
    `⚠️ ${DEFAULT_BUSINESS_NAME} — فشل إرسال إشعار\n\nفشل إرسال إشعار واتساب. راجع سجل الإشعارات.`,
};

for (const [key, builder] of Object.entries(TEMPLATES)) defineEvent(key, builder);

// =====================================================================
// القناة الاحتياطية: CallMeBot
// تعمل حتى لو انتهى توكن Meta. تُستخدم كخط ثانٍ عند فشل الإرسال الرسمي.
// ملاحظة: هذه قناة شخصية للمؤسس فقط — لا تُستخدم لمراسلة العملاء.
// =====================================================================
async function sendViaCallMeBot(
  text: string,
): Promise<{ ok: boolean; detail: string }> {
  const apiKey = config.BOT_KEY;
  const phone = config.BOT_PHONE;
  if (!apiKey || !phone) {
    return { ok: false, detail: "CALLMEBOT_APIKEY / CALLMEBOT_PHONE غير مضبوطة" };
  }

  // العنوان ثابت من الخادم — لا نقبل عنواناً قادماً من الطلب.
  const url = "https://api.callmebot.com/whatsapp.php?" +
    `phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    const raw = (await res.text()).slice(0, 200);

    // CallMeBot يُرجع 200 حتى في بعض الأخطاء، لذلك نتحقق من المحتوى أيضاً.
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${raw}` };
    if (/queued/i.test(raw)) return { ok: true, detail: "sent (callmebot)" };
    return { ok: false, detail: `callmebot: ${raw}` };
  } catch (e) {
    return { ok: false, detail: `network: ${(e as Error).message}` };
  }
}

// =====================================================================
// الإرسال عبر WhatsApp Cloud API (نص حر داخل نافذة 24 ساعة)
// ملاحظة: عند توفر قوالب معتمدة من Meta يمكن تمرير template_name
// في الجسم، ونرسل نوع "template" بدل "text" (جاهز للتوسعة).
// =====================================================================
async function sendWhatsApp(
  to: string,
  text: string,
  templateName?: string,
  templateLang = "ar",
): Promise<{ ok: boolean; detail: string }> {
  const phoneNumberId = config.PORT;
  const accessToken = config.KEY;
  if (!phoneNumberId || !accessToken) {
    return { ok: false, detail: "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN غير مضبوطة" };
  }

  // العنوان يُبنى من رقم الهاتف فقط — لا نقبل أبداً عنواناً قادماً من الطلب
  // (وإلا أُرسل رمز الوصول إلى خادم المهاجم).
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;

  let body: Record<string, unknown>;
  if (templateName) {
    // مسار القالب المعتمد (يعمل خارج نافذة 24 ساعة)
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name: templateName, language: { code: templateLang } },
    };
  } else {
    // مسار النص الحر (يعمل داخل نافذة 24 ساعة فقط)
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    };
  }

  // ⚠️ التسعير: حسب تسعير Meta الجديد للرسائل، قد تُرفض الرسالة بخطأ 131042
  // (رسوم/تسعير) إذا لم تُفعّل طريقة الدفع على حساب WhatsApp Business،
  // أو إذا كانت الرسالة من نوع marketing/authentication بلا موافقة أو خارج
  // نافذة خدمة العملاء (24 ساعة). هذه الأخطاء تأتي من Meta نفسها، لذلك
  // نسجل رسالتها ونعرضها كما هي في founder_notifications.
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
    if (!res.ok) {
      // لا نسجل ونرجع جسم استجابة Meta كما هو: قد يحتوي معرّفات حساب.
      // نستخرج رسالة الخطأ فقط ونقصّها.
      let msg = raw.slice(0, 200);
      try {
        const parsed = JSON.parse(raw);
        const first = parsed?.error?.message;
        if (first) msg = String(first).slice(0, 200);
      } catch (_e) { /* ليس JSON */ }
      return { ok: false, detail: `HTTP ${res.status}: ${msg}` };
    }
    return { ok: true, detail: "sent" };
  } catch (e) {
    return { ok: false, detail: `network: ${(e as Error).message}` };
  }
}

// =====================================================================
// منع التكرار: إدراج صف بحالة pending مع event_key فريد.
// 23505 = سبق الإرسال => لا نكرر.
// =====================================================================
async function claimEvent(
  admin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
): Promise<{ claimed: boolean; rowId: string | null; tableMissing: boolean }> {
  const { data, error } = await admin
    .from("founder_notifications")
    .insert({ ...payload, created_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();

  if (!error) return { claimed: true, rowId: (data as { id?: string } | null)?.id ?? null, tableMissing: false };

  const missing =
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    /does not exist/i.test(error.message || "");
  if (missing) return { claimed: true, rowId: null, tableMissing: true };

  if (error.code === "23505") return { claimed: false, rowId: null, tableMissing: false };

  console.error("founder_notifications insert error:", error.message);
  return { claimed: true, rowId: null, tableMissing: false };
}

// =====================================================================
// قراءة الإعدادات (تطبّق فعلياً على الخادم)
// =====================================================================
interface NotificationSettings {
  master_enabled: boolean;
  channel: string;
  founder_whatsapp_number: string;
  types: Record<string, boolean>;
}

async function loadSettings(
  admin: ReturnType<typeof createClient>,
): Promise<NotificationSettings> {
  const defaults: NotificationSettings = {
    master_enabled: true,
    channel: "whatsapp",
    founder_whatsapp_number: "",
    types: {},
  };
  try {
    const { data } = await admin
      .from("app_settings")
      .select("setting_value")
      .eq("setting_key", "notification_settings")
      .maybeSingle();

    // app_settings.setting_value قد يكون jsonb (كائن) أو text (نص JSON).
    // مع عمود text كان الشرط (typeof val === "object") يفشل، فتتجاهل الدالة
    // إعدادات المؤسس المحفوظة وتستخدم الافتراضية — أي أن زر إيقاف الإشعارات
    // كان بلا أثر. نُحلّل النص هنا.
    let val = (data as { setting_value?: unknown } | null)?.setting_value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (_e) {
        console.error("loadSettings: setting_value ليس JSON صالحاً");
        return defaults;
      }
    }

    if (val && typeof val === "object") {
      const v = val as NotificationSettings;
      return {
        master_enabled: v.master_enabled !== false,
        channel: typeof v.channel === "string" ? v.channel : "whatsapp",
        founder_whatsapp_number: typeof v.founder_whatsapp_number === "string" ? v.founder_whatsapp_number : "",
        types: (v.types && typeof v.types === "object") ? v.types : {},
      };
    }
  } catch (e) {
    console.error("loadSettings error:", (e as Error).message);
  }
  return defaults;
}

// =====================================================================
// المعالج
// =====================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, skipped: "server_config" }, 500);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ----- الحماية -----
    // زر «اختبار الربط» في لوحة المؤسس ينادي هذه الدالة من المتصفح، ولا يمكن
    // وضع NOTIFY_SHARED_SECRET في كود الواجهة لأنه سيصبح مكشوفاً لأي زائر.
    // لذلك نعتمد على الهوية المصادَق بها فقط:
    //   • نتحقق من رمز الدخول (JWT) لدى Supabase Auth باستخدام getUser(token).
    //   • ثم نتحقق أن صاحب الرمز مؤسس فعلياً عبر public.misar_is_founder()
    //     باستخدام رمز صاحب الطلب (وليس مفتاح الخدمة) حتى يكون الفحص عن هويته.
    //   • نعتمد على هوية صاحب التوكن فقط — وليس على أي ترويسة عمياء.
    //
    // سبب عدم الاعتماد على ترويسة x-notify-secret هنا:
    //   أي زائر يحصل على anon key العام يستطيع وضع أي قيمة في تلك الترويسة.
    //   فإذا كان NOTIFY_SHARED_SECRET غير مضبوط (أو ضُبط لاحقاً بقيمة معروفة)
    //   لأمكن لأي شخص إغراق رقم المؤسس برسائل واتساب. الأمان الآن في الهوية.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!anonKey) {
      return json({ ok: false, skipped: "server_config" }, 500);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    // (1) رمز صالح وغير منتهٍ؟
    const { data: userData, error: userErr } = await asUser.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    // (2) هل صاحب الرمز مؤسس؟ (يُقيَّم على قاعدة البيانات بهويته)
    const { data: founderFlag, error: founderErr } = await asUser.rpc("misar_is_founder");
    if (founderErr) {
      console.error("misar-founder-notify: founder check failed:", founderErr.message);
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    if (founderFlag !== true) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const eventType: string = String(body.event_type || body.event || "").trim();
    const eventKey: string = String(body.event_key || "").trim();
    const payload: EventPayload = (body.payload && typeof body.payload === "object") ? body.payload : {};
    const templateName: string | undefined = body.template_name ? String(body.template_name) : undefined;

    if (!eventType || !eventKey) {
      return json({ ok: false, error: "event_type and event_key are required" }, 400);
    }

    const buildTemplate = Object.hasOwn(EVENT_CONFIG, eventType) ? EVENT_CONFIG[eventType].build : undefined;
    if (!buildTemplate) {
      // نوع غير معروف => لا نرسل (لا نفشل)
      return json({ ok: false, skipped: "unknown_event_type", event_type: eventType }, 200);
    }

    // ----- قراءة الإعدادات وتطبيقها -----
    const settings = await loadSettings(admin);

    const typeEnabled = settings.types?.[eventType] !== false; // افتراضي مفعّل إن غير معرّف
    const masterEnabled = settings.master_enabled !== false;

    if (!masterEnabled || !typeEnabled) {
      await claimEvent(admin, {
        event_key: eventKey,
        event_type: eventType,
        recipient: null,
        status: "skipped_disabled",
        payload,
      });
      return json({ ok: false, skipped: "disabled", event_type: eventType }, 200);
    }

    // ----- تحديد المستقبِل: المؤسس فقط (رقم محفوظ → سر → احتياطي) -----
    const rawOwner = settings.founder_whatsapp_number || config.USER_NUMBER;
    const to = normalizeEgyptPhone(rawOwner);
    if (!to) {
      await claimEvent(admin, {
        event_key: eventKey,
        event_type: eventType,
        recipient: null,
        status: "skipped_no_recipient",
        payload,
      });
      return json({ ok: false, skipped: "invalid_owner_number" }, 200);
    }

    // ----- منع التكرار -----
    const claim = await claimEvent(admin, {
      event_key: eventKey,
      event_type: eventType,
      recipient: to,
      status: "pending",
      payload,
    });
    if (!claim.claimed) {
      return json({ ok: false, skipped: "duplicate", event_type: eventType }, 200);
    }

    // ----- الإرسال -----
    const text = eventText(eventType, payload) ?? buildTemplate(payload);

    // اختيار القناة: auto = Meta أولاً، ثم CallMeBot تلقائياً عند فشل Meta.
    const channel = resolveChannel(settings.channel);
    let result: { ok: boolean; detail: string };
    let usedChannel = channel;

    if (channel === "callmebot") {
      result = await sendViaCallMeBot(text);
    } else if (channel === "meta") {
      result = await sendWhatsApp(to, text, templateName);
    } else {
      // auto: نجرب Meta، وإن فشل ننتقل للخط الثاني (مثال: انتهاء توكن Meta).
      result = await sendWhatsApp(to, text, templateName);
      if (!result.ok) {
        const fallback = await sendViaCallMeBot(text);
        if (fallback.ok) {
          usedChannel = "callmebot";
          result = { ok: true, detail: `meta failed (${result.detail}) → sent via callmebot` };
        } else {
          result = { ok: false, detail: `meta: ${result.detail} | callmebot: ${fallback.detail}` };
        }
      } else {
        usedChannel = "meta";
      }
    }

    if (claim.rowId) {
      await admin
        .from("founder_notifications")
        .update({
          status: result.ok ? "sent" : "failed",
          error_detail: result.ok ? null : result.detail,
          sent_at: result.ok ? new Date().toISOString() : null,
        })
        .eq("id", claim.rowId);
    }

    if (!result.ok) console.error("misar-founder-notify: send failed:", result.detail);

    return json(
      {
        ok: result.ok,
        event_type: eventType,
        channel: usedChannel,
        dedupe_table: !claim.tableMissing,
        detail: result.ok ? "sent" : result.detail,
      },
      200,
    );
  } catch (e) {
    console.error("misar-founder-notify error:", e);
    return json({ ok: false, skipped: "internal_error" }, 200);
  }
});
