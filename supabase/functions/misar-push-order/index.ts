import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("Supabase service credentials are not configured.");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

async function getAuthenticatedUser(req: Request, admin: ReturnType<typeof getServiceClient>) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

function getPushConfig() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be configured.");
  }
  return { publicKey, privateKey, subject };
}

function getAppUrl() {
  const appUrl = Deno.env.get("APP_PUBLIC_URL");
  if (!appUrl) throw new Error("APP_PUBLIC_URL must be configured.");
  const url = new URL(appUrl);
  if (url.protocol !== "https:") throw new Error("APP_PUBLIC_URL must use HTTPS.");
  return url;
}

function getOrderUrl(orderId: string) {
  const url = new URL(getAppUrl());
  url.searchParams.set("pushOrder", orderId);
  return url.href;
}

async function deliverToUsers(
  admin: ReturnType<typeof getServiceClient>,
  userIds: string[],
  title: string,
  message: string,
  url: string,
  tag: string,
) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return { sent: 0, failed: 0, recipients: 0 };

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", uniqueUserIds);
  if (error) throw error;
  if (!subscriptions?.length) return { sent: 0, failed: 0, recipients: uniqueUserIds.length };

  const config = getPushConfig();
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const payload = JSON.stringify({ title, body: message, url, tag });
  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
      sent++;
    } catch (error) {
      failed++;
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await admin
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", subscription.endpoint)
          .eq("user_id", subscription.user_id);
        if (deleteError) console.error("Failed to remove expired Push subscription:", deleteError.message);
      } else {
        console.error("Push delivery failed:", statusCode || "unknown status");
      }
    }
  }));

  return { sent, failed, recipients: uniqueUserIds.length };
}

async function sendOrderEvent(
  admin: ReturnType<typeof getServiceClient>,
  userId: string,
  event: string,
  orderId: string,
) {
  if (!ORDER_ID_PATTERN.test(orderId)) return json({ error: "A valid order_id is required." }, 400);
  const { data: order, error } = await admin
    .from("orders")
    .select("id, buyer_id, seller_id, delivery_id, status, center")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error("Failed to read Push order:", error.message);
    return json({ error: "Could not verify order." }, 500);
  }
  if (!order) return json({ error: "Order not found." }, 404);
  const { data: actor, error: actorError } = await admin
    .from("user_data")
    .select("account_type, status")
    .eq("id", userId)
    .maybeSingle();
  if (actorError) {
    console.error("Failed to verify order notification sender:", actorError.message);
    return json({ error: "Could not verify notification sender." }, 500);
  }
  const isApprovedSeller = actor?.account_type === "seller" &&
    (!actor.status || actor.status === "approved");
  const isApprovedCourier = actor?.account_type === "delivery" &&
    (!actor.status || actor.status === "approved");

  let recipients: string[] = [];
  let title = "";
  let message = "";
  switch (event) {
    case "new_order": {
      if (order.buyer_id !== userId || order.status !== "pending" ||
          actor?.account_type !== "client") break;
      if (order.seller_id) {
        const { data: seller, error: sellerError } = await admin
          .from("user_data")
          .select("account_type, status")
          .eq("id", order.seller_id)
          .maybeSingle();
        if (sellerError) {
          console.error("Failed to verify Push seller:", sellerError.message);
          return json({ error: "Could not verify seller account." }, 500);
        }
        if (seller?.account_type !== "seller" ||
            (seller.status && seller.status !== "approved")) break;
      }
      recipients = order.seller_id ? [order.seller_id] : [];
      title = "🔔 طلب جديد";
      message = "لديك طلب جديد من العميل";
      break;
    }
    case "order_confirmed":
      if (order.seller_id !== userId || order.status !== "confirmed" || !isApprovedSeller) break;
      recipients = [order.buyer_id];
      title = "تم تأكيد طلبك";
      message = `تم تأكيد طلبك #${order.id.slice(0, 8)}`;
      break;
    case "order_prepared":
      if (order.seller_id !== userId || order.status !== "prepared" || !isApprovedSeller) break;
      recipients = [order.buyer_id];
      title = "تم تجهيز طلبك";
      message = `طلبك #${order.id.slice(0, 8)} جاهز للتوصيل`;
      break;
    case "courier_order_ready": {
      if (order.seller_id !== userId || order.status !== "prepared" ||
          !isApprovedSeller || !order.center) break;
      const { data: couriers, error: courierError } = await admin
        .from("user_data")
        .select("id")
        .eq("account_type", "delivery")
        .eq("status", "approved")
        .eq("center", order.center);
      if (courierError) {
        console.error("Failed to load eligible couriers:", courierError.message);
        return json({ error: "Could not find eligible couriers." }, 500);
      }
      recipients = (couriers || []).map((courier) => courier.id);
      title = "طلب توصيل متاح";
      message = `طلب جديد جاهز للاستلام في ${order.center}`;
      break;
    }
    case "order_picked_up":
      if (order.delivery_id !== userId || order.status !== "picked_up" || !isApprovedCourier) break;
      recipients = [order.buyer_id, order.seller_id];
      title = "تم استلام الطلب بواسطة مندوب";
      message = `تم استلام الطلب #${order.id.slice(0, 8)} بواسطة مندوب`;
      break;
    case "order_in_delivery":
      if (order.delivery_id !== userId || order.status !== "in_delivery" || !isApprovedCourier) break;
      recipients = [order.buyer_id];
      title = "طلبك في الطريق";
      message = `طلبك #${order.id.slice(0, 8)} في طريقه إليك`;
      break;
    case "order_delivered":
      if (order.delivery_id !== userId || order.status !== "delivered" || !isApprovedCourier) break;
      recipients = [order.buyer_id, order.seller_id];
      title = "تم تسليم الطلب";
      message = `تم تسليم الطلب #${order.id.slice(0, 8)} بنجاح`;
      break;
    case "order_cancelled":
      if (order.status !== "cancelled" ||
          ![order.buyer_id, order.seller_id, order.delivery_id].includes(userId)) break;
      if (order.buyer_id === userId && actor?.account_type !== "client") break;
      if (order.seller_id === userId && !isApprovedSeller) break;
      if (order.delivery_id === userId && !isApprovedCourier) break;
      recipients = [order.buyer_id, order.seller_id, order.delivery_id];
      title = "تم إلغاء الطلب";
      message = `تم إلغاء الطلب #${order.id.slice(0, 8)}`;
      break;
    default:
      return json({ error: "Unsupported order event." }, 400);
  }

  if (!recipients.length) return json({ sent: 0, reason: "No eligible recipients or event not authorized." });
  if (event === "courier_order_ready") {
    const notificationRows = recipients.map((recipientId) => ({
      user_id: recipientId,
      title,
      message,
      data: { order_id: order.id },
      created_at: new Date().toISOString(),
      is_read: false,
    }));
    const { error: notificationError } = await admin
      .from("notifications")
      .insert(notificationRows);
    if (notificationError) {
      console.error("Failed to create courier in-app notifications:", notificationError.message);
    }
  }
  const result = await deliverToUsers(
    admin,
    recipients,
    title,
    message,
    getOrderUrl(order.id),
    `misar-order-${order.id}-${event}`,
  );
  return json(result);
}

