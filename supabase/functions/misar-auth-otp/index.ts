// =====================================================================
// MISAR SYSTEMS — Edge Function: misar-auth-otp
// استعادة كلمة المرور عن طريق رقم الهاتف برمز تحقق (OTP).
// =====================================================================
// الخطوات (نفس الدالة، تتفرّع على body.step):
//   step = "send"     : المستخدم يُدخل إيميله. نبحث عن حساب auth بالإيميل،
//                       نقرأ رقم هاتفه من user_data (مصدر الحقيقة)، ونعمّم
//                       الرمز لهذا الرقم فقط. لا نكشف للعميل إن كان الإيميل
//                       موجوداً أم لا (رسالة عامة) — لكن نرجع masked phone
//                       ليستطيع المستخدم التأكد.
//   step = "verify"   : نتحقق من الرمز. عند النجاح نرجع reset_token قصير
//                       العمر يُستخدم في الخطوة التالية فقط.
//   step = "reset"    : بالرمز + reset_token + كلمة المرور الجديدة نحدّثها
//                       عبر admin API (auth.admin.updateUserById).
//
// الأمان:
//   • الرمز يُخزّن HMAC-SHA256 (وليس نصاً) بسر OTP_SIGNING_SECRET.
//   • 10 دقائق صلاحية للرمز، و15 دقيقة للـ reset_token.
//   • 3 محاولات كحد أقصى للتحقق، ثم يُلغى الطلب.
//   • تحديد معدل الإرسال: رمز واحد كل 60 ثانية لكل رقم.
//   • RLS على جدول password_reset_otps: بلا سياسات — الوصول حصري
//     بمفتاح الخدمة من هذه الدالة.
//   • نستخدم channel: SMS عبر Twilio (TWILIO_* secrets) أو WhatsApp
//     عبر WhatsApp Cloud API (WHATSAPP_* secrets — مضبوطة أصلاً).
//
// النشر:
//   supabase functions deploy misar-auth-otp --project-ref wwojtkxwmgkrudtevbcb
//   supabase secrets set OTP_SIGNING_SECRET=<64 hex>
// =====================================================================

// @ts-ignore
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// ---------- أدوات مساعدة ----------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

async function hmacSha256Hex(keyHex: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function random6Digits(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

function randomToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const local = digits.startsWith("20") ? "0" + digits.slice(2) : digits;
  return local.slice(0, 4) + "****" + local.slice(-3);
}

/** توحيد أرقام الهاتف إلى صيغة 20xxxxxxxxxx */
function normalizeEgyptPhone(raw: string): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.startsWith("0")) {
    const local = d.slice(1);
    if (!/^1[0125]\d{8}$/.test(local)) return null;
    return `20${local}`;
  }
  if (/^1[0125]\d{8}$/.test(d)) return `20${d}`;
  if (/^201[0125]\d{8}$/.test(d)) return d;
  return null;
}

// ---------- إرسال الرمز ----------

async function sendViaWhatsApp(phoneIntl: string, code: string): Promise<{ ok: boolean; detail: string }> {
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  if (!phoneNumberId || !accessToken) {
    return { ok: false, detail: "WHATSAPP_* secrets not set" };
  }
  const text =
    `🔐 MISAR SYSTEMS\n\nرمز استعادة كلمة المرور: ${code}\n\nصالح لمدة 10 دقائق. لا تشاركه مع أي أحد.`;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phoneIntl,
          type: "text",
          text: { preview_url: false, body: text },
        }),
      },
    );
    const raw = (await res.text()).slice(0, 300);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${raw}` };
    return { ok: true, detail: "sent (whatsapp)" };
  } catch (e) {
    return { ok: false, detail: `network: ${(e as Error).message}` };
  }
}

async function sendViaTwilioSMS(phoneIntl: string, code: string): Promise<{ ok: boolean; detail: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const token = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const from = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
  if (!sid || !token || !from) return { ok: false, detail: "TWILIO_* secrets not set" };
  const body = new URLSearchParams({
    To: `+${phoneIntl}`,
    From: from,
    Body: `MISAR SYSTEMS: رمز استعادة كلمة المرور هو ${code}. صالح 10 دقائق. لا تشاركه.`,
  });
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const raw = (await res.text()).slice(0, 300);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${raw}` };
    return { ok: true, detail: "sent (sms)" };
  } catch (e) {
    return { ok: false, detail: `network: ${(e as Error).message}` };
  }
}

async function sendOtp(phoneIntl: string, code: string): Promise<{ ok: boolean; channel: string; detail: string }> {
  // الأولوية: SMS (Twilio) إن أُعد، وإلا WhatsApp (المُعد حالياً).
  const tw = await sendViaTwilioSMS(phoneIntl, code);
  if (tw.ok) return { ok: true, channel: "sms", detail: tw.detail };
  const wa = await sendViaWhatsApp(phoneIntl, code);
  if (wa.ok) return { ok: true, channel: "whatsapp", detail: wa.detail };
  return { ok: false, channel: "none", detail: `sms: ${tw.detail} | whatsapp: ${wa.detail}` };
}

