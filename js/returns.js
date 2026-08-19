// ============================================================
// returns.js - نظام إدارة المرتجعات (معدل لدعم الصور والقبول/الرفض)
// ============================================================

// ====== إنشاء طلب استرجاع مع صور ======
async function createReturn(orderId, productId, quantity, reason, notes = '', images = []) {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول أولاً', 'warning');
    return null;
  }

  // رفع الصور إن وجدت
  let imageUrls = [];
  if (images.length > 0) {
    try {
      for (const file of images) {
        const compressed = await compressImage(file, 1024, 1024, 0.8);
        const ext = file.name.split('.').pop();
        const uniqueName = `return-${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
        const filePath = `returns/${uniqueName}`;
        const { error: uploadError } = await supabaseClient.storage.from('return-images').upload(filePath, compressed);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabaseClient.storage.from('return-images').getPublicUrl(filePath);
        imageUrls.push(publicUrl);
      }
    } catch (err) {
      showToast('فشل رفع الصور: ' + err.message, 'error');
      return null;
    }
  }

  const { data, error } = await supabaseClient.rpc('create_return', {
    p_order_id: orderId,
    p_buyer_id: appState.user.id,
    p_product_id: productId,
    p_quantity: quantity,
    p_return_reason: reason,
    p_customer_notes: notes,
    p_images: imageUrls
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

// ====== جلب مرتجعات البائع (مع الصور) ======
async function loadSellerReturns(sellerId) {
  const { data, error } = await supabaseClient
    .from('returns')
    .select(`
      *,
      order:order_id (id, total_price),
      product:product_id (id, name, image_url, images),
      buyer:buyer_id (id, name, phone, image_url),
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

// ====== جلب طلبات الاسترجاع المتاحة للمندوبين (pending + approved) ======
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
    .in('status', ['pending', 'approved'])
    .order('requested_at', { ascending: true });

  if (error) {
    console.error('خطأ في جلب طلبات الاسترجاع المتاحة:', error);
    return [];
  }
  return data || [];
}

// ====== تحديث حالة طلب استرجاع (للمندوب والإدارة) ======
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

// ====== قبول الاسترجاع من البائع ======
async function approveReturn(returnId, sellerNotes = '') {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return false;
  }
  showLoading(true);
  try {
    const updates = {
      status: 'approved',
      reviewed_at: new Date(),
      reviewed_by: appState.user.id,
      seller_notes: sellerNotes || null,
      rejection_reason: null
    };
    const { error } = await supabaseClient
      .from('returns')
      .update(updates)
      .eq('id', returnId)
      .eq('seller_id', appState.user.id);

    if (error) throw error;

    // إشعار للعميل
    const { data: ret } = await supabaseClient.from('returns').select('buyer_id').eq('id', returnId).single();
    if (ret) {
      await sendNotification(
        ret.buyer_id,
        '✅ تم قبول طلب الاسترجاع',
        'تم قبول طلب الاسترجاع الخاص بك، سيتم التواصل معك لتحديد موعد الاستلام.'
      );
    }

    showToast('تم قبول الاسترجاع بنجاح', 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  } finally {
    showLoading(false);
  }
}

// ====== رفض الاسترجاع مع سبب إجباري ======
async function rejectReturn(returnId, rejectionReason) {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return false;
  }
  if (!rejectionReason || rejectionReason.trim() === '') {
    showToast('سبب الرفض مطلوب', 'warning');
    return false;
  }
  showLoading(true);
  try {
    const updates = {
      status: 'rejected',
      reviewed_at: new Date(),
      reviewed_by: appState.user.id,
      rejection_reason: rejectionReason.trim(),
      seller_notes: null
    };
    const { error } = await supabaseClient
      .from('returns')
      .update(updates)
      .eq('id', returnId)
      .eq('seller_id', appState.user.id);

    if (error) throw error;

    const { data: ret } = await supabaseClient.from('returns').select('buyer_id').eq('id', returnId).single();
    if (ret) {
      await sendNotification(
        ret.buyer_id,
        '❌ تم رفض طلب الاسترجاع',
        `تم رفض طلب الاسترجاع للسبب: ${rejectionReason}`
      );
    }

    showToast('تم رفض الاسترجاع', 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  } finally {
    showLoading(false);
  }
}

// ====== عرض حالة الاسترجاع (نص عربي) ======
function getReturnStatusText(status) {
  const map = {
    'pending': 'قيد الانتظار',
    'approved': 'تم القبول',
    'rejected': 'مرفوض',
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

// ====== استلام مهمة استرجاع من قبل المندوب ======
async function claimReturn(returnId) {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return;
  }
  showLoading(true);
  try {
    const success = await updateReturnStatus(returnId, 'assigned', { delivery_id: appState.user.id });
    if (success) {
      showToast('تم استلام المهمة بنجاح', 'success');
      await displayAvailableReturns();
      await displayMyReturns();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ====== تصدير الدوال ======
window.createReturn = createReturn;
window.loadMyReturns = loadMyReturns;
window.loadSellerReturns = loadSellerReturns;
window.loadDeliveryReturns = loadDeliveryReturns;
window.loadAvailableReturns = loadAvailableReturns;
window.updateReturnStatus = updateReturnStatus;
window.assignReturnToCourier = assignReturnToCourier;
window.approveReturn = approveReturn;
window.rejectReturn = rejectReturn;
window.getReturnStatusText = getReturnStatusText;
window.getReturnTimeRemaining = getReturnTimeRemaining;
window.claimReturn = claimReturn;