// ============================================================
// returns.js - نظام إدارة المرتجعات (معدل لدعم الصور والقبول/الرفض)
// ============================================================

// دالة مساعدة لتأمين النصوص
function escHTML(str) {
  if (typeof escapeHTML === 'function') return escapeHTML(str);
  if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
  return String(str || '').replace(/[&<>"']/g, function(m) {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

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
        let uploadBlob = file;
        if (typeof compressImage === 'function') {
          try { uploadBlob = await compressImage(file, 1024, 1024, 0.8); } catch (e) { uploadBlob = file; }
        }
        const ext = file.name ? file.name.split('.').pop() : 'jpg';
        const uniqueName = `return-${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
        const filePath = `returns/${uniqueName}`;
        const { error: uploadError } = await supabaseClient.storage.from('return-images').upload(filePath, uploadBlob);
        if (!uploadError) {
          const { data: { publicUrl } } = supabaseClient.storage.from('return-images').getPublicUrl(filePath);
          if (publicUrl) imageUrls.push(publicUrl);
        } else {
          console.warn('تحذير أثناء رفع صورة الاسترجاع:', uploadError);
        }
      }
    } catch (err) {
      console.warn('فشل رفع الصور:', err);
    }
  }

  try {
    // 1. محاولة استخدام الـ RPC إن كان موجوداً
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('create_return', {
      p_order_id: orderId,
      p_buyer_id: appState.user.id,
      p_product_id: productId,
      p_quantity: quantity,
      p_return_reason: reason,
      p_customer_notes: notes,
      p_images: imageUrls
    });

    if (!rpcError && rpcData) {
      showToast('✅ تم إنشاء طلب الاسترجاع بنجاح', 'success');
      return rpcData;
    }

    // 2. خطة بديلة: الإدراج المباشر في جدول returns
    const { data: orderData } = await supabaseClient
      .from('orders')
      .select('seller_id')
      .eq('id', orderId)
      .maybeSingle();

    const insertPayload = {
      order_id: orderId,
      buyer_id: appState.user.id,
      product_id: productId,
      seller_id: orderData?.seller_id || null,
      quantity: Number(quantity) || 1,
      return_reason: reason,
      customer_notes: notes || null,
      images: imageUrls,
      status: 'pending',
      return_fee: 20,
      requested_at: new Date().toISOString()
    };

    const { data: directData, error: directError } = await supabaseClient
      .from('returns')
      .insert(insertPayload)
      .select()
      .maybeSingle();

    if (directError) throw directError;

    // إشعار للبائع
    if (insertPayload.seller_id && typeof sendNotification === 'function') {
      try {
        await sendNotification(
          insertPayload.seller_id,
          '📦 طلب استرجاع جديد',
          `تم تقديم طلب استرجاع جديد على الطلب #${orderId.slice(0, 8)}`,
          { order_id: orderId, return_id: directData?.id }
        );
      } catch (e) { console.warn('Notification error:', e); }
    }

    showToast('✅ تم إنشاء طلب الاسترجاع بنجاح', 'success');
    return directData || true;
  } catch (error) {
    console.error('❌ فشل إنشاء طلب استرجاع:', error);
    showToast(error.message || 'فشل إنشاء طلب الاسترجاع', 'error');
    return null;
  }
}

// ====== دالة مساعدة لربط بيانات المرتجعات ======
async function enrichReturnsData(returns) {
  if (!returns || !returns.length) return [];
  try {
    const productIds = [...new Set(returns.map(r => r.product_id).filter(Boolean))];
    const orderIds = [...new Set(returns.map(r => r.order_id).filter(Boolean))];

    // 1. جلب المنتجات والطلبات أولاً
    const [productsRes, ordersRes] = await Promise.all([
      productIds.length ? supabaseClient.from('products').select('*').in('id', productIds) : { data: [] },
      // نجلب الأعمدة المؤكدة فقط، مع seller_* المحفوظة في الطلب لبيانات البائع.
      orderIds.length ? supabaseClient.from('orders').select(
        'id, buyer_id, seller_id, product_id, quantity, total_price, status, center, delivery_center, created_at, customer_name, customer_phone, shipping_address, seller_name, seller_phone, seller_address, seller_center, seller_governorate'
      ).in('id', orderIds) : { data: [] }
    ]);

    const productMap = new Map((productsRes.data || []).map(p => [p.id, p]));
    const orderMap = new Map((ordersRes.data || []).map(o => [o.id, o]));

    // 2. تجميع معرفات جميع المستخدمين (المشتري، البائع، المندوب) مع استخراج معرف البائع من الطلب أو المنتج إذا كان ناقصاً
    const userIdsSet = new Set();
    returns.forEach(r => {
      const order = orderMap.get(r.order_id);
      const prod = productMap.get(r.product_id);
      const sellerId = r.seller_id || (order && order.seller_id) || (prod && prod.user_id);
      const buyerId = r.buyer_id || (order && order.buyer_id);

      if (sellerId) {
        r.seller_id = sellerId;
        userIdsSet.add(sellerId);
      }
      if (buyerId) {
        r.buyer_id = buyerId;
        userIdsSet.add(buyerId);
      }
      if (r.delivery_id) {
        userIdsSet.add(r.delivery_id);
      }
    });

    // جدول user_data لا يحتوي على كل الأعمدة التي كان الكود يطلبها (village وغيرها)،
    // وطلب عمود غير موجود يُفشل الاستعلام بالكامل فيرجع فارغاً وتظهر "غير متوفر".
    // نستخدم نفس الاستراتيجية المُثبتة في صفحة المندوب: أعمدة مؤكدة،
    // ثم نتدرج للبدائل، ثم نعتمد على seller_* المحفوظة داخل orders.
    const userIds = [...userIdsSet];
    let userMap = new Map();
    if (userIds.length) {
      const columnSets = [
        'id, name, phone, image_url, center, governorate, address, username',
        'id, name, phone, image_url, center, governorate, address',
        'id, name, phone, center, governorate, address',
        'id, name, phone, address',
        'id, name, phone'
      ];
      for (const columns of columnSets) {
        const { data, error } = await supabaseClient
          .from('user_data')
          .select(columns)
          .in('id', userIds);
        if (!error) {
          userMap = new Map((data || []).map(u => [u.id, u]));
          break;
        }
      }
    }

    returns.forEach(r => {
      const order = orderMap.get(r.order_id) || {};
      const prod = productMap.get(r.product_id) || {};
      const sellerId = r.seller_id || order.seller_id || prod.user_id;
      const buyerId = r.buyer_id || order.buyer_id;
      const sellerFromProfile = sellerId ? userMap.get(sellerId) : null;

      r.product = prod.id ? prod : { name: 'منتج غير معروف', image_url: null };
      r.order = order;
      r.buyer = userMap.get(buyerId) || { name: order.customer_name, phone: order.customer_phone, address: order.shipping_address };
      // بيانات البائع: الأولوية لـ snapshot المخزنة في الطلب (seller_*)،
      // ثم بيانات user_data إن كانت متاحة، مع إبقاء seller_id ليعمل زر المتجر.
      r.seller = {
        ...(sellerFromProfile || {}),
        id: sellerId || null,
        name: (sellerFromProfile && sellerFromProfile.name) || order.seller_name || null,
        phone: (sellerFromProfile && sellerFromProfile.phone) || order.seller_phone || null,
        center: (sellerFromProfile && sellerFromProfile.center) || order.seller_center || order.delivery_center || order.center || null,
        governorate: (sellerFromProfile && sellerFromProfile.governorate) || order.seller_governorate || null,
        address: (sellerFromProfile && sellerFromProfile.address) || order.seller_address || null
      };
      r.delivery = userMap.get(r.delivery_id) || {};
    });
  } catch (enrichErr) {
    console.warn('تحذير أثناء إثراء بيانات المرتجعات:', enrichErr);
  }
  return returns;
}