// ---------- المعالج ----------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const signingSecret = Deno.env.get("OTP_SIGNING_SECRET");
    if (!supabaseUrl || !serviceKey || !signingSecret) {
      return json({ ok: false, error: "server_config" }, 500);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const step = String(body.step || "").trim();
    const nowIso = new Date().toISOString();

    // ---------- step = "send" ----------
    if (step === "send") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ ok: false, error: "invalid_email", message: "البريد الإلكتروني غير صحيح." }, 400);
      }

      // 1) البحث عن مستخدم auth بالإيميل
      const { data: authUser, error: userErr } = await admin.rpc("misar_find_auth_user_by_email", { p_email: email });
      if (userErr) {
        console.error("rpc find user error:", userErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }
      if (!authUser || (authUser as { id: string }[]).length === 0) {
        // لا نكشف للعميل إن كان الإيميل مسجلاً — رسالة عامة.
        return json({
          ok: true,
          sent: false,
          masked_phone: null,
          message: "إذا كان هذا البريد مسجلاً وله رقم هاتف، سيصلك رمز التحقق خلال لحظات.",
        });
      }
      const userId = (authUser as { id: string }[])[0].id;

      // 2) قراءة رقم الهاتف من user_data (مصدر الحقيقة)
      const { data: udRow, error: udErr } = await admin
        .from("user_data")
        .select("phone, status, account_type")
        .eq("id", userId)
        .maybeSingle();
      if (udErr) {
        console.error("read user_data error:", udErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }
      const phoneRaw = udRow?.phone as string | null;
      if (!phoneRaw) {
        return json({
          ok: true,
          sent: false,
          masked_phone: null,
          message: "الحساب لا يحتوي على رقم هاتف مرتبط. تواصل مع الدعم لربط رقم هاتفك.",
        }, 200);
      }
      const phoneIntl = normalizeEgyptPhone(phoneRaw);
      if (!phoneIntl) {
        return json({
          ok: true,
          sent: false,
          masked_phone: null,
          message: "رقم الهاتف المحفوظ غير صالح. تواصل مع الدعم لتحديثه.",
        }, 200);
      }

      // 3) تحديد معدل الإرسال: رمز واحد كل 60 ثانية لنفس الرقم
      const { data: recentRows, error: recentErr } = await admin
        .from("password_reset_otps")
        .select("created_at")
        .eq("phone", phoneIntl)
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
        .limit(1);
      if (recentErr) {
        console.error("rate-limit read error:", recentErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }
      if (recentRows && recentRows.length > 0) {
        return json({
          ok: false,
          error: "rate_limited",
          message: "تم إرسال رمز مؤخراً. انتظر دقيقة ثم أعد المحاولة.",
        }, 429);
      }

      // 4) توليد الرمز وتشفيره
      const code = random6Digits();
      const codeHash = await hmacSha256Hex(signingSecret, `${phoneIntl}:${code}`);

      // إلغاء الطلبات القديمة غير المستخدمة لنفس المستخدم
      await admin.from("password_reset_otps").update({ verified_expires_at: null, token_hash: null }).eq("user_id", userId).eq("verified", false);

      const { error: insertErr } = await admin.from("password_reset_otps").insert({
        user_id: userId,
        email: email,
        phone: phoneIntl,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (insertErr) {
        console.error("insert otp error:", insertErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }

      // 5) الإرسال
      const sendRes = await sendOtp(phoneIntl, code);
      if (!sendRes.ok) {
        console.error("send otp failed:", sendRes.detail);
        // تفاصيل التشخيص فقط عند ترويسة x-debug-otp: 1 (لن تُستخدم في الإنتاج)
        const includeDetail = req.headers.get("x-debug-otp") === "1";
        return json({
          ok: false,
          error: "send_failed",
          message: "تعذّر إرسال الرمز الآن. حاول مرة أخرى بعد قليل أو تواصل مع الدعم.",
          ...(includeDetail ? { debug_detail: sendRes.detail, debug_channel: sendRes.channel } : {}),
        }, 502);
      }

      return json({
        ok: true,
        sent: true,
        channel: sendRes.channel,
        masked_phone: maskPhone(phoneIntl),
        message: `تم إرسال رمز التحقق إلى ${maskPhone(phoneIntl)} عبر ${sendRes.channel === "whatsapp" ? "واتساب" : "رسالة SMS"}.`,
      }, 200);
    }

    // ---------- step = "verify" ----------
    if (step === "verify") {
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      if (!email || !/^\d{6}$/.test(code)) {
        return json({ ok: false, error: "invalid_input", message: "يرجى إدخال الرمز المكون من 6 أرقام." }, 400);
      }

      // أحدث طلب غير موثّق لهذا الإيميل
      const { data: otpRows, error: otpErr } = await admin
        .from("password_reset_otps")
        .select("id, user_id, phone, code_hash, attempts, expires_at, verified")
        .eq("email", email)
        .eq("verified", false)
        .order("created_at", { ascending: false })
        .limit(1);
      if (otpErr) {
        console.error("verify read error:", otpErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }
      if (!otpRows || otpRows.length === 0) {
        return json({ ok: false, error: "not_found", message: "لم نجد طلب استعادة لهذا البريد. ابدأ من جديد." }, 404);
      }
      const otp = otpRows[0];

      // منتهي الصلاحية؟
      if (new Date(otp.expires_at).getTime() < Date.now()) {
        return json({ ok: false, error: "expired", message: "انتهت صلاحية الرمز. ابدأ من جديد." }, 400);
      }

      // تجاوز عدد المحاولات؟
      if (otp.attempts >= 3) {
        return json({ ok: false, error: "too_many_attempts", message: "تجاوزت عدد المحاولات المسموح. ابدأ من جديد." }, 429);
      }

      const expectedHash = await hmacSha256Hex(signingSecret, `${otp.phone}:${code}`);
      if (expectedHash !== otp.code_hash) {
        // زيادة المحاولات
        await admin.from("password_reset_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
        return json({
          ok: false,
          error: "invalid_code",
          message: `الرمز غير صحيح. المحاولات المتبقية: ${Math.max(0, 2 - otp.attempts)}`,
        }, 400);
      }

      // الرمز صحيح — توليد reset_token قصير العمر
      const resetToken = randomToken();
      const resetTokenHash = await hmacSha256Hex(signingSecret, resetToken);
      const { error: updErr } = await admin
        .from("password_reset_otps")
        .update({
          verified: true,
          token_hash: resetTokenHash,
          verified_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        .eq("id", otp.id);
      if (updErr) {
        console.error("verify update error:", updErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }

      return json({
        ok: true,
        reset_token: resetToken,
        message: "تم التحقق بنجاح. أدخل كلمة المرور الجديدة.",
      }, 200);
    }

    // ---------- step = "reset" ----------
    if (step === "reset") {
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      const resetToken = String(body.reset_token || "").trim();
      const newPassword = String(body.new_password || "");

      if (!email || !/^\d{6}$/.test(code) || !resetToken) {
        return json({ ok: false, error: "invalid_input", message: "بيانات ناقصة أو غير صالحة." }, 400);
      }
      if (newPassword.length < 6) {
        return json({ ok: false, error: "weak_password", message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل." }, 400);
      }
      if (newPassword.length > 72) {
        return json({ ok: false, error: "weak_password", message: "كلمة المرور طويلة جداً (الحد 72 حرفاً)." }, 400);
      }

      // أحدث طلب موثّق وغير مستخدم
      const { data: otpRows, error: otpErr } = await admin
        .from("password_reset_otps")
        .select("id, user_id, phone, code_hash, token_hash, verified_expires_at, verified")
        .eq("email", email)
        .eq("verified", true)
        .not("token_hash", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (otpErr) {
        console.error("reset read error:", otpErr.message);
        return json({ ok: false, error: "server_error", message: "حدث خطأ. حاول لاحقاً." }, 500);
      }
      if (!otpRows || otpRows.length === 0) {
        return json({ ok: false, error: "not_found", message: "لم نجد جلسة تحقق صالحة. ابدأ من جديد." }, 404);
      }
      const otp = otpRows[0];

      if (new Date(otp.verified_expires_at).getTime() < Date.now()) {
        return json({ ok: false, error: "expired", message: "انتهت صلاحية جلسة الاستعادة. ابدأ من جديد." }, 400);
      }

      // تحقق من الرمز مرة أخرى + الـ reset_token
      const codeHash = await hmacSha256Hex(signingSecret, `${otp.phone}:${code}`);
      const tokenHash = await hmacSha256Hex(signingSecret, resetToken);
      if (codeHash !== otp.code_hash || tokenHash !== otp.token_hash) {
        return json({ ok: false, error: "invalid_session", message: "بيانات الاستعادة غير صالحة. ابدأ من جديد." }, 400);
      }

      // تحديث كلمة المرور عبر admin API
      const { error: updUserErr } = await admin.auth.admin.updateUserById(otp.user_id, {
        password: newPassword,
      });
      if (updUserErr) {
        console.error("update user password error:", updUserErr.message);
        return json({ ok: false, error: "update_failed", message: "تعذّر تحديث كلمة المرور. حاول مرة أخرى." }, 500);
      }

      // إنهاء الجلسة (استهلاك الطلب)
      await admin.from("password_reset_otps").update({
        token_hash: null,
        verified_expires_at: null,
      }).eq("id", otp.id);

      return json({ ok: true, message: "تم تغيير كلمة المرور بنجاح. سجّل الدخول بالبريد وكلمة المرور الجديدة." }, 200);
    }

    return json({ ok: false, error: "unknown_step", message: "طلب غير معروف." }, 400);
  } catch (e) {
    console.error("misar-auth-otp error:", e);
    return json({ ok: false, error: "internal_error", message: "حدث خطأ غير متوقع." }, 500);
  }
});
