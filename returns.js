// ============================================================
// returns.js - نظام إدارة المرتجعات
// ============================================================

// ====== إنشاء طلب استرجاع ======
async function createReturn(orderId, productId, quantity, reason, notes = '') {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول أولاً', 'warning');
    return null;
  }

  const { data, error } = await supabaseClient.rpc('create_return', {
    p_order_id: orderId,
    p_buyer_id: appState.user.id,
    p_product_id: productId,
    p_quantity: quantity,
    p_return_reason: reason,
    p_customer_notes: notes
  });

  if (error) {
    console.error('❌ فشل إنشاء طلب استرجاع:', error);
    showToast(error.message || 'فشل إنشاء طلب الاسترجاع', 'error');
    return null;
  }

  showToast('✅ تم إنشاء طلب الاسترجاع بنجاح', 'success');
  return data;
}

// ====== جلب مرتجعات العميل ======
async function loadMyReturns() {
  if (!appState.user) return [];

  const { data, error } = await supabaseClient
    .from('returns')
    .select(`
      *,
      order:order_id (id, total_price, status),
      product:product_id (id, name, image_url),
      seller:seller_id (id, name, phone),
      delivery:delivery_id (id, name, phone)
    `)
    .eq('buyer_id', appState.user.id)
    .order('requested_at', { ascending: false });

  if (error) {
    console.error('خطأ في جلب مرتجعاتي:', error);
    return [];
  }
  return data || [];
}

// ====== جلب مرتجعات البائع ======
async function loadSellerReturns(sellerId) {
  const { data, error } = await supabaseClient
    .from('returns')
    .select(`
      *,
      order:order_id (id, total_price),
      product:product_id (id, name, image_url),
      buyer:buyer_id (id, name, phone),
      delivery:delivery_id (id, name, phone)
    `)
    .eq('seller_id', sellerId)
    .order('requested_at', { ascending: false });

  if (error) {
    console.error('خطأ في جلب مرتجعات البائع:', error);
    return [];
  }
  return data || [];
}

// ====== جلب مهام الاسترجاع للمندوب ======
async function loadDeliveryReturns(deliveryId) {
  const { data, error } = await supabaseClient
    .from('returns')
    .select(`
      *,
      order:order_id (id, total_price, shipping_address),
      product:product_id (id, name, image_url),
      buyer:buyer_id (id, name, phone, address),
      seller:seller_id (id, name, phone, address)
    `)
    .eq('delivery_id', deliveryId)
    .order('requested_at', { ascending: false });

  if (error) {
    console.error('خطأ في جلب مهام الاسترجاع:', error);
    return [];
  }
  return data || [];
}

// ====== جلب طلبات الاسترجاع المتاحة للمندوبين ======
async function loadAvailableReturns() {
  const { data, error } = await supabaseClient
    .from('returns')
    .select(`
      *,
      order:order_id (id, total_price, shipping_address),
      product:product_id (id, name, image_url),
      buyer:buyer_id (id, name, phone, address),
      seller:seller_id (id, name, phone, address)
    `)
    .is('delivery_id', null)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });

  if (error) {
    console.error('خطأ في جلب طلبات الاسترجاع المتاحة:', error);
    return [];
  }
  return data || [];
}

// ====== تحديث حالة طلب استرجاع ======
async function updateReturnStatus(returnId, newStatus, extraData = {}) {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return false;
  }

  const updates = { status: newStatus, updated_at: new Date() };

  if (newStatus === 'assigned') {
    updates.delivery_id = appState.user.id;
  } else if (newStatus === 'picked_up_from_customer') {
    updates.picked_up_from_customer_at = new Date();
  } else if (newStatus === 'delivered_to_seller') {
    updates.delivered_to_seller_at = new Date();
  } else if (newStatus === 'cancelled') {
    updates.cancelled_at = new Date();
  }

  Object.assign(updates, extraData);

  const { error } = await supabaseClient
    .from('returns')
    .update(updates)
    .eq('id', returnId);

  if (error) {
    console.error('❌ فشل تحديث حالة الاسترجاع:', error);
    showToast(error.message || 'فشل تحديث الحالة', 'error');
    return false;
  }

  showToast('✅ تم تحديث الحالة بنجاح', 'success');
  return true;
}

// ====== تعيين مندوب لطلب استرجاع ======
async function assignReturnToCourier(returnId, courierId) {
  return await updateReturnStatus(returnId, 'assigned', { delivery_id: courierId });
}

// ====== عرض حالة الاسترجاع (نص عربي) ======
function getReturnStatusText(status) {
  const map = {
    'pending': 'قيد الانتظار',
    'assigned': 'تم تعيين مندوب',
    'courier_on_way_to_customer': 'المندوب في طريقه للعميل',
    'picked_up_from_customer': 'تم استلام المنتج من العميل',
    'courier_on_way_to_seller': 'المندوب في طريقه للبائع',
    'delivered_to_seller': 'تم تسليم المنتج للبائع',
    'completed': 'تم الاسترجاع بنجاح',
    'cancelled': 'ملغي',
    'failed': 'فشل في التنفيذ'
  };
  return map[status] || status;
}

// ====== حساب الوقت المتبقي للاسترجاع ======
function getReturnTimeRemaining(order) {
  if (!order || order.status !== 'delivered' || !order.delivered_at) return null;

  const delivered = new Date(order.delivered_at);
  const expiry = new Date(delivered.getTime() + 5 * 60 * 60 * 1000);
  const now = new Date();
  const diff = expiry - now;

  if (diff <= 0) return null;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ====== تصدير الدوال ======
window.createReturn = createReturn;
window.loadMyReturns = loadMyReturns;
window.loadSellerReturns = loadSellerReturns;
window.loadDeliveryReturns = loadDeliveryReturns;
window.loadAvailableReturns = loadAvailableReturns;
window.updateReturnStatus = updateReturnStatus;
window.assignReturnToCourier = assignReturnToCourier;
window.getReturnStatusText = getReturnStatusText;
window.getReturnTimeRemaining = getReturnTimeRemaining;