// ====== جلب مرتجعات العميل ======
async function loadMyReturns() {
  if (!appState.user) return [];
  try {
    const { data, error } = await supabaseClient
      .from('returns')
      .select('*')
      .eq('buyer_id', appState.user.id)
      .order('requested_at', { ascending: false });

    if (error) throw error;
    return await enrichReturnsData(data || []);
  } catch (error) {
    console.error('خطأ في جلب مرتجعاتي:', error);
    return [];
  }
}

// ====== جلب طلبات الاسترجاع الخاصة ببائع معين ======
async function loadSellerReturns(sellerId) {
  if (!sellerId) return [];
  try {
    // 1. جلب المرتجعات بالـ seller_id المباشر
    const { data: directReturns, error: directErr } = await supabaseClient
      .from('returns')
      .select('*')
      .eq('seller_id', sellerId)
      .order('requested_at', { ascending: false });

    // 2. جلب طلبات البائع للحصول على order_ids تحسباً لعدم تعبئة seller_id في جدول returns
    const { data: sellerOrders } = await supabaseClient
      .from('orders')
      .select('id')
      .eq('seller_id', sellerId);

    const orderIds = (sellerOrders || []).map(o => o.id).filter(Boolean);
    let orderReturns = [];
    if (orderIds.length > 0) {
      const { data: ordRet } = await supabaseClient
        .from('returns')
        .select('*')
        .in('order_id', orderIds)
        .order('requested_at', { ascending: false });
      orderReturns = ordRet || [];
    }

    // دمج السجلات مع إزالة التكرار
    const combinedMap = new Map();
    (directReturns || []).forEach(r => combinedMap.set(r.id, r));
    orderReturns.forEach(r => combinedMap.set(r.id, r));

    const combined = Array.from(combinedMap.values());
    combined.sort((a, b) => new Date(b.requested_at || 0) - new Date(a.requested_at || 0));

    return await enrichReturnsData(combined);
  } catch (error) {
    console.error('❌ خطأ في جلب مرتجعات البائع:', error);
    return [];
  }
}

// ====== جلب جميع طلبات الاسترجاع للمؤسس ======
async function loadAllReturnsForFounder() {
  try {
    const { data, error } = await supabaseClient
      .from('returns')
      .select('*')
      .order('requested_at', { ascending: false });

    if (error) throw error;
    return await enrichReturnsData(data || []);
  } catch (error) {
    console.error('❌ خطأ في جلب جميع المرتجعات للمؤسس:', error);
    return [];
  }
}