async function sendAnnouncement(
  admin: ReturnType<typeof getServiceClient>,
  title: string,
  message: string,
  recipientType: string,
  specificEmail?: string,
) {
  if (!title.trim() || title.length > 100 || !message.trim() || message.length > 500) {
    return json({ error: "Title (1-100 chars) and message (1-500 chars) are required." }, 400);
  }
  let query = admin.from("user_data").select("id");
  if (recipientType === "clients") query = query.eq("account_type", "client");
  else if (recipientType === "sellers") query = query.eq("account_type", "seller");
  else if (recipientType === "deliveries") query = query.eq("account_type", "delivery");
  else if (recipientType === "specific" && specificEmail) {
    query = query.eq("email", specificEmail.trim());
  } else if (recipientType !== "all") {
    return json({ error: "Unsupported announcement recipient group." }, 400);
  }

  const userIds: string[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data: users, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      console.error("Failed to load announcement recipients:", error.message);
      return json({ error: "Could not load announcement recipients." }, 500);
    }
    userIds.push(...(users || []).map((account) => account.id));
    if (!users || users.length < pageSize) break;
  }

  const totals = { sent: 0, failed: 0, recipients: userIds.length };
  const batchSize = 100;
  for (let offset = 0; offset < userIds.length; offset += batchSize) {
    const result = await deliverToUsers(
      admin,
      userIds.slice(offset, offset + batchSize),
      title.trim(),
      message.trim(),
      getAppUrl().href,
      "misar-announcement",
    );
    totals.sent += result.sent;
    totals.failed += result.failed;
  }
  return json(totals);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let admin: ReturnType<typeof getServiceClient>;
  try {
    admin = getServiceClient();
  } catch (error) {
    console.error("Push service configuration error:", error);
    return json({ error: "Push service is not configured." }, 500);
  }
  const user = await getAuthenticatedUser(req, admin);
  if (!user) return json({ error: "Authentication required." }, 401);

  let body: {
    action?: string;
    order_id?: string;
    event?: string;
    title?: string;
    message?: string;
    recipient_type?: string;
    specific_email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (body.action === "get_public_key") {
    try {
      return json({ public_key: getPushConfig().publicKey });
    } catch (error) {
      console.error("VAPID configuration error:", error);
      return json({ error: "Push notifications are not configured yet." }, 503);
    }
  }

  if (body.action === "notify_order_event" && body.event && body.order_id) {
    try {
      return await sendOrderEvent(admin, user.id, body.event, body.order_id);
    } catch (error) {
      console.error("Failed to send order Push:", error);
      return json({ error: "Could not send order notification." }, 500);
    }
  }

  if (body.action === "send_announcement") {
    const { data: account, error } = await admin
      .from("user_data")
      .select("account_type")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.error("Failed to verify announcement sender:", error.message);
      return json({ error: "Could not verify sender permissions." }, 500);
    }
    if (account?.account_type !== "founder") return json({ error: "Founder access required." }, 403);
    try {
      return await sendAnnouncement(
        admin,
        body.title || "",
        body.message || "",
        body.recipient_type || "",
        body.specific_email,
      );
    } catch (error) {
      console.error("Failed to send announcement Push:", error);
      return json({ error: "Could not send announcement Push." }, 500);
    }
  }

  return json({ error: "Unsupported action." }, 400);
});
