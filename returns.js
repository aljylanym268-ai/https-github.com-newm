// ============================================================
// returns.js - نظام إدارة المرتجعات
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

// ====== دالة مساعدة لربط بيانات المرتجعات ======
async function enrichReturnsData(returns) {
  if (!returns || !returns.length) return [];
  try {
    const productIds = [...new Set(returns.map(r => r.product_id).filter(Boolean))];
    const userIds = [...new Set([
      ...returns.map(r => r.buyer_id),
      ...returns.map(r => r.seller_id),
      ...returns.map(r => r.delivery_id)
    ].filter(Boolean))];
    const orderIds = [...new Set(returns.map(r => r.order_id).filter(Boolean))];

    const [productsRes, usersRes, ordersRes] = await Promise.all([
      productIds.length ? supabaseClient.from('products').select('id, name, image_url, price, category').in('id', productIds) : { data: [] },
      userIds.length ? supabaseClient.from('user_data').select('id, name, phone, address, center, image_url').in('id', userIds) : { data: [] },
      orderIds.length ? supabaseClient.from('orders').select('id, total_price, shipping_address, center, customer_name, customer_phone').in('id', orderIds) : { data: [] }
    ]);

    const productMap = new Map((productsRes.data || []).map(p => [p.id, p]));
    const userMap = new Map((usersRes.data || []).map(u => [u.id, u]));
    const orderMap = new Map((ordersRes.data || []).map(o => [o.id, o]));

    returns.forEach(r => {
      if (r.product_id) r.product = productMap.get(r.product_id) || { name: 'منتج غير معروف', image_url: null };
      if (r.buyer_id) r.buyer = userMap.get(r.buyer_id) || { name: 'عميل' };
      if (r.seller_id) r.seller = userMap.get(r.seller_id) || { name: 'بائع' };
      if (r.delivery_id) r.delivery = userMap.get(r.delivery_id) || { name: 'مندوب' };
      if (r.order_id) r.order = orderMap.get(r.order_id) || {};
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
    const { data, error } = await supabaseClient
      .from('returns')
      .select('*')
      .eq('seller_id', sellerId)
      .order('requested_at', { ascending: false });

    if (error) throw error;
    return await enrichReturnsData(data || []);
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
    return await enrichReturnsData(data || []);
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
      showToast('تم استلام المهمة بنجاح', 'success');
      if (typeof displayDeliveryReturns === 'function') await displayDeliveryReturns();
      if (typeof refreshDeliveryDashboard === 'function') await refreshDeliveryDashboard();
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
  const container = document.getElementById('deliveryReturnsList');
  if (!container) return;

  try {
    const [availableReturns, myReturns] = await Promise.all([
      loadAvailableReturns(),
      loadDeliveryReturns(appState.user.id)
    ]);

    const countEl = document.getElementById('deliveryReturnsCount');
    if (countEl) countEl.textContent = availableReturns.length + myReturns.length;

    if (availableReturns.length === 0 && myReturns.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; color:#999;">
          <i class="fas fa-undo-alt" style="font-size:2.5rem; margin-bottom:10px;"></i>
          <p>لا توجد مهام استرجاع حالياً</p>
        </div>
      `;
      return;
    }

    let html = '';

    // قسم المرتجعات المتاحة للاستلام
    if (availableReturns.length > 0) {
      html += `<div style="font-weight:bold; font-size:1.1rem; margin:15px 0 10px; color:#1a237e;"><i class="fas fa-box-open"></i> مهام استرجاع جديدة معتمدة (${availableReturns.length})</div>`;
      availableReturns.forEach(ret => {
        const prod = ret.product || {};
        const buyer = ret.buyer || {};
        const seller = ret.seller || {};
        const order = ret.order || {};
        const buyerAddress = order.shipping_address || buyer.address || 'العنوان غير محدد';
        const buyerPhone = buyer.phone || order.customer_phone || '';
        const sellerPhone = seller.phone || '';
        const sellerAddress = seller.address || seller.center || 'غير محدد';
        const sellerId = seller.id || ret.seller_id;
        const returnFee = ret.return_fee || 20;

        const imagesHtml = ret.images && ret.images.length > 0
          ? `<div class="return-images-preview" style="margin-top:8px;">${ret.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModal('${img}')" style="width:50px;height:50px;object-fit:cover;border-radius:6px;margin:2px;cursor:pointer;">`).join('')}</div>`
          : '';

        html += `
          <div class="return-card" style="border-right: 4px solid #ff9800; margin-bottom:15px; background:#fff; border-radius:10px; padding:15px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <div class="return-card-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:10px;">
              <span class="return-id" style="font-weight:bold; color:#ff9800;"><i class="fas fa-undo-alt"></i> طلب استرجاع #${ret.id.slice(0,8)}</span>
              <span class="return-status ${ret.status}" style="padding:3px 10px; border-radius:12px; font-size:0.8rem;">${getReturnStatusText(ret.status)}</span>
            </div>
            <div class="return-card-body">
              <div class="return-product-info" style="display:flex; gap:12px; margin-bottom:10px;">
                <div class="return-product-image" style="width:60px; height:60px; min-width:60px; border-radius:8px; overflow:hidden; background:#f0f0f0; display:flex; align-items:center; justify-content:center;">
                  ${prod.image_url ? `<img src="${prod.image_url}" loading="lazy" style="width:100%; height:100%; object-fit:cover;">` : '<span style="font-size:1.5rem;">📦</span>'}
                </div>
                <div>
                  <div style="font-weight:bold; font-size:1rem; color:#1a237e;">${escapeHTML(prod.name || 'منتج')}</div>
                  <div style="font-size:0.85rem; color:#666;">الكمية المطلوب استرجاعها: <strong>${ret.quantity}</strong></div>
                  <div style="font-size:0.85rem; color:#d32f2f;">السبب: <strong>${escapeHTML(ret.return_reason || 'غير محدد')}</strong></div>
                  ${ret.customer_notes ? `<div style="font-size:0.8rem; color:#777;">ملاحظات: ${escapeHTML(ret.customer_notes)}</div>` : ''}
                </div>
              </div>

              ${imagesHtml}

              <!-- مربع رسوم الاسترجاع والمبلغ المستحق للمندوب -->
              <div style="margin:10px 0; padding:10px 14px; background:#e8f5e9; border-radius:8px; border:1px solid #81c784; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:bold; color:#2e7d32; font-size:0.95rem;"><i class="fas fa-hand-holding-usd"></i> المبلغ المستحق لك (أجرة التوصيل):</div>
                  <div style="font-size:0.8rem; color:#555; margin-top:2px;">رسوم يتحملها العميل (${returnFee} ج.م) وتُحصل عند استلام المرتجع</div>
                </div>
                <div style="font-weight:900; color:#1b5e20; font-size:1.3rem;">${returnFee} ج.م</div>
              </div>

              <!-- خطوة 1: الاستلام من العميل -->
              <div style="margin-top:10px; padding:10px; background:#f5f7fa; border-radius:8px; border:1px solid #e0e0e0;">
                <div style="font-weight:bold; color:#1976d2; margin-bottom:4px;"><i class="fas fa-user"></i> الخطوة 1: مكان الاستلام (العميل)</div>
                <div style="font-size:0.9rem;"><strong>الاسم:</strong> ${escapeHTML(buyer.name || order.customer_name || 'عميل')}</div>
                <div style="font-size:0.9rem;"><strong>العنوان:</strong> ${escapeHTML(buyerAddress)}</div>
                <div style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  ${buyerPhone ? `
                    <a href="tel:${buyerPhone}" class="action-btn" style="background:#1a237e; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${buyerPhone}" target="_blank" class="action-btn" style="background:#25D366; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(buyerAddress)}" target="_blank" class="action-btn" style="background:#ff5722; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
                </div>
              </div>

              <!-- خطوة 2: التسليم للبائع -->
              <div style="margin-top:10px; padding:10px; background:#fef8e8; border-radius:8px; border:1px solid #ffe0b2;">
                <div style="font-weight:bold; color:#f57c00; margin-bottom:4px;"><i class="fas fa-store"></i> الخطوة 2: مكان التسليم (البائع)</div>
                <div style="font-size:0.9rem;"><strong>البائع:</strong> ${escapeHTML(seller.name || 'بائع')}</div>
                <div style="font-size:0.9rem;"><strong>عنوان/مركز البائع:</strong> ${escapeHTML(sellerAddress)}</div>
                <div style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  ${sellerId ? `
                    <button type="button" onclick="showStorePage('${sellerId}')" class="action-btn" style="background:#4caf50; color:#fff; padding:4px 10px; border-radius:6px; border:none; cursor:pointer; font-size:0.85rem;"><i class="fas fa-store"></i> زيارة متجر البائع</button>
                  ` : ''}
                  ${sellerPhone ? `
                    <a href="tel:${sellerPhone}" class="action-btn" style="background:#1a237e; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${sellerPhone}" target="_blank" class="action-btn" style="background:#25D366; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(sellerAddress)}" target="_blank" class="action-btn" style="background:#ff5722; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-map-marker-alt"></i> خريطة البائع</a>
                </div>
              </div>

              <div style="margin-top:14px;">
                <button class="add-to-cart" onclick="claimReturn('${ret.id}')" style="background:#ff9800; width:100%; padding:11px; border-radius:8px; font-weight:bold; cursor:pointer; border:none; color:#fff; font-size:1rem;">
                  <i class="fas fa-hand-holding-box"></i> استلام مهمة الاسترجاع (${returnFee} ج.م)
                </button>
              </div>
            </div>
          </div>
        `;
      });
    }

    // قسم مهام الاسترجاع الخاصة بالمندوب
    if (myReturns.length > 0) {
      html += `<div style="font-weight:bold; font-size:1.1rem; margin:20px 0 10px; color:#2e7d32;"><i class="fas fa-tasks"></i> مهام الاسترجاع الخاصة بي (${myReturns.length})</div>`;
      myReturns.forEach(ret => {
        const prod = ret.product || {};
        const buyer = ret.buyer || {};
        const seller = ret.seller || {};
        const order = ret.order || {};
        const buyerAddress = order.shipping_address || buyer.address || 'العنوان غير محدد';
        const buyerPhone = buyer.phone || order.customer_phone || '';
        const sellerPhone = seller.phone || '';
        const sellerAddress = seller.address || seller.center || 'غير محدد';
        const sellerId = seller.id || ret.seller_id;
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
          `;
        }

        // تواريخ المراحل المسجلة من الخادم
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

        html += `
          <div class="return-card" style="border-right: 4px solid #4caf50; margin-bottom:15px; background:#fff; border-radius:10px; padding:15px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <div class="return-card-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:8px; margin-bottom:10px;">
              <span class="return-id" style="font-weight:bold; color:#2e7d32;"><i class="fas fa-undo-alt"></i> مهمة استرجاع #${ret.id.slice(0,8)}</span>
              <span class="return-status ${ret.status}" style="padding:3px 10px; border-radius:12px; font-size:0.8rem;">${getReturnStatusText(ret.status)}</span>
            </div>
            <div class="return-card-body">
              <div class="return-product-info" style="display:flex; gap:12px; margin-bottom:10px;">
                <div class="return-product-image" style="width:60px; height:60px; min-width:60px; border-radius:8px; overflow:hidden; background:#f0f0f0; display:flex; align-items:center; justify-content:center;">
                  ${prod.image_url ? `<img src="${prod.image_url}" loading="lazy" style="width:100%; height:100%; object-fit:cover;">` : '<span style="font-size:1.5rem;">📦</span>'}
                </div>
                <div>
                  <div style="font-weight:bold; font-size:1rem; color:#1a237e;">${escapeHTML(prod.name || 'منتج')}</div>
                  <div style="font-size:0.85rem; color:#666;">الكمية: <strong>${ret.quantity}</strong></div>
                  <div style="font-size:0.85rem; color:#d32f2f;">السبب: <strong>${escapeHTML(ret.return_reason || 'غير محدد')}</strong></div>
                </div>
              </div>

              <!-- قسم بيانات العميل -->
              <div style="margin-top:10px; padding:10px; background:#f5f7fa; border-radius:8px; border:1px solid #e0e0e0;">
                <div style="font-weight:bold; color:#1976d2; margin-bottom:4px;"><i class="fas fa-user"></i> العميل (مكان استلام المرتجع)</div>
                <div style="font-size:0.9rem;"><strong>الاسم:</strong> ${escapeHTML(buyer.name || order.customer_name || 'عميل')}</div>
                <div style="font-size:0.9rem;"><strong>العنوان:</strong> ${escapeHTML(buyerAddress)}</div>
                <div style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  ${buyerPhone ? `
                    <a href="tel:${buyerPhone}" class="action-btn" style="background:#1a237e; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${buyerPhone}" target="_blank" class="action-btn" style="background:#25D366; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(buyerAddress)}" target="_blank" class="action-btn" style="background:#ff5722; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-map-marker-alt"></i> خريطة العميل</a>
                </div>
              </div>

              <!-- قسم بيانات البائع -->
              <div style="margin-top:10px; padding:10px; background:#fef8e8; border-radius:8px; border:1px solid #ffe0b2;">
                <div style="font-weight:bold; color:#f57c00; margin-bottom:4px;"><i class="fas fa-store"></i> البائع (مكان تسليم المرتجع)</div>
                <div style="font-size:0.9rem;"><strong>البائع:</strong> ${escapeHTML(seller.name || 'بائع')}</div>
                <div style="font-size:0.9rem;"><strong>عنوان/مركز البائع:</strong> ${escapeHTML(sellerAddress)}</div>
                <div style="margin-top:6px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                  ${sellerId ? `
                    <button type="button" onclick="showStorePage('${sellerId}')" class="action-btn" style="background:#4caf50; color:#fff; padding:4px 10px; border-radius:6px; border:none; cursor:pointer; font-size:0.85rem;"><i class="fas fa-store"></i> زيارة متجر البائع</button>
                  ` : ''}
                  ${sellerPhone ? `
                    <a href="tel:${sellerPhone}" class="action-btn" style="background:#1a237e; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-phone"></i> اتصال</a>
                    <a href="https://wa.me/${sellerPhone}" target="_blank" class="action-btn" style="background:#25D366; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fab fa-whatsapp"></i> واتساب</a>
                  ` : ''}
                  <a href="https://www.google.com/maps/search/${encodeURIComponent(sellerAddress)}" target="_blank" class="action-btn" style="background:#ff5722; color:#fff; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.85rem;"><i class="fas fa-map-marker-alt"></i> خريطة البائع</a>
                </div>
              </div>

              <div style="margin-top:14px;">
                ${actionBtns}
              </div>
            </div>
          </div>
        `;
      });
    }

    container.innerHTML = html;
  } catch (err) {
    console.error('❌ خطأ في عرض مرتجعات المندوب:', err);
    container.innerHTML = `<p style="text-align:center; color:red; padding:20px;">خطأ في تحميل المرتجعات: ${escapeHTML(err.message)}</p>`;
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

    container.innerHTML = '';
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
window.approveReturnFromUI = approveReturnFromUI;
window.showRejectReasonModal = showRejectReasonModal;
window.confirmRejectReturn = confirmRejectReturn;