// ====== مسح وإخفاء المعاملات للمندوب ======
function getHiddenReturns() {
  if (!appState.user) return [];
  try {
    const key = `hidden_delivery_returns_${appState.user.id}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    return [];
  }
}

function hideReturnForCourier(returnId) {
  if (!appState.user) return;
  try {
    const key = `hidden_delivery_returns_${appState.user.id}`;
    const list = getHiddenReturns();
    if (!list.includes(returnId)) {
      list.push(returnId);
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch (e) {
    console.warn('Error saving hidden return:', e);
  }
}

function deleteDeliveryReturnFromView(returnId) {
  if (!confirm('هل تريد مسح هذه المهمة من قائمتك؟')) return;
  hideReturnForCourier(returnId);
  if (typeof displayDeliveryReturns === 'function') displayDeliveryReturns();
  showToast('تم مسح المهمة من قائمتك', 'success');
}

function clearCompletedDeliveryReturns() {
  if (!confirm('هل تريد مسح جميع مهام الاسترجاع المكتملة من قائمتك؟')) return;
  const list = appState.delivery?.myReturns || [];
  let clearedCount = 0;
  list.forEach(ret => {
    if (ret.status === 'completed' || ret.status === 'delivered_to_seller' || ret.status === 'cancelled') {
      hideReturnForCourier(ret.id);
      clearedCount++;
    }
  });
  if (typeof displayDeliveryReturns === 'function') displayDeliveryReturns();
  if (clearedCount > 0) {
    showToast(`تم مسح ${clearedCount} مهمة مكتملة من قائمتك بنجاح`, 'success');
  } else {
    showToast('لا توجد مهام مكتملة لمسحها', 'info');
  }
}

// ====== جلب مهام الاسترجاع للمندوب ======
async function loadDeliveryReturns(deliveryId) {
  if (!deliveryId) return [];
  try {
    const { data, error } = await supabaseClient
      .from('returns')
      .select('*')
      .eq('delivery_id', deliveryId)
      .order('requested_at', { ascending: false });

    if (error) throw error;
    const enriched = await enrichReturnsData(data || []);
    const hidden = getHiddenReturns();
    return enriched.filter(r => !hidden.includes(r.id));
  } catch (error) {
    console.error('خطأ في جلب مهام الاسترجاع:', error);
    return [];
  }
}

// ====== جلب طلبات الاسترجاع المتاحة للمندوبين (بعد موافقة البائع فقط) ======
async function loadAvailableReturns() {
  try {
    const { data, error } = await supabaseClient
      .from('returns')
      .select('*')
      .is('delivery_id', null)
      .eq('status', 'approved') // يظهر للمندوب فقط بعد موافقة البائع
      .order('requested_at', { ascending: true });

    if (error) throw error;
    return await enrichReturnsData(data || []);
  } catch (error) {
    console.error('خطأ في جلب طلبات الاسترجاع المتاحة:', error);
    return [];
  }
}

// ====== تحديث حالة طلب استرجاع (مع تسجيل التوقيت ومنع تخطي المراحل) ======
async function updateReturnStatus(returnId, newStatus, extraData = {}) {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return false;
  }

  try {
    // محاولة استدعاء الدالة على الخادم لضمان تسجيل الوقت من الخادم ومنع تخطي المراحل
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('update_return_stage', {
      p_return_id: returnId,
      p_new_status: newStatus,
      p_courier_id: appState.user.id
    });

    if (rpcError) {
      // تنفيذ التحديث المباشر مع تسجيل التوقيت كخطة متوافقة
      const now = new Date();
      const updates = { status: newStatus, updated_at: now };

      if (newStatus === 'assigned') {
        updates.delivery_id = appState.user.id;
        updates.assigned_at = now;
      } else if (newStatus === 'courier_on_way_to_customer') {
        updates.courier_on_way_to_customer_at = now;
      } else if (newStatus === 'picked_up_from_customer') {
        updates.picked_up_from_customer_at = now;
      } else if (newStatus === 'courier_on_way_to_seller') {
        updates.courier_on_way_to_seller_at = now;
      } else if (newStatus === 'delivered_to_seller') {
        updates.delivered_to_seller_at = now;
      } else if (newStatus === 'completed') {
        updates.completed_at = now;
      } else if (newStatus === 'cancelled') {
        updates.cancelled_at = now;
      }

      Object.assign(updates, extraData);

      const { error: updateError } = await supabaseClient
        .from('returns')
        .update(updates)
        .eq('id', returnId);

      if (updateError) throw updateError;
    }

    showToast('✅ تم تحديث مرحلة الاسترجاع بنجاح', 'success');
    return true;
  } catch (err) {
    console.error('❌ فشل تحديث حالة الاسترجاع:', err);
    showToast(err.message || 'فشل تحديث المرحلة', 'error');
    return false;
  }
}

// ====== تعيين مندوب لطلب استرجاع ======
async function assignReturnToCourier(returnId, courierId) {
  return await updateReturnStatus(returnId, 'assigned', { delivery_id: courierId });
}

// ====== التحقق من أن البائع الحالي يملك طلب الاسترجاع فعلاً ======
// يعالج حالة كون seller_id في جدول returns فارغاً (null) بينما البائع
// صاحب الطلب معروف فقط عبر orders.seller_id.
async function sellerOwnsReturn(returnId, sellerId) {
  try {
    const { data: ret } = await supabaseClient
      .from('returns')
      .select('id, seller_id, order_id')
      .eq('id', returnId)
      .maybeSingle();
    if (!ret) return false;
    if (ret.seller_id && ret.seller_id === sellerId) return true;
    if (ret.order_id) {
      const { data: ord } = await supabaseClient
        .from('orders')
        .select('seller_id')
        .eq('id', ret.order_id)
        .maybeSingle();
      if (ord && ord.seller_id === sellerId) return true;
    }
    return false;
  } catch (e) {
    console.warn('تعذّر التحقق من ملكية الاسترجاع:', e);
    return false;
  }
}

// ====== تنفيذ تحديث على المرتجع مع كشف الحقيقي عن النجاح ======
// يعيد عدد السجلات المتأثرة فعلياً (وليس مجرد عدم وجود خطأ).
async function applyReturnUpdate(returnId, sellerId, updates) {
  // دالة داخلية للتحقق من تطبيق الحالة فعلاً حتى لو منعت RLS قراءة السطر عائداً
  const verifyApplied = async () => {
    if (!updates.status) return false;
    const { data } = await supabaseClient
      .from('returns')
      .select('id, status')
      .eq('id', returnId)
      .maybeSingle();
    return !!(data && data.status === updates.status);
  };

  // 1) محاولة التحديث المقيّد بالبائع (المسار الآمن الافتراضي)
  let { data, error } = await supabaseClient
    .from('returns')
    .update(updates)
    .eq('id', returnId)
    .eq('seller_id', sellerId)
    .select('id');

  if (error) throw error;
  if (data && data.length > 0) return data.length;
  // لا سطر عائد: إما لا يوجد تطابق (seller_id فارغ) أو RLS لا يعيد القراءة
  if (await verifyApplied()) return 1;

  // 2) لم ينجح التحديث المقيّد: نتحقق من الملكية عبر الطلب ثم نحدّث بالمعرّف فقط
  const owns = await sellerOwnsReturn(returnId, sellerId);
  if (!owns) {
    const permErr = new Error('لا يمكنك تعديل هذا الطلب — لا تملك صلاحية عليه.');
    permErr.code = 'no_permission';
    throw permErr;
  }

  ({ data, error } = await supabaseClient
    .from('returns')
    .update({ ...updates })
    .eq('id', returnId)
    .select('id'));

  if (error) throw error;
  if (data && data.length > 0) return data.length;
  // تحقق نهائي عبر إعادة قراءة الحالة
  return (await verifyApplied()) ? 1 : 0;
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
    const affected = await applyReturnUpdate(returnId, appState.user.id, updates);

    if (!affected) {
      showToast('تعذّر تحديث الطلب — لم يتم العثور على مرتجع مطابق.', 'error');
      return false;
    }

    // إشعار للعميل
    const { data: ret } = await supabaseClient.from('returns').select('buyer_id').eq('id', returnId).maybeSingle();
    if (ret && ret.buyer_id) {
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
    const affected = await applyReturnUpdate(returnId, appState.user.id, updates);

    if (!affected) {
      showToast('تعذّر تحديث الطلب — لم يتم العثور على مرتجع مطابق.', 'error');
      return false;
    }

    const { data: ret } = await supabaseClient.from('returns').select('buyer_id').eq('id', returnId).maybeSingle();
    if (ret && ret.buyer_id) {
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
    'pending': 'قيد انتظار موافقة البائع',
    'approved': 'تمت موافقة البائع (متاح للمندوب)',
    'rejected': 'مرفوض من البائع',
    'assigned': 'تم استلام المهمة (بانتظار التوجه)',
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
      showToast('✅ تم استلام المهمة بنجاح وانتقالها لمهامك الخاصة', 'success');
      if (typeof displayDeliveryReturns === 'function') await displayDeliveryReturns();
      if (typeof refreshDeliveryDashboard === 'function') await refreshDeliveryDashboard();
      if (typeof switchDeliveryTab === 'function') {
        switchDeliveryTab('my_returns');
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ====== تحديث حالة الاسترجاع بواسطة المندوب ======
async function updateReturnByCourier(returnId, status) {
  if (!appState.user) {
    showToast('يجب تسجيل الدخول', 'warning');
    return;
  }
  showLoading(true);
  try {
    const success = await updateReturnStatus(returnId, status);
    if (success) {
      if (typeof displayDeliveryReturns === 'function') await displayDeliveryReturns();
      if (typeof refreshDeliveryDashboard === 'function') await refreshDeliveryDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ====== عرض طلبات ومهام الاسترجاع في لوحة المندوب ======
async function displayDeliveryReturns() {
  if (!appState.user || appState.userData.account_type !== 'delivery') return;

  const availContainer = document.getElementById('availableReturnsList');
  const myContainer = document.getElementById('myDeliveryReturnsList');

  try {
    const [availableReturns, myReturns] = await Promise.all([
      loadAvailableReturns(),
      loadDeliveryReturns(appState.user.id)
    ]);

    const availCount = availableReturns ? availableReturns.length : 0;
    const myCount = myReturns ? myReturns.length : 0;

    // تحديث أعداد المرتجعات في الإحصائيات والتبويبات
    const availStatEl = document.getElementById('availableReturnsCount');
    if (availStatEl) availStatEl.textContent = availCount;

    const availTabEl = document.getElementById('availableReturnsTabCount');
    if (availTabEl) availTabEl.textContent = availCount;

    const myStatEl = document.getElementById('myReturnsCount');
    if (myStatEl) myStatEl.textContent = myCount;

    const myTabEl = document.getElementById('myReturnsTabCount');
    if (myTabEl) myTabEl.textContent = myCount;

    const totalCountEl = document.getElementById('deliveryReturnsCount');
    if (totalCountEl) totalCountEl.textContent = availCount + myCount;

    // 1. عرض المرتجعات المتاحة
    if (availContainer) {
      if (availCount === 0) {
        availContainer.innerHTML = `
          <div style="text-align:center; padding:40px; color:#999;">
            <i class="fas fa-box-open" style="font-size:2.5rem; margin-bottom:10px;"></i>
            <p>لا توجد مرتجعات متاحة حالياً</p>
          </div>
        `;
      } else {
        let availHtml = '';
        availableReturns.forEach(ret => {
          const prod = ret.product || {};
          const buyer = ret.buyer || {};
          const seller = ret.seller || {};
          const order = ret.order || {};

          const sellerName = seller.name || seller.full_name || '';
          const sellerPhone = seller.phone || '';
          const sellerAddress = [seller.governorate, seller.center, seller.village, seller.address].filter(Boolean).join(' - ') || seller.address || seller.center || '';
          const sellerImage = seller.image_url ? `<img src="${seller.image_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:1.1rem; color:#f57c00;"></i>';
          const sellerId = seller.id || ret.seller_id;

          const buyerName = buyer.name || order.customer_name || '';
          const buyerPhone = buyer.phone || order.customer_phone || '';
          const buyerAddress = order.shipping_address || [buyer.governorate, buyer.center, buyer.village, buyer.address].filter(Boolean).join(' - ') || buyer.address || '';
          const buyerImage = buyer.image_url ? `<img src="${buyer.image_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-user" style="font-size:1.1rem; color:#1976d2;"></i>';

          const returnFee = ret.return_fee || 20;

          const imagesHtml = ret.images && ret.images.length > 0
            ? `<div class="return-images-preview" style="margin-top:8px;">${ret.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModal('${img}')" style="width:50px;height:50px;object-fit:cover;border-radius:6px;margin:2px;cursor:pointer;">`).join('')}</div>`
            : '';

          availHtml += `
            <div class="order-card" style="border-right: 4px solid #ff9800; margin-bottom:15px;">
              <div class="order-header">
                <span class="order-id">#${ret.id.slice(0,8)} (استرجاع)</span>
                <span class="order-status ${ret.status}">${getReturnStatusText(ret.status)}</span>
              </div>
              <div class="order-product">
                <div class="order-product-image">
                  ${prod.image_url ? `<img src="${prod.image_url}" loading="lazy">` : '📦'}
                </div>
                <div class="order-product-details">
                  <div><strong>${escapeHTML(prod.name || 'منتج')}</strong></div>
                  <div>الكمية المطلوب استرجاعها: <strong>${ret.quantity}</strong></div>
                  <div style="color:#d32f2f;">السبب: ${escapeHTML(ret.return_reason || 'غير محدد')}</div>
                  ${ret.customer_notes ? `<div style="font-size:0.8rem; color:#777;">ملاحظات: ${escapeHTML(ret.customer_notes)}</div>` : ''}
                </div>
              </div>

              ${imagesHtml}

              <!-- معلومات البائع -->
              <div style="margin-top:10px; padding:12px; background:#fef8e8; border-radius:8px; border:1px solid #ffe0b2;">
                <div style="font-weight:bold; color:#f57c00; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                  <span><i class="fas fa-store"></i> جهة التسليم (البائع):</span>
                  ${sellerId ? `<button type="button" onclick="showStorePage('${sellerId}')" style="background:#4caf50; color:#fff; border:none; padding:3px 10px; border-radius:6px; font-size:0.8rem; cursor:pointer; font-weight:bold;"><i class="fas fa-store"></i> المتجر</button>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.95rem; margin-bottom:5px;">
                  ${sellerImage}
                  <span><strong>الاسم:</strong> ${escapeHTML(sellerName)}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📞 رقم هاتف البائع:</strong> ${sellerPhone ? `<a href="tel:${sellerPhone}" style="color:#1a237e; font-weight:bold; direction:ltr; display:inline-block; font-size:1rem;">${escapeHTML(sellerPhone)}</a>` : ''}</span>
                  ${sellerPhone ? `
                    <a href="tel:${sellerPhone}" style="background:#1a237e; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${sellerPhone}" target="_blank" style="background:#25D366; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                </div>
                <div style="font-size:0.85rem; color:#555; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📍 عنوان البائع:</strong> ${escapeHTML(sellerAddress)}</span>
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(sellerAddress)}" target="_blank" style="background:#ff5722; color:#fff; padding:2px 8px; border-radius:4px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
                </div>
              </div>

              <!-- معلومات العميل -->
              <div style="margin-top:8px; padding:12px; background:#f5f7fa; border-radius:8px; border:1px solid #e0e0e0;">
                <div style="font-weight:bold; color:#1976d2; margin-bottom:6px;"><i class="fas fa-user"></i> جهة الاستلام (العميل):</div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.95rem; margin-bottom:5px;">
                  ${buyerImage}
                  <span><strong>الاسم:</strong> ${escapeHTML(buyerName)}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📞 رقم هاتف العميل:</strong> ${buyerPhone ? `<a href="tel:${buyerPhone}" style="color:#1a237e; font-weight:bold; direction:ltr; display:inline-block; font-size:1rem;">${escapeHTML(buyerPhone)}</a>` : ''}</span>
                  ${buyerPhone ? `
                    <a href="tel:${buyerPhone}" style="background:#1a237e; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${buyerPhone}" target="_blank" style="background:#25D366; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                </div>
                <div style="font-size:0.85rem; color:#555; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📍 عنوان العميل:</strong> ${escapeHTML(buyerAddress)}</span>
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(buyerAddress)}" target="_blank" style="background:#ff5722; color:#fff; padding:2px 8px; border-radius:4px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
                </div>
              </div>

              <!-- صندوق أجرة التوصيل -->
              <div style="margin:10px 0; padding:10px 14px; background:#e8f5e9; border-radius:8px; border:1px solid #81c784; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:bold; color:#2e7d32; font-size:0.95rem;"><i class="fas fa-hand-holding-usd"></i> المبلغ المستحق لك (أجرة التوصيل):</div>
                  <div style="font-size:0.8rem; color:#555;">يتحملها العميل (${returnFee} ج.م) وتُحصل عند استلام المرتجع</div>
                </div>
                <div style="font-weight:900; color:#1b5e20; font-size:1.3rem;">${returnFee} ج.م</div>
              </div>

              <div style="margin-top:12px;">
                <button class="add-to-cart" onclick="claimReturn('${ret.id}')" style="background:#ff9800; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                  <i class="fas fa-hand-holding-box"></i> استلام مهمة الاسترجاع (${returnFee} ج.م)
                </button>
              </div>
            </div>
          `;
        });
        availContainer.innerHTML = availHtml;
      }
    }

    // 2. عرض مهام الاسترجاع الخاصة بالمندوب
    if (myContainer) {
      if (myCount === 0) {
        myContainer.innerHTML = `
          <div style="text-align:center; padding:40px; color:#999;">
            <i class="fas fa-undo-alt" style="font-size:2.5rem; margin-bottom:10px;"></i>
            <p>لا توجد مهام استرجاع خاصة بك حالياً</p>
          </div>
        `;
      } else {
        let myHtml = '';
        myReturns.forEach(ret => {
          const prod = ret.product || {};
          const buyer = ret.buyer || {};
          const seller = ret.seller || {};
          const order = ret.order || {};

          const sellerName = seller.name || seller.full_name || '';
          const sellerPhone = seller.phone || '';
          const sellerAddress = [seller.governorate, seller.center, seller.village, seller.address].filter(Boolean).join(' - ') || seller.address || seller.center || '';
          const sellerImage = seller.image_url ? `<img src="${seller.image_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:1.1rem; color:#f57c00;"></i>';
          const sellerId = seller.id || ret.seller_id;

          const buyerName = buyer.name || order.customer_name || '';
          const buyerPhone = buyer.phone || order.customer_phone || '';
          const buyerAddress = order.shipping_address || [buyer.governorate, buyer.center, buyer.village, buyer.address].filter(Boolean).join(' - ') || buyer.address || '';
          const buyerImage = buyer.image_url ? `<img src="${buyer.image_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-user" style="font-size:1.1rem; color:#1976d2;"></i>';

          const returnFee = ret.return_fee || 20;

          let actionBtns = '';
          if (ret.status === 'assigned') {
            actionBtns = `
              <button class="add-to-cart" onclick="updateReturnByCourier('${ret.id}', 'courier_on_way_to_customer')" style="background:#1976d2; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                <i class="fas fa-motorcycle"></i> المرحلة 1: التوجه للعميل
              </button>
            `;
          } else if (ret.status === 'courier_on_way_to_customer') {
            actionBtns = `
              <button class="add-to-cart" onclick="updateReturnByCourier('${ret.id}', 'picked_up_from_customer')" style="background:#ff9800; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                <i class="fas fa-box-check"></i> المرحلة 2: تم استلام المنتج من العميل (${returnFee} ج.م)
              </button>
            `;
          } else if (ret.status === 'picked_up_from_customer') {
            actionBtns = `
              <button class="add-to-cart" onclick="updateReturnByCourier('${ret.id}', 'courier_on_way_to_seller')" style="background:#0288d1; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                <i class="fas fa-truck-loading"></i> المرحلة 3: التوجه للبائع لتسليم المرتجع
              </button>
            `;
          } else if (ret.status === 'courier_on_way_to_seller') {
            actionBtns = `
              <button class="add-to-cart" onclick="updateReturnByCourier('${ret.id}', 'delivered_to_seller')" style="background:#388e3c; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                <i class="fas fa-store"></i> المرحلة 4: تم تسليم المنتج للبائع
              </button>
            `;
          } else if (ret.status === 'delivered_to_seller') {
            actionBtns = `
              <button class="add-to-cart" onclick="updateReturnByCourier('${ret.id}', 'completed')" style="background:#1b5e20; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                <i class="fas fa-check-double"></i> المرحلة 5: تأكيد إتمام الاسترجاع بالكامل
              </button>
            `;
          } else if (ret.status === 'completed') {
            actionBtns = `
              <div style="color:#1b5e20; font-weight:bold; text-align:center; padding:12px; background:#e8f5e9; border-radius:8px; border:1px solid #81c784; font-size:1rem;">
                <i class="fas fa-check-circle"></i> تم إتمام الاسترجاع بنجاح في جميع المراحل
              </div>
              <button onclick="deleteDeliveryReturnFromView('${ret.id}')" style="background:#d32f2f; color:#fff; border:none; padding:8px 12px; border-radius:6px; margin-top:8px; width:100%; cursor:pointer; font-weight:bold;">
                <i class="fas fa-trash-alt"></i> مسح المهمة من القائمة
              </button>
            `;
          }

          let timestampsHtml = `
            <div style="font-size:0.8rem; color:#666; margin-top:8px; line-height:1.6; border-top:1px dashed #ddd; padding-top:6px;">
              ${ret.assigned_at ? `<div>🕒 <strong>استلام المهمة:</strong> ${new Date(ret.assigned_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
              ${ret.courier_on_way_to_customer_at ? `<div>🕒 <strong>بدء التوجه للعميل:</strong> ${new Date(ret.courier_on_way_to_customer_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
              ${ret.picked_up_from_customer_at ? `<div>🕒 <strong>استلام المنتج من العميل:</strong> ${new Date(ret.picked_up_from_customer_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
              ${ret.courier_on_way_to_seller_at ? `<div>🕒 <strong>بدء التوجه للبائع:</strong> ${new Date(ret.courier_on_way_to_seller_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
              ${ret.delivered_to_seller_at ? `<div>🕒 <strong>تسليم البائع:</strong> ${new Date(ret.delivered_to_seller_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
              ${ret.completed_at ? `<div>🕒 <strong>الإتمام النهائي:</strong> ${new Date(ret.completed_at).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</div>` : ''}
            </div>
          `;

          const imagesHtml = ret.images && ret.images.length > 0
            ? `<div class="return-images-preview" style="margin-top:8px;">${ret.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModal('${img}')" style="width:50px;height:50px;object-fit:cover;border-radius:6px;margin:2px;cursor:pointer;">`).join('')}</div>`
            : '';

          myHtml += `
            <div class="order-card" style="border-right: 4px solid #4caf50; margin-bottom:15px;">
              <div class="order-header">
                <span class="order-id">#${ret.id.slice(0,8)} (استرجاع)</span>
                <span class="order-status ${ret.status}">${getReturnStatusText(ret.status)}</span>
              </div>
              <div class="order-product">
                <div class="order-product-image">
                  ${prod.image_url ? `<img src="${prod.image_url}" loading="lazy">` : '📦'}
                </div>
                <div class="order-product-details">
                  <div><strong>${escapeHTML(prod.name || 'منتج')}</strong></div>
                  <div>الكمية: <strong>${ret.quantity}</strong></div>
                  <div style="color:#d32f2f;">السبب: ${escapeHTML(ret.return_reason || 'غير محدد')}</div>
                </div>
              </div>

              ${imagesHtml}

              <!-- معلومات البائع -->
              <div style="margin-top:10px; padding:12px; background:#fef8e8; border-radius:8px; border:1px solid #ffe0b2;">
                <div style="font-weight:bold; color:#f57c00; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                  <span><i class="fas fa-store"></i> جهة التسليم (البائع):</span>
                  ${sellerId ? `<button type="button" onclick="showStorePage('${sellerId}')" style="background:#4caf50; color:#fff; border:none; padding:3px 10px; border-radius:6px; font-size:0.8rem; cursor:pointer; font-weight:bold;"><i class="fas fa-store"></i> المتجر</button>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.95rem; margin-bottom:5px;">
                  ${sellerImage}
                  <span><strong>الاسم:</strong> ${escapeHTML(sellerName)}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📞 رقم هاتف البائع:</strong> ${sellerPhone ? `<a href="tel:${sellerPhone}" style="color:#1a237e; font-weight:bold; direction:ltr; display:inline-block; font-size:1rem;">${escapeHTML(sellerPhone)}</a>` : ''}</span>
                  ${sellerPhone ? `
                    <a href="tel:${sellerPhone}" style="background:#1a237e; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${sellerPhone}" target="_blank" style="background:#25D366; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                </div>
                <div style="font-size:0.85rem; color:#555; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📍 عنوان البائع:</strong> ${escapeHTML(sellerAddress)}</span>
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(sellerAddress)}" target="_blank" style="background:#ff5722; color:#fff; padding:2px 8px; border-radius:4px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
                </div>
              </div>

              <!-- معلومات العميل -->
              <div style="margin-top:8px; padding:12px; background:#f5f7fa; border-radius:8px; border:1px solid #e0e0e0;">
                <div style="font-weight:bold; color:#1976d2; margin-bottom:6px;"><i class="fas fa-user"></i> جهة الاستلام (العميل):</div>
                <div style="display:flex; align-items:center; gap:8px; font-size:0.95rem; margin-bottom:5px;">
                  ${buyerImage}
                  <span><strong>الاسم:</strong> ${escapeHTML(buyerName)}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📞 رقم هاتف العميل:</strong> ${buyerPhone ? `<a href="tel:${buyerPhone}" style="color:#1a237e; font-weight:bold; direction:ltr; display:inline-block; font-size:1rem;">${escapeHTML(buyerPhone)}</a>` : ''}</span>
                  ${buyerPhone ? `
                    <a href="tel:${buyerPhone}" style="background:#1a237e; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${buyerPhone}" target="_blank" style="background:#25D366; color:#fff; padding:3px 10px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                </div>
                <div style="font-size:0.85rem; color:#555; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span><strong>📍 عنوان العميل:</strong> ${escapeHTML(buyerAddress)}</span>
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(buyerAddress)}" target="_blank" style="background:#ff5722; color:#fff; padding:2px 8px; border-radius:4px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
                </div>
              </div>

              <!-- أجرة التوصيل -->
              <div style="margin:8px 0; padding:8px 12px; background:#e8f5e9; border-radius:8px; border:1px solid #81c784; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; color:#2e7d32;"><i class="fas fa-money-bill-wave"></i> أجرة التوصيل المستحقة لك:</span>
                <span style="font-weight:900; color:#1b5e20; font-size:1.15rem;">${returnFee} ج.م</span>
              </div>

              <div style="margin-top:12px;">
                ${actionBtns}
              </div>

              ${timestampsHtml}
            </div>
          `;
        });
        myContainer.innerHTML = myHtml;
      }
    }
  } catch (err) {
    console.error('❌ خطأ في عرض مرتجعات المندوب:', err);
    if (availContainer) availContainer.innerHTML = `<p style="text-align:center; color:red; padding:20px;">خطأ في تحميل المرتجعات المتاحة: ${escapeHTML(err.message)}</p>`;
    if (myContainer) myContainer.innerHTML = `<p style="text-align:center; color:red; padding:20px;">خطأ في تحميل مهام الاسترجاع: ${escapeHTML(err.message)}</p>`;
  }
}

// ====== عرض طلبات الاسترجاع في لوحة البائع ======
async function displaySellerReturns() {
  if (!appState.user || appState.userData.account_type !== 'seller') {
    showToast('هذه الصفحة مخصصة للبائعين فقط', 'error');
    return;
  }

  const container = document.getElementById('sellerReturnsList');
  if (!container) return;

  // تصفير التحديد عند إعادة العرض
  if (!appState.seller) appState.seller = {};
  appState.seller.selectedReturns = new Set();

  showLoading(true);
  try {
    const returns = await loadSellerReturns(appState.user.id);
    if (!returns || returns.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:#999;">
          <i class="fas fa-undo-alt" style="font-size:2.5rem; margin-bottom:10px;"></i>
          <p>لا توجد طلبات استرجاع حالياً</p>
        </div>
      `;
      return;
    }

    // شريط الحذف الجماعي
    const bulkBarHtml = `
      <div id="sellerBulkBar" style="display:none; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; background:#fff3f3; border:1px solid #f44336; border-radius:10px; padding:10px 14px; margin-bottom:14px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:bold; color:#b71c1c;">
          <input type="checkbox" id="sellerSelectAll" onchange="toggleSelectAllSellerReturns(this.checked)" style="width:18px; height:18px; cursor:pointer;">
          تحديد الكل
        </label>
        <span style="color:#b71c1c; font-weight:bold;">
          <i class="fas fa-trash-alt"></i> محدد: <span id="sellerBulkCount">0</span>
        </span>
        <button onclick="deleteSelectedSellerReturns()" style="background:#d32f2f; color:#fff; border:none; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:bold;">
          <i class="fas fa-trash-alt"></i> حذف المحدد
        </button>
      </div>
    `;

    container.innerHTML = bulkBarHtml;
    returns.forEach(ret => {
      const card = document.createElement('div');
      card.className = 'return-card';
      const product = ret.product || {};
      const buyer = ret.buyer || {};
      const statusText = getReturnStatusText(ret.status);
      const isPending = ret.status === 'pending';
      const isApproved = ret.status === 'approved';

      let actionsHtml = '';
      if (isPending) {
        actionsHtml = `
          <div class="return-actions">
            <button class="return-approve-btn" onclick="approveReturnFromUI('${ret.id}')">
              <i class="fas fa-check"></i> قبول
            </button>
            <button class="return-reject-btn" onclick="showRejectReasonModal('${ret.id}')">
              <i class="fas fa-times"></i> رفض
            </button>
          </div>
        `;
      } else if (isApproved) {
        actionsHtml = `
          <div style="color: #4caf50; font-weight:700; margin-top:8px;">
            <i class="fas fa-check-circle"></i> تم قبول الاسترجاع
          </div>
        `;
      } else if (ret.status === 'rejected') {
        actionsHtml = `
          <div style="color: #f44336; font-weight:700; margin-top:8px;">
            <i class="fas fa-times-circle"></i> مرفوض: ${escapeHTML(ret.rejection_reason || '')}
          </div>
        `;
      }

      // زر الحذف الفردي يظهر دائماً لكل مرتجع
      actionsHtml += `
        <div style="margin-top:10px;">
          <button onclick="deleteSellerReturnFromUI('${ret.id}')" style="background:#d32f2f; color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:bold; width:100%;">
            <i class="fas fa-trash-alt"></i> حذف المرتجع
          </button>
        </div>
      `;

      const imagesHtml = ret.images && ret.images.length > 0
        ? `<div class="return-images-preview">${ret.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModal('${img}')">`).join('')}</div>`
        : '';

      card.innerHTML = `
        <div class="return-card-header">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" class="seller-return-checkbox" data-return-id="${ret.id}" onchange="toggleSellerReturnSelection('${ret.id}', this)" style="width:18px; height:18px; cursor:pointer;">
            <span class="return-id">#${ret.id.slice(0,8)}</span>
          </label>
          <span class="return-status ${ret.status}">${statusText}</span>
        </div>
        <div class="return-card-body">
          <div class="return-product-info">
            <div class="return-product-image">
              ${product.image_url ? `<img src="${product.image_url}" loading="lazy">` : '📦'}
            </div>
            <div>
              <div><strong>المنتج:</strong> ${escapeHTML(product.name || 'غير معروف')}</div>
              <div><strong>العميل:</strong> ${escapeHTML(buyer.name || 'غير معروف')}</div>
              <div><strong>الكمية:</strong> ${ret.quantity}</div>
              <div><strong>السبب:</strong> ${escapeHTML(ret.return_reason || '')}</div>
              ${ret.customer_notes ? `<div><strong>ملاحظات العميل:</strong> ${escapeHTML(ret.customer_notes)}</div>` : ''}
              <div><strong>تاريخ الطلب:</strong> ${new Date(ret.requested_at).toLocaleDateString('ar-EG')}</div>
              ${ret.delivery ? `<div><strong>المندوب:</strong> ${escapeHTML(ret.delivery.name || '')}</div>` : ''}
            </div>
          </div>
          ${imagesHtml}
          ${actionsHtml}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, 'error');
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// ====== عرض طلبات الاسترجاع في لوحة المؤسس ======
async function displayFounderReturns() {
  if (!appState.user || appState.userData.account_type !== 'founder') {
    showToast('هذه الصفحة مخصصة للمؤسس فقط', 'error');
    return;
  }

  const container = document.getElementById('founderReturnsList');
  if (!container) return;

  showLoading(true);
  try {
    const returns = await loadAllReturnsForFounder();
    if (!returns || returns.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:#999;">
          <i class="fas fa-undo-alt" style="font-size:2.5rem; margin-bottom:10px;"></i>
          <p>لا توجد طلبات استرجاع في النظام</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    returns.forEach(ret => {
      const card = document.createElement('div');
      card.className = 'return-card founder-return-card';
      const product = ret.product || {};
      const buyer = ret.buyer || {};
      const seller = ret.seller || {};
      const delivery = ret.delivery || {};
      const statusText = getReturnStatusText(ret.status);

      const imagesHtml = ret.images && ret.images.length > 0
        ? `<div class="return-images-preview">${ret.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModal('${img}')">`).join('')}</div>`
        : '';

      card.innerHTML = `
        <div class="return-card-header">
          <span class="return-id">#${ret.id.slice(0,8)}</span>
          <span class="return-status ${ret.status}">${statusText}</span>
        </div>
        <div class="return-card-body">
          <div class="return-product-info">
            <div class="return-product-image">
              ${product.image_url ? `<img src="${product.image_url}" loading="lazy">` : '📦'}
            </div>
            <div>
              <div><strong>المنتج:</strong> ${escapeHTML(product.name || 'غير معروف')}</div>
              <div><strong>العميل:</strong> ${escapeHTML(buyer.name || 'غير معروف')}</div>
              <div><strong>البائع:</strong> ${escapeHTML(seller.name || 'غير معروف')}</div>
              <div><strong>المندوب:</strong> ${escapeHTML(delivery.name || 'غير معين')}</div>
              <div><strong>الكمية:</strong> ${ret.quantity}</div>
              <div><strong>السبب:</strong> ${escapeHTML(ret.return_reason || '')}</div>
              ${ret.customer_notes ? `<div><strong>ملاحظات العميل:</strong> ${escapeHTML(ret.customer_notes)}</div>` : ''}
              ${ret.rejection_reason ? `<div style="color:#f44336;"><strong>سبب الرفض:</strong> ${escapeHTML(ret.rejection_reason)}</div>` : ''}
              <div><strong>تاريخ الطلب:</strong> ${new Date(ret.requested_at).toLocaleString('ar-EG')}</div>
            </div>
          </div>
          ${imagesHtml}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    showToast(err.message, 'error');
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// ====== دوال مساعدة للواجهة ======

// قبول الاسترجاع من واجهة البائع
async function approveReturnFromUI(returnId) {
  if (!confirm('هل أنت متأكد من قبول هذا الاسترجاع؟')) return;
  showLoading(true);
  try {
    const success = await approveReturn(returnId);
    if (success) {
      await displaySellerReturns();
      showToast('✅ تم قبول الاسترجاع', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// عرض مودال سبب الرفض
function showRejectReasonModal(returnId) {
  const modal = document.getElementById('rejectReasonModal');
  if (!modal) {
    showToast('النموذج غير متوفر', 'error');
    return;
  }
  document.getElementById('rejectReturnId').value = returnId;
  document.getElementById('rejectReasonText').value = '';
  modal.classList.add('active');
}

// تأكيد رفض الاسترجاع مع السبب
async function confirmRejectReturn() {
  const returnId = document.getElementById('rejectReturnId').value;
  const reason = document.getElementById('rejectReasonText').value.trim();
  if (!reason) {
    showToast('يرجى كتابة سبب الرفض', 'warning');
    return;
  }
  showLoading(true);
  try {
    const success = await rejectReturn(returnId, reason);
    if (success) {
      closeModal('rejectReasonModal');
      await displaySellerReturns();
      showToast('❌ تم رفض الاسترجاع', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ====== حذف مرتجع واحد (من لوحة البائع) ======
async function deleteSellerReturn(returnId) {
  if (!returnId) return false;
  if (!confirm('هل أنت متأكد من حذف هذا المرتجع نهائياً؟')) return false;

  try {
    // التحقق من الملكية عبر البائع المباشر أو عبر الطلب المرتبط
    const owns = await sellerOwnsReturn(returnId, appState.user.id);
    if (!owns) {
      showToast('لا يمكنك حذف هذا الطلب — لا تملك صلاحية عليه.', 'error');
      return false;
    }

    const { data, error } = await supabaseClient
      .from('returns')
      .delete()
      .eq('id', returnId)
      .select('id');

    if (error) throw error;

    if (!data || data.length === 0) {
      showToast('تعذّر الحذف — لم يتم العثور على مرتجع مطابق.', 'error');
      return false;
    }

    showToast('🗑️ تم حذف المرتجع بنجاح', 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

// حذف مرتجع مفرد من الواجهة
async function deleteSellerReturnFromUI(returnId) {
  showLoading(true);
  try {
    const ok = await deleteSellerReturn(returnId);
    if (ok) await displaySellerReturns();
  } finally {
    showLoading(false);
  }
}

// تبديل تحديد كارت مرتجع للجماعي
function toggleSellerReturnSelection(returnId, checkbox) {
  if (!appState.seller) appState.seller = {};
  if (!appState.seller.selectedReturns) appState.seller.selectedReturns = new Set();
  const set = appState.seller.selectedReturns;
  if (checkbox.checked) set.add(returnId);
  else set.delete(returnId);
  updateSellerBulkBar();
}

// تحديد/إلغاء تحديد الكل
function toggleSelectAllSellerReturns(checked) {
  if (!appState.seller) appState.seller = {};
  if (!appState.seller.selectedReturns) appState.seller.selectedReturns = new Set();
  const set = appState.seller.selectedReturns;
  const boxes = document.querySelectorAll('.seller-return-checkbox');
  boxes.forEach(box => {
    box.checked = checked;
    const id = box.getAttribute('data-return-id');
    if (checked) set.add(id);
    else set.delete(id);
  });
  updateSellerBulkBar();
}

// تحديث شريط الحذف الجماعي
function updateSellerBulkBar() {
  const bar = document.getElementById('sellerBulkBar');
  if (!bar) return;
  const set = appState.seller?.selectedReturns || new Set();
  const count = set.size;
  const countEl = document.getElementById('sellerBulkCount');
  if (countEl) countEl.textContent = count;
  bar.style.display = count > 0 ? 'flex' : 'none';
  const selectAll = document.getElementById('sellerSelectAll');
  if (selectAll) {
    const total = document.querySelectorAll('.seller-return-checkbox').length;
    selectAll.checked = total > 0 && count === total;
  }
}

// حذف جماعي للمرتجعات المحددة
async function deleteSelectedSellerReturns() {
  const set = appState.seller?.selectedReturns || new Set();
  const ids = Array.from(set);
  if (ids.length === 0) {
    showToast('لم تحدد أي مرتجع للحذف', 'warning');
    return;
  }
  if (!confirm(`هل أنت متأكد من حذف ${ids.length} مرتجع نهائياً؟`)) return;

  showLoading(true);
  let deleted = 0;
  try {
    // نتأكد من الملكية ثم نحذف كل سجل على حدة (لتجنب حذف سجلات لا يملكها البائع)
    for (const id of ids) {
      const owns = await sellerOwnsReturn(id, appState.user.id);
      if (!owns) continue;
      const { data, error } = await supabaseClient
        .from('returns')
        .delete()
        .eq('id', id)
        .select('id');
      if (!error && data && data.length > 0) deleted++;
    }

    appState.seller.selectedReturns = new Set();
    await displaySellerReturns();
    showToast(`🗑️ تم حذف ${deleted} مرتجع بنجاح`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ====== تصدير الدوال ======
window.createReturn = createReturn;
window.enrichReturnsData = enrichReturnsData;
window.loadMyReturns = loadMyReturns;
window.loadSellerReturns = loadSellerReturns;
window.loadAllReturnsForFounder = loadAllReturnsForFounder;
window.loadDeliveryReturns = loadDeliveryReturns;
window.loadAvailableReturns = loadAvailableReturns;
window.updateReturnStatus = updateReturnStatus;
window.updateReturnByCourier = updateReturnByCourier;
window.assignReturnToCourier = assignReturnToCourier;
window.approveReturn = approveReturn;
window.rejectReturn = rejectReturn;
window.getReturnStatusText = getReturnStatusText;
window.getReturnTimeRemaining = getReturnTimeRemaining;
window.claimReturn = claimReturn;
window.displaySellerReturns = displaySellerReturns;
window.displayFounderReturns = displayFounderReturns;
window.displayDeliveryReturns = displayDeliveryReturns;
window.deleteDeliveryReturnFromView = deleteDeliveryReturnFromView;
window.clearCompletedDeliveryReturns = clearCompletedDeliveryReturns;
window.approveReturnFromUI = approveReturnFromUI;
window.showRejectReasonModal = showRejectReasonModal;
window.confirmRejectReturn = confirmRejectReturn;
window.deleteSellerReturn = deleteSellerReturn;
window.deleteSellerReturnFromUI = deleteSellerReturnFromUI;
window.toggleSellerReturnSelection = toggleSellerReturnSelection;
window.toggleSelectAllSellerReturns = toggleSelectAllSellerReturns;
window.deleteSelectedSellerReturns = deleteSelectedSellerReturns;