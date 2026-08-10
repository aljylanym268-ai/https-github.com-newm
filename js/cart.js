// ========== مزامنة السلة من قاعدة البيانات ==========
async function syncCartFromDB() {
    if (!appState.user) return [];
    try {
        const { data: cartData, error: cartError } = await supabaseClient.from('cart_items').select('*').eq('user_id', appState.user.id);
        if (cartError) throw cartError;
        if (!cartData.length) return [];
        const productIds = cartData.map(item => item.product_id);
        const { data: productsData, error: productsError } = await supabaseClient.from('products').select('*').in('id', productIds);
        if (productsError) throw productsError;
        const productsMap = new Map(productsData.map(p => [p.id, p]));
        return cartData.map(item => {
            const product = productsMap.get(item.product_id);
            return {
                id: item.product_id,
                name: product?.name || 'منتج غير معروف',
                price: product?.price || 0,
                image_url: (product?.images && product.images[0]) || product?.image_url || '',
                quantity: item.quantity,
                cart_item_id: item.id,
                stock: product?.stock || 0,
                category: product?.category || 'عام',
                seller_id: product?.user_id || null
            };
        });
    } catch (error) { console.error('Error syncing cart:', error); return []; }
}

// ========== تحميل السلة وعرضها (معدل مع checkbox) ==========
async function loadCart() {
    const container = document.getElementById('cartItems');
    const totalEl = document.getElementById('cartTotal');
    const subtotalEl = document.getElementById('cartSubtotal');
    const deliveryEl = document.getElementById('cartDeliveryFee');
    const selectedCountEl = document.getElementById('selectedCount');
    if (!container) return;

    if (!appState.user) {
        container.innerHTML = '<div style="text-align:center; padding:50px;"><div style="font-size:4rem;">🛒</div><h3>سلة التسوق فارغة</h3><p>سجل دخولك لإضافة منتجات إلى السلة</p></div>';
        if (totalEl) totalEl.textContent = '0 ج.م';
        if (subtotalEl) subtotalEl.textContent = '0 ج.م';
        if (deliveryEl) deliveryEl.textContent = '0 ج.م';
        if (selectedCountEl) selectedCountEl.textContent = '0';
        return;
    }

    const cartItems = await syncCartFromDB();
    if (cartItems.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:50px 20px; color:#666;"><div style="font-size:4rem; margin-bottom:20px;">🛒</div><h3 style="color:#1a237e; margin-bottom:10px;">سلة التسوق فارغة</h3><p>لم تقم بإضافة أي منتجات بعد</p></div>';
        if (totalEl) totalEl.textContent = '0 ج.م';
        if (subtotalEl) subtotalEl.textContent = '0 ج.م';
        if (deliveryEl) deliveryEl.textContent = '0 ج.م';
        if (selectedCountEl) selectedCountEl.textContent = '0';
        return;
    }

    // تخزين عناصر السلة في حالة عالمية للتعامل معها
    appState.cartItems = cartItems.map(item => ({ ...item, selected: false }));
    renderCartItems(appState.cartItems);
}

// ========== عرض عناصر السلة ==========
function renderCartItems(items) {
    const container = document.getElementById('cartItems');
    const totalEl = document.getElementById('cartTotal');
    const subtotalEl = document.getElementById('cartSubtotal');
    const deliveryEl = document.getElementById('cartDeliveryFee');
    const selectedCountEl = document.getElementById('selectedCount');
    if (!container) return;

    if (!items || items.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:50px 20px; color:#666;"><div style="font-size:4rem; margin-bottom:20px;">🛒</div><h3 style="color:#1a237e; margin-bottom:10px;">سلة التسوق فارغة</h3><p>لم تقم بإضافة أي منتجات بعد</p></div>';
        updateCartSummary(0, 0);
        return;
    }

    container.innerHTML = '';
    let subtotal = 0;
    let selectedCount = 0;
    const deliveryFee = 20;

    items.forEach((item, index) => {
        subtotal += item.price * item.quantity;
        if (item.selected) selectedCount += item.quantity;

        const card = document.createElement('div');
        card.className = 'cart-item';
        card.dataset.index = index;
        card.addEventListener('click', function(e) {
            const target = e.target;
            if (target.closest('.cart-item-checkbox') || target.closest('.quantity-btn') || target.closest('.remove-btn') || target.closest('.save-for-later-btn')) {
                return;
            }
            const product = appState.products.find(p => p.id === item.id);
            if (product) {
                openProductDetail(product);
            } else {
                showToast('المنتج غير موجود', 'error');
            }
        });

        const inStock = item.stock > 0;
        const stockText = inStock ? '✅ متوفر' : '❌ غير متوفر';
        const stockColor = inStock ? '#4caf50' : '#e53935';

        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + (inStock ? 2 : 5));
        const deliveryDateStr = deliveryDate.toLocaleDateString('ar-EG', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

        const imageHtml = item.image_url ? `<img src="${item.image_url}" loading="lazy" alt="${escapeHTML(item.name)}">` : '📦';

        card.innerHTML = `
            <div class="cart-item-checkbox-wrapper">
                <input type="checkbox" class="cart-item-checkbox" data-index="${index}" ${item.selected ? 'checked' : ''}>
            </div>
            <div class="cart-item-image">${imageHtml}</div>
            <div class="cart-item-info">
                <div class="cart-item-title">${escapeHTML(item.name)}</div>
                <div class="cart-item-price">${(item.price * item.quantity).toLocaleString()} ج.م</div>
                <div class="cart-item-meta">
                    <span class="cart-item-stock" style="color:${stockColor}; font-weight:700;">${stockText}</span>
                    <span class="cart-item-delivery">🚚 التوصيل: ${deliveryDateStr}</span>
                </div>
                <div class="cart-item-controls">
                    <div class="quantity-control">
                        <button class="quantity-btn" onclick="updateQuantity('${item.id}', -1)" data-product-id="${item.id}">-</button>
                        <span style="font-weight:700;">${item.quantity}</span>
                        <button class="quantity-btn" onclick="updateQuantity('${item.id}', 1)" data-product-id="${item.id}">+</button>
                    </div>
                    <button class="save-for-later-btn" onclick="saveForLater('${item.id}')" title="حفظ لوقت لاحق"><i class="fas fa-clock"></i> حفظ</button>
                    <button class="remove-btn" onclick="removeFromCart('${item.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    updateCartSummary(subtotal, selectedCount);

    document.querySelectorAll('.cart-item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const index = parseInt(this.dataset.index);
            if (appState.cartItems && appState.cartItems[index]) {
                appState.cartItems[index].selected = this.checked;
                renderCartItems(appState.cartItems);
            }
        });
    });

    document.querySelectorAll('.quantity-btn, .remove-btn, .save-for-later-btn, .cart-item-checkbox').forEach(el => {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    });
}

// ========== تحديث ملخص السلة ==========
function updateCartSummary(subtotal, selectedCount) {
    const totalEl = document.getElementById('cartTotal');
    const subtotalEl = document.getElementById('cartSubtotal');
    const deliveryEl = document.getElementById('cartDeliveryFee');
    const selectedCountEl = document.getElementById('selectedCount');
    const deliveryFee = 20;

    const total = subtotal + (selectedCount > 0 ? deliveryFee : 0);

    if (subtotalEl) subtotalEl.textContent = subtotal.toLocaleString() + ' ج.م';
    if (deliveryEl) deliveryEl.textContent = (selectedCount > 0 ? deliveryFee : 0) + ' ج.م';
    if (totalEl) totalEl.textContent = total.toLocaleString() + ' ج.م';
    if (selectedCountEl) selectedCountEl.textContent = selectedCount;
}

// ========== دوال التحكم في التحديد ==========
function toggleSelectAll() {
    if (!appState.cartItems) return;
    const allSelected = appState.cartItems.every(item => item.selected);
    appState.cartItems.forEach(item => item.selected = !allSelected);
    renderCartItems(appState.cartItems);
}

function deselectAll() {
    if (!appState.cartItems) return;
    appState.cartItems.forEach(item => item.selected = false);
    renderCartItems(appState.cartItems);
}

function deleteSelected() {
    if (!appState.cartItems) return;
    const selectedIds = appState.cartItems.filter(item => item.selected).map(item => item.id);
    if (selectedIds.length === 0) {
        showToast('لم يتم تحديد أي منتج للحذف', 'warning');
        return;
    }
    if (!confirm(`هل أنت متأكد من حذف ${selectedIds.length} منتج(منتجات) محددة؟`)) return;
    showLoading(true);
    Promise.all(selectedIds.map(id => removeFromCart(id, false)))
        .then(() => {
            showToast('تم حذف المنتجات المحددة', 'success');
            loadCart();
            updateCartBadgeFromDB();
        })
        .catch(err => showToast(err.message, 'error'))
        .finally(() => showLoading(false));
}

// ========== إضافة إلى السلة ==========
async function addToCart(productId) {
    if (!appState.user) { showToast('يجب تسجيل الدخول أولاً', 'warning'); return; }
    showLoading(true);
    try {
        const { data: existing } = await supabaseClient.from('cart_items').select('id, quantity').eq('user_id', appState.user.id).eq('product_id', productId).maybeSingle();
        if (existing) await supabaseClient.from('cart_items').update({ quantity: existing.quantity + 1 }).eq('id', existing.id);
        else await supabaseClient.from('cart_items').insert({ user_id: appState.user.id, product_id: productId, quantity: 1, created_at: new Date() });
        const product = appState.products.find(p => p.id === productId);
        showToast(`تم إضافة ${product?.name || 'المنتج'} إلى السلة`, 'success');
        await updateCartBadgeFromDB();
        await loadCart();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
}

// ========== تحديث الكمية ==========
async function updateQuantity(productId, change) {
    if (!appState.user) return;
    showLoading(true);
    try {
        const { data: item } = await supabaseClient.from('cart_items').select('id, quantity').eq('user_id', appState.user.id).eq('product_id', productId).single();
        const newQty = item.quantity + change;
        if (newQty <= 0) await supabaseClient.from('cart_items').delete().eq('id', item.id);
        else await supabaseClient.from('cart_items').update({ quantity: newQty }).eq('id', item.id);
        await loadCart();
        await updateCartBadgeFromDB();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
}

// ========== حذف من السلة ==========
async function removeFromCart(productId, showToastMessage = true) {
    if (!appState.user) return;
    showLoading(true);
    try {
        await supabaseClient.from('cart_items').delete().eq('user_id', appState.user.id).eq('product_id', productId);
        await loadCart();
        await updateCartBadgeFromDB();
        if (showToastMessage) showToast('تم حذف المنتج من السلة', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
}

// ========== حفظ لوقت لاحق ==========
async function saveForLater(productId) {
    showToast('تم حفظ المنتج لقائمة الرغبات (قيد التطوير)', 'info');
}

// ========== إعادة تعيين السلة ==========
async function clearCartAfterOrder() { if (appState.user) await supabaseClient.from('cart_items').delete().eq('user_id', appState.user.id); await loadCart(); await updateCartBadgeFromDB(); }

// ========== فتح نافذة إتمام الطلب ==========
function openCheckout() {
    if (!appState.user) { showToast('يجب تسجيل الدخول أولاً', 'warning'); return; }
    const selected = appState.cartItems?.filter(item => item.selected) || [];
    if (selected.length === 0) {
        showToast('يرجى تحديد منتج واحد على الأقل', 'warning');
        return;
    }
    document.getElementById('checkoutModal').classList.add('active');
}
function closeCheckoutModal() { document.getElementById('checkoutModal').classList.remove('active'); }

// ========== إنشاء طلب ==========
async function createOrder(productId, quantity, totalPrice, sellerId, customerName, customerPhone, shippingAddress, center, deliveryFee = 0) {
    if (!appState.user) throw new Error('يجب تسجيل الدخول');
    console.log(`📦 [createOrder] Creating order for product ${productId}, quantity ${quantity}, total ${totalPrice}`);
    const { data, error } = await supabaseClient.from('orders').insert({
        buyer_id: appState.user.id,
        seller_id: sellerId,
        product_id: productId,
        quantity,
        total_price: totalPrice,
        delivery_fee: deliveryFee,
        status: 'pending',
        customer_name: customerName,
        customer_phone: customerPhone,
        shipping_address: shippingAddress,
        center: center,
        created_at: new Date()
    }).select().maybeSingle();
    if (error) throw error;
    if (data) {
        console.log(`✅ [createOrder] Order created with ID: ${data.id}`);
        await sendNotification(sellerId, 'طلب جديد', `لديك طلب جديد من ${customerName}`, { order_id: data.id });
    }
    return data;
}

// ========== تأكيد الطلب (من السلة) ==========
async function confirmOrder() {
    const name = document.getElementById('checkoutName').value.trim();
    const phone = document.getElementById('checkoutPhone').value.trim();
    const address = document.getElementById('checkoutAddress').value.trim();
    if (!name || !phone || !address) { showToast('يرجى ملء جميع الحقول', 'warning'); return; }
    let center = '';
    if (appState.userData.center) center = appState.userData.center;
    else if (appState.location && appState.location.center) center = appState.location.center;
    else { const match = address.match(/(قنا|نقادة|قوص|دشنا|فرشوط|أبو تشت|نجع حمادي|قفط)/i); if (match) center = match[0]; else center = 'قنا'; }
    const deliveryFee = 20;
    showLoading(true);
    try {
        const selectedItems = appState.cartItems.filter(item => item.selected);
        if (selectedItems.length === 0) throw new Error('لم يتم تحديد أي منتج');
        for (const item of selectedItems) {
            const { data: product } = await supabaseClient.from('products').select('user_id').eq('id', item.id).single();
            if (!product) throw new Error('المنتج غير موجود');
            const totalWithDelivery = (item.price * item.quantity) + deliveryFee;
            await createOrder(item.id, item.quantity, totalWithDelivery, product.user_id, name, phone, address, center, deliveryFee);
        }
        for (const item of selectedItems) {
            await supabaseClient.from('cart_items').delete().eq('user_id', appState.user.id).eq('product_id', item.id);
        }
        await loadCart();
        await updateCartBadgeFromDB();
        closeCheckoutModal();
        showToast('تم تقديم الطلب بنجاح!', 'success');
        showScreen('ordersScreen');
        if (typeof loadBuyerOrdersWithTimeline === 'function') loadBuyerOrdersWithTimeline();
    } catch (err) { showToast(err.message, 'error'); console.error(err); }
    finally { showLoading(false); }
}

// ========== تحديث شارة السلة ==========
async function updateCartBadgeFromDB() {
    const badge = document.getElementById('cartBadge');
    if (!appState.user) { if (badge) badge.style.display = 'none'; return; }
    const { data } = await supabaseClient.from('cart_items').select('quantity').eq('user_id', appState.user.id);
    const total = (data || []).reduce((s, i) => s + i.quantity, 0);
    if (badge) { badge.style.display = total > 0 ? 'flex' : 'none'; badge.textContent = total; }
}

// ===================== دوال الطلبات (العميل) =====================
async function loadBuyerOrders() {
    if (!appState.user) return [];
    try {
        const { data: orders, error } = await supabaseClient.from('orders').select('*').eq('buyer_id', appState.user.id).order('created_at', { ascending: false });
        if (error) throw error;
        if (!orders.length) return orders;
        const productIds = [...new Set(orders.map(o => o.product_id).filter(id => id))];
        if (productIds.length) {
            const { data: products, error: prodError } = await supabaseClient.from('products').select('id, name, image_url').in('id', productIds);
            if (!prodError && products) {
                const productMap = new Map(products.map(p => [p.id, p]));
                orders.forEach(order => { if (order.product_id) order.products = productMap.get(order.product_id) || { name: 'منتج غير معروف', image_url: null }; });
            }
        }
        const deliveryIds = orders.filter(o => o.delivery_id).map(o => o.delivery_id);
        if (deliveryIds.length) {
            const { data: deliveryPersons, error: delError } = await supabaseClient.from('user_data').select('id, name, phone, image_url').in('id', deliveryIds);
            if (!delError && deliveryPersons) {
                const delMap = new Map(deliveryPersons.map(d => [d.id, d]));
                orders.forEach(order => { if (order.delivery_id) order.delivery = delMap.get(order.delivery_id); });
            }
        }
        return orders;
    } catch (error) { console.error('Error loading buyer orders:', error); return []; }
}

async function cancelOrder(orderId) {
    if (!confirm('هل أنت متأكد من إلغاء الطلب؟')) return;
    showLoading(true);
    try { await updateOrderStatus(orderId, 'cancelled'); showToast('تم إلغاء الطلب', 'success'); await loadBuyerOrdersWithTimeline(); }
    catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
}

// ========== حذف طلب من قائمة الطلبات ==========
function deleteBuyerOrder(orderId) {
    if (!confirm('هل أنت متأكد من حذف هذا الطلب من القائمة؟')) return;
    
    // إزالة الطلب من المصفوفة المحلية
    if (appState.buyerOrders) {
        appState.buyerOrders = appState.buyerOrders.filter(o => o.id !== orderId);
    }
    
    // إعادة عرض الطلبات المفلترة
    renderFilteredOrders();
    showToast('تم حذف الطلب من القائمة', 'success');
    
    // إذا لم يعد هناك طلبات، عرض رسالة "لا توجد طلبات"
    if (!appState.buyerOrders || appState.buyerOrders.length === 0) {
        const container = document.getElementById('buyerOrdersList');
        const emptyMsg = document.getElementById('ordersEmptyMessage');
        if (container) container.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
    }
}

function getStatusText(status) {
    const map = {
        pending: 'قيد الانتظار',
        confirmed: 'تم التأكيد',
        prepared: 'تم التجهيز',
        picked_up: 'تم الاستلام',
        picked_up_from_seller: 'تم الاستلام من البائع',
        in_delivery: 'في الطريق',
        delivered: 'تم التوصيل',
        cancelled: 'ملغي'
    };
    return map[status] || status;
}

function generateTimeline(currentStatus) {
    const steps = [
        { key: 'pending', label: 'تم الطلب' },
        { key: 'confirmed', label: 'تم التأكيد' },
        { key: 'prepared', label: 'تم التجهيز' },
        { key: 'picked_up', label: 'استلمه المندوب' },
        { key: 'picked_up_from_seller', label: 'استلم من البائع' },
        { key: 'in_delivery', label: 'في الطريق' },
        { key: 'delivered', label: 'تم التوصيل' }
    ];
    const statusIndex = steps.findIndex(s => s.key === currentStatus);
    let html = '<div class="timeline-steps">';
    steps.forEach((step, idx) => {
        let color = '#ccc';
        if (idx <= statusIndex) color = '#4caf50';
        if (idx === statusIndex && currentStatus !== 'delivered' && currentStatus !== 'cancelled') color = '#ff9800';
        html += `<div class="timeline-step"><div class="timeline-dot" style="background:${color};"></div><div class="timeline-label">${step.label}</div></div>`;
    });
    html += '</div>';
    return html;
}

// ========== حالة التصفية للطلبات ==========
if (!appState.ordersFilter) {
    appState.ordersFilter = { status: 'all', query: '' };
}

// ========== تصفية الطلبات بناءً على البحث والحالة ==========
function filterBuyerOrders() {
    const searchInput = document.getElementById('ordersSearchInput');
    const clearBtn = document.getElementById('ordersClearSearch');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    if (clearBtn) {
        clearBtn.style.display = query ? 'block' : 'none';
    }
    
    appState.ordersFilter.query = query;
    renderFilteredOrders();
}

// ========== تعيين فلتر الحالة ==========
function setOrdersFilter(status, btnElement) {
    appState.ordersFilter.status = status;
    
    // تحديث حالة الأزرار
    document.querySelectorAll('#ordersFilterButtons .filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (btnElement) btnElement.classList.add('active');
    
    renderFilteredOrders();
}

// ========== عرض الطلبات المفلترة ==========
function renderFilteredOrders() {
    const container = document.getElementById('buyerOrdersList');
    const emptyMsg = document.getElementById('ordersEmptyMessage');
    if (!container) return;
    
    const { status, query } = appState.ordersFilter;
    
    // تصفية حسب الحالة
    let filtered = appState.buyerOrders || [];
    if (status !== 'all') {
        filtered = filtered.filter(o => o.status === status);
    }
    
    // تصفية حسب نص البحث (رقم الطلب أو اسم المنتج)
    if (query) {
        filtered = filtered.filter(o => {
            const orderId = (o.id || '').toLowerCase();
            const productName = (o.products?.name || '').toLowerCase();
            return orderId.includes(query) || productName.includes(query);
        });
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }
    
    if (emptyMsg) emptyMsg.style.display = 'none';
    
    // عرض الطلبات المفلترة
    container.innerHTML = '';
    filtered.forEach(order => {
        container.appendChild(createBuyerOrderCard(order));
    });
}

// ========== إنشاء بطاقة طلب (دالة مساعدة) ==========
function createBuyerOrderCard(order) {
    const card = document.createElement('div');
    card.className = 'order-card';
    const product = order.products || {};
    const timeline = generateTimeline(order.status);
    
    let deliveryHtml = '';
    if (order.delivery) {
        const img = order.delivery.image_url ? `<img src="${order.delivery.image_url}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-user" style="font-size:1.2rem;"></i>';
        deliveryHtml = `<div class="delivery-person-info" style="margin-top:10px;padding:8px;background:#f5f7fa;border-radius:8px;display:flex;align-items:center;gap:10px;">
            ${img}
            <span><strong>المندوب:</strong> ${escapeHTML(order.delivery.name)}</span>
            ${order.delivery.phone ? `<a href="tel:${order.delivery.phone}" style="color:#1a237e;margin-right:10px;"><i class="fas fa-phone"></i></a>` : ''}
            <a href="https://wa.me/${order.delivery.phone || ''}" target="_blank" style="color:#25D366;"><i class="fab fa-whatsapp"></i></a>
        </div>`;
    }
    
    let otpDisplay = '';
    if (order.status === 'in_delivery' && order.otp_code) {
        otpDisplay = `<div style="margin-top:10px;padding:12px;background:#fff3cd;border-radius:8px;border:2px solid #ffc107;text-align:center;font-weight:bold;">
            <i class="fas fa-key" style="color:#d39e00;"></i>
            رمز تأكيد الاستلام: <span style="color:#d39e00;font-size:1.4rem;">${escapeHTML(order.otp_code)}</span>
            <div style="font-size:0.8rem;margin-top:4px;">أعط هذا الرمز للمندوب عند استلام الطلب</div>
        </div>`;
    }
    
    // عرض أزرار الإجراءات حسب حالة الطلب
    let actionsHtml = '';
    if (order.status === 'pending') {
        actionsHtml = `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
            <button class="add-to-cart" onclick="cancelOrder('${order.id}')"><i class="fas fa-ban"></i> إلغاء الطلب</button>
            <button class="remove-btn" style="display:inline-flex;align-items:center;gap:5px;width:auto;" onclick="deleteBuyerOrder('${order.id}')"><i class="fas fa-trash"></i> حذف</button>
        </div>`;
    } else if (order.status === 'cancelled' || order.status === 'delivered') {
        actionsHtml = `<div style="margin-top:10px;">
            <button class="remove-btn" style="display:inline-flex;align-items:center;gap:5px;width:auto;" onclick="deleteBuyerOrder('${order.id}')"><i class="fas fa-trash"></i> حذف</button>
        </div>`;
    }
    
    card.innerHTML = `<div class="order-header"><span class="order-id">#${order.id.slice(0,8)}</span><span class="order-status ${order.status}">${getStatusText(order.status)}</span></div>
        <div>${escapeHTML(product.name)} - ${order.quantity} × ${((order.total_price - (order.delivery_fee || 0)) / order.quantity).toFixed(0)} ج.م</div>
        <div>رسوم التوصيل: ${order.delivery_fee || 0} ج.م</div>
        <div class="order-timeline" style="margin-top:15px;">${timeline}</div>
        ${otpDisplay}${deliveryHtml}
        ${actionsHtml}`;
    
    return card;
}

async function loadBuyerOrdersWithTimeline() {
    const orders = await loadBuyerOrders();
    const container = document.getElementById('buyerOrdersList');
    if (!container) return;
    
    // تخزين الطلبات في الحالة العامة للتصفية
    appState.buyerOrders = orders;

    // تحديث عداد عدد الطلبات في بطاقة "طلبات" بالملف الشخصي
    const profileOrdersCountEl = document.getElementById('profileOrdersCount');
    if (profileOrdersCountEl) profileOrdersCountEl.textContent = orders.length;
    
    if (orders.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:30px;">لا توجد طلبات</p>';
        const emptyMsg = document.getElementById('ordersEmptyMessage');
        if (emptyMsg) emptyMsg.style.display = 'none';
        return;
    }
    
    // عرض مع تطبيق التصفية الحالية
    renderFilteredOrders();
    
    // ملاحظة: تم نقل الكود الأصلي لإنشاء البطاقات إلى createBuyerOrderCard
}

// ===================== دوال الطلبات (البائع) =====================
async function loadSellerOrders(sellerId) {
    try {
        const { data: orders, error } = await supabaseClient.from('orders').select('*').eq('seller_id', sellerId).order('created_at', { ascending: false });
        if (error) throw error;
        if (!orders.length) return orders;
        const productIds = [...new Set(orders.map(o => o.product_id).filter(id => id))];
        if (productIds.length) {
            const { data: products, error: prodError } = await supabaseClient.from('products').select('id, name, image_url').in('id', productIds);
            if (!prodError && products) {
                const productMap = new Map(products.map(p => [p.id, p]));
                orders.forEach(order => { if (order.product_id) order.products = productMap.get(order.product_id) || { name: 'منتج غير معروف', image_url: null }; });
            }
        }
        return orders;
    } catch (error) { console.error('Error loading seller orders:', error); return []; }
}

async function updateOrderStatus(orderId, status, extraData = {}) {
    console.log(`🔄 [updateOrderStatus] Updating order ${orderId} to status ${status}`);
    const updates = { status, ...extraData };
    const { data, error } = await supabaseClient.from('orders').update(updates).eq('id', orderId).select().maybeSingle();
    if (error) { console.error('❌ [updateOrderStatus] Error:', error); throw error; }
    console.log('✅ [updateOrderStatus] Result:', data);
    return data;
}

async function notifyDeliveryPersonsInCenter(center, orderId, title, message) {
    try {
        const { data: deliveryUsers, error } = await supabaseClient.from('user_data').select('id').eq('account_type', 'delivery').eq('center', center).eq('status', 'approved');
        if (error) throw error;
        if (!deliveryUsers || deliveryUsers.length === 0) return;
        for (const delivery of deliveryUsers) await sendNotification(delivery.id, title, message, { order_id: orderId });
        console.log(`تم إرسال إشعار لـ ${deliveryUsers.length} مندوب في مركز ${center}`);
    } catch (err) { console.warn('فشل إرسال إشعارات للمناديب', err); }
}

// ===================== دوال المناديب =====================
async function loadAvailableOrders() {
    if (!appState.user || !appState.userData.center) {
        console.warn('⚠️ المندوب ليس لديه مركز محدد');
        return [];
    }
    console.log('🔍 جلب الطلبات المتاحة للمركز:', appState.userData.center);
    try {
        const { data: orders, error } = await supabaseClient.from('orders').select('*').is('delivery_id', null).in('status', ['confirmed', 'prepared']).eq('center', appState.userData.center).order('created_at', { ascending: true });
        if (error) throw error;
        console.log(`✅ تم العثور على ${orders?.length || 0} طلب متاح`);
        if (!orders || orders.length === 0) return orders;
        const sellerIds = orders.map(o => o.seller_id).filter(id => id);
        if (sellerIds.length) {
            const { data: sellers, error: sellerError } = await supabaseClient.from('user_data').select('id, name, phone, image_url, center, village, governorate').in('id', sellerIds);
            if (!sellerError && sellers) {
                const sellerMap = new Map(sellers.map(s => [s.id, s]));
                orders.forEach(order => { if (order.seller_id) order.seller = sellerMap.get(order.seller_id); });
            }
        }
        const productIds = [...new Set(orders.map(o => o.product_id).filter(id => id))];
        if (productIds.length) {
            const { data: products, error: prodError } = await supabaseClient.from('products').select('id, name, image_url').in('id', productIds);
            if (!prodError && products) {
                const productMap = new Map(products.map(p => [p.id, p]));
                orders.forEach(order => { if (order.product_id) order.products = productMap.get(order.product_id) || { name: 'منتج غير معروف', image_url: null }; });
            }
        }
        return orders;
    } catch (error) { console.error('Error loading available orders:', error); return []; }
}

async function loadMyDeliveryOrders() {
    if (!appState.user) return [];
    try {
        const { data: orders, error } = await supabaseClient.from('orders').select('*').eq('delivery_id', appState.user.id).order('created_at', { ascending: false });
        if (error) throw error;
        if (!orders.length) return orders;
        const sellerIds = orders.map(o => o.seller_id).filter(id => id);
        const buyerIds = orders.map(o => o.buyer_id).filter(id => id);
        const ids = [...new Set([...sellerIds, ...buyerIds])];
        if (ids.length) {
            const { data: users, error: userError } = await supabaseClient.from('user_data').select('id, name, phone, image_url').in('id', ids);
            if (!userError && users) {
                const userMap = new Map(users.map(u => [u.id, u]));
                orders.forEach(order => {
                    if (order.seller_id) order.seller = userMap.get(order.seller_id);
                    if (order.buyer_id) order.buyer = userMap.get(order.buyer_id);
                });
            }
        }
        const productIds = [...new Set(orders.map(o => o.product_id).filter(id => id))];
        if (productIds.length) {
            const { data: products, error: prodError } = await supabaseClient.from('products').select('id, name, image_url').in('id', productIds);
            if (!prodError && products) {
                const productMap = new Map(products.map(p => [p.id, p]));
                orders.forEach(order => { if (order.product_id) order.products = productMap.get(order.product_id) || { name: 'منتج غير معروف', image_url: null }; });
            }
        }
        return orders;
    } catch (error) { console.error('Error loading my delivery orders:', error); return []; }
}

function isValidOrderId(id) {
    return id && id !== 'null' && id !== 'undefined' && id.trim() !== '';
}

async function claimOrder(orderId) {
    if (!isValidOrderId(orderId)) {
        console.error('❌ [claimOrder] Invalid orderId:', orderId);
        showToast('معرف الطلب غير صحيح', 'error');
        return;
    }
    if (!appState.user) {
        showToast('يجب تسجيل الدخول أولاً', 'warning');
        return;
    }
    showLoading(true);
    try {
        console.log(`🔍 [claimOrder] Attempting to claim order ${orderId} by delivery ${appState.user.id}`);
        const { data: existingOrder, error: fetchError } = await supabaseClient
            .from('orders')
            .select('status, delivery_id')
            .eq('id', orderId)
            .maybeSingle();
        if (fetchError) {
            console.error('❌ [claimOrder] Fetch error:', fetchError);
            throw fetchError;
        }
        if (!existingOrder) {
            console.warn(`⚠️ [claimOrder] Order ${orderId} not found`);
            showToast('الطلب غير موجود', 'error');
            return;
        }
        console.log(`🔍 [claimOrder] Order ${orderId} status: ${existingOrder.status}, delivery_id: ${existingOrder.delivery_id}`);

        if (existingOrder.delivery_id !== null) {
            console.warn(`⚠️ [claimOrder] Order ${orderId} already has delivery_id ${existingOrder.delivery_id}`);
            showToast('هذا الطلب تم استلامه بالفعل', 'warning');
            return;
        }
        if (!['confirmed', 'prepared'].includes(existingOrder.status)) {
            console.warn(`⚠️ [claimOrder] Order ${orderId} status is ${existingOrder.status}, not ready for pickup`);
            showToast(`الطلب ليس جاهزاً للاستلام (الحالة: ${existingOrder.status})`, 'warning');
            return;
        }

        const { data: updatedOrder, error: updateError } = await supabaseClient
            .from('orders')
            .update({ status: 'picked_up', delivery_id: appState.user.id })
            .eq('id', orderId)
            .is('delivery_id', null)
            .in('status', ['confirmed', 'prepared'])
            .select()
            .maybeSingle();

        if (updateError) {
            console.error(`❌ [claimOrder] Update error for order ${orderId}:`, updateError);
            throw updateError;
        }
        if (!updatedOrder) {
            console.warn(`⚠️ [claimOrder] Order ${orderId} was not updated (maybe already taken or status changed)`);
            showToast('فشل تحديث الطلب، ربما تم استلامه من قبل مندوب آخر أو تغيرت حالته', 'error');
            return;
        }
        console.log(`✅ [claimOrder] Order ${orderId} claimed successfully by delivery ${appState.user.id}`);

        const deliveryPerson = appState.userData;
        await sendNotification(updatedOrder.buyer_id, 'تم استلام طلبك بواسطة مندوب',
            `المندوب ${deliveryPerson.name || ''} استلم طلبك #${orderId.slice(0,8)}`);
        await sendNotification(updatedOrder.seller_id, 'تم استلام الطلب بواسطة مندوب',
            `المندوب ${deliveryPerson.name || ''} استلم طلب #${orderId.slice(0,8)}`);

        showToast('تم استلام الطلب بنجاح', 'success');
        await refreshDeliveryDashboard();
    } catch (err) {
        console.error(`❌ [claimOrder] Unexpected error for order ${orderId}:`, err);
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function rejectOrderByDelivery(orderId) {
    if (!isValidOrderId(orderId)) {
        showToast('معرف الطلب غير صحيح', 'error');
        return;
    }
    if (!appState.user) return;
    if (!confirm('هل أنت متأكد من رفض هذا الطلب؟')) return;
    showLoading(true);
    try {
        const { data: order, error } = await supabaseClient
            .from('orders')
            .update({ status: 'prepared', delivery_id: null })
            .eq('id', orderId)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!order) {
            showToast('الطلب غير موجود أو لا يمكن تحديثه', 'error');
            return;
        }
        showToast('تم رفض الطلب وعودته للقائمة المتاحة', 'success');
        await refreshDeliveryDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function pickupFromSeller(orderId) {
    if (!isValidOrderId(orderId)) {
        showToast('معرف الطلب غير صحيح', 'error');
        return;
    }
    if (!appState.user) return;
    showLoading(true);
    try {
        const { data: order, error } = await supabaseClient
            .from('orders')
            .update({ status: 'picked_up_from_seller' })
            .eq('id', orderId)
            .eq('delivery_id', appState.user.id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!order) {
            showToast('الطلب غير موجود أو غير مخصص لك', 'error');
            return;
        }
        showToast('تم تأكيد استلام الطلب من البائع', 'success');
        await refreshDeliveryDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function startDelivery(orderId) {
    if (!isValidOrderId(orderId)) {
        showToast('معرف الطلب غير صحيح', 'error');
        return;
    }
    showLoading(true);
    try {
        const otp = generateOTP(6);
        const now = new Date();
        const created = now.toISOString();
        const expiry = new Date(now.getTime() + 10 * 60 * 1000);
        const expiryISO = expiry.toISOString();

        console.log('🟢 [startDelivery] إنشاء OTP:', { orderId, otp, created, expiry: expiryISO });

        const { data: order, error } = await supabaseClient
            .from('orders')
            .update({
                status: 'in_delivery',
                otp_code: otp,
                otp_created_at: created,
                otp_expiry: expiryISO
            })
            .eq('id', orderId)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!order) {
            showToast('الطلب غير موجود أو لا يمكن تحديثه', 'error');
            return;
        }

        await sendNotification(order.buyer_id, 'الطلب في الطريق',
            `طلبك #${orderId.slice(0,8)} في طريقه إليك. رمز التأكيد: ${otp}`);
        await sendNotification(order.seller_id, 'بدأ التوصيل',
            `طلب #${orderId.slice(0,8)} بدأ توصيله بواسطة المندوب`);

        showToast('تم بدء التوصيل وتم إرسال OTP للعميل', 'success');
        await refreshDeliveryDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function generateAndSendNewOTP(orderId, buyerId) {
    const newOtp = generateOTP(6);
    const now = new Date();
    const created = now.toISOString();
    const expiry = new Date(now.getTime() + 10 * 60 * 1000);
    const expiryISO = expiry.toISOString();

    const { data: updatedOrder, error: updateError } = await supabaseClient
        .from('orders')
        .update({
            otp_code: newOtp,
            otp_created_at: created,
            otp_expiry: expiryISO
        })
        .eq('id', orderId)
        .select()
        .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedOrder) {
        showToast('فشل تحديث رمز التحقق', 'error');
        return;
    }

    await sendNotification(buyerId, 'رمز تحقق جديد',
        `تم إنشاء رمز جديد لطلبك: ${newOtp}`);
    showToast('تم إنشاء رمز جديد وإرساله للعميل، يرجى إدخاله', 'success');
}

async function completeDelivery(orderId, otpEntered) {
    if (!isValidOrderId(orderId)) {
        showToast('معرف الطلب غير صحيح', 'error');
        return;
    }
    if (!otpEntered) {
        showToast('يرجى إدخال رمز التأكيد', 'warning');
        return;
    }
    showLoading(true);
    try {
        const { data: order, error: fetchError } = await supabaseClient
            .from('orders')
            .select('otp_code, otp_created_at, otp_expiry, buyer_id, seller_id')
            .eq('id', orderId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!order) {
            showToast('الطلب غير موجود', 'error');
            return;
        }

        if (!order.otp_code) {
            await generateAndSendNewOTP(orderId, order.buyer_id);
            return;
        }

        if (order.otp_code === otpEntered) {
            const { data: updatedOrder, error: updateError } = await supabaseClient
                .from('orders')
                .update({
                    status: 'delivered',
                    otp_code: null,
                    otp_created_at: null,
                    otp_expiry: null
                })
                .eq('id', orderId)
                .select()
                .maybeSingle();

            if (updateError) throw updateError;
            if (!updatedOrder) {
                showToast('فشل تحديث الطلب، حاول مرة أخرى', 'error');
                return;
            }

            await sendNotification(updatedOrder.buyer_id, 'تم توصيل طلبك',
                `طلبك #${orderId.slice(0,8)} تم توصيله بنجاح`);
            await sendNotification(updatedOrder.seller_id, 'تم توصيل الطلب',
                `طلب #${orderId.slice(0,8)} تم توصيله بواسطة المندوب`);

            showToast('تم تأكيد التوصيل بنجاح', 'success');
            await refreshDeliveryDashboard();
            return;
        }

        showToast('رمز التأكيد غير صحيح', 'error');

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function refreshDeliveryDashboard() {
    if (!appState.user || appState.userData.account_type !== 'delivery') return;
    showLoading(true);
    try {
        const [available, my] = await Promise.all([loadAvailableOrders(), loadMyDeliveryOrders()]);
        appState.delivery.availableOrders = available;
        appState.delivery.myOrders = my;
        document.getElementById('availableOrdersCount').textContent = available.length;
        document.getElementById('myOrdersCount').textContent = my.length;
        displayAvailableOrders(available);
        displayMyDeliveryOrders(my);
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
}

function displayAvailableOrders(orders) {
    const container = document.getElementById('availableOrdersList');
    if (!container) return;
    if (orders.length === 0) { container.innerHTML = '<p style="text-align:center; padding:20px;">لا توجد طلبات متاحة حالياً</p>'; return; }
    container.innerHTML = '';
    orders.forEach(order => {
        container.appendChild(createOrderCardForDelivery(order, true));
    });
}

function displayMyDeliveryOrders(orders) {
    const container = document.getElementById('myDeliveryOrdersList');
    if (!container) return;
    if (orders.length === 0) { container.innerHTML = '<p style="text-align:center; padding:20px;">لم تقم باستلام أي طلبات بعد</p>'; return; }
    container.innerHTML = '';
    orders.forEach(order => {
        container.appendChild(createOrderCardForDelivery(order, false));
    });
}

function createOrderCardForDelivery(order, isAvailable) {
    const card = document.createElement('div');
    card.className = 'order-card';
    const product = order.products || {};
    const imageHtml = product.image_url ? `<img src="${product.image_url}" loading="lazy">` : '📦';
    const seller = order.seller || {};
    const sellerImage = seller.image_url ? `<img src="${seller.image_url}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:1.2rem;"></i>';

    let actionsHtml = '';
    if (isAvailable) {
        const sellerInfo = `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:0.9rem;">
            ${sellerImage}
            <span><strong>البائع:</strong> ${escapeHTML(seller.name || 'غير معروف')}</span>
            ${seller.phone ? `<a href="tel:${seller.phone}" style="color:#1a237e;"><i class="fas fa-phone"></i></a>` : ''}
            <a href="https://wa.me/${seller.phone || ''}" target="_blank" style="color:#25D366;"><i class="fab fa-whatsapp"></i></a>
            <a href="https://www.google.com/maps/search/${encodeURIComponent(seller.center || '')}" target="_blank" style="color:#ff5722;"><i class="fas fa-map-marker-alt"></i></a>
        </div>`;
        actionsHtml = `
            ${sellerInfo}
            <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
                <button class="add-to-cart" onclick="claimOrder('${order.id}')"><i class="fas fa-box-open"></i> استلام الطلب</button>
                <button class="action-btn-danger" onclick="rejectOrderByDelivery('${order.id}')"><i class="fas fa-times"></i> رفض</button>
            </div>
        `;
    } else {
        const buyer = order.buyer || {};
        const buyerInfo = `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:0.9rem;">
            <i class="fas fa-user"></i>
            <span><strong>العميل:</strong> ${escapeHTML(buyer.name || 'غير معروف')}</span>
            ${buyer.phone ? `<a href="tel:${buyer.phone}" style="color:#1a237e;"><i class="fas fa-phone"></i></a>` : ''}
            <a href="https://wa.me/${buyer.phone || ''}" target="_blank" style="color:#25D366;"><i class="fab fa-whatsapp"></i></a>
            <a href="https://www.google.com/maps/search/${encodeURIComponent(order.shipping_address || '')}" target="_blank" style="color:#ff5722;"><i class="fas fa-map-marker-alt"></i></a>
        </div>`;
        let statusActions = '';
        if (order.status === 'picked_up') {
            statusActions = `<button class="add-to-cart" onclick="pickupFromSeller('${order.id}')"><i class="fas fa-hand-holding"></i> تم الاستلام من البائع</button>`;
        } else if (order.status === 'picked_up_from_seller') {
            statusActions = `<button class="add-to-cart" style="background:#ff9800;" onclick="startDelivery('${order.id}')"><i class="fas fa-truck"></i> بدء التوصيل</button>`;
        } else if (order.status === 'in_delivery') {
            const inputId = `otpInput_${order.id}`;
            statusActions = `
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center;">
                    <input type="text" id="${inputId}" 
                           style="flex:1;min-width:120px;padding:10px 14px;
                                  color:#000000 !important; 
                                  background:#ffffff !important;
                                  border:2px solid #1a237e !important;
                                  border-radius:8px !important;
                                  font-size:18px !important;
                                  font-weight:bold !important;
                                  direction:ltr !important;
                                  text-align:left !important;
                                  pointer-events:auto !important;
                                  opacity:1 !important;
                                  box-shadow:inset 0 2px 4px rgba(0,0,0,0.1);"
                           placeholder="أدخل الرمز (6 أرقام)" 
                           maxlength="6" 
                           inputmode="numeric" 
                           autocomplete="off"
                           autofocus>
                    <button class="add-to-cart" style="background:#4caf50;white-space:nowrap;" 
                            onclick="completeDelivery('${order.id}', document.getElementById('${inputId}').value)">
                        <i class="fas fa-check-circle"></i> تأكيد التوصيل
                    </button>
                </div>
                <div style="font-size:0.8rem;color:#666;margin-top:4px;">⚠️ تأكد من إدخال الرمز الصحيح المكون من 6 أرقام</div>
            `;
        }
        actionsHtml = `
            ${buyerInfo}
            <div><strong>العنوان:</strong> ${order.shipping_address || 'غير محدد'}</div>
            <div><strong>قيمة الطلب:</strong> ${order.total_price} ج.م (رسوم التوصيل: ${order.delivery_fee || 0})</div>
            ${statusActions}
        `;
    }

    card.innerHTML = `<div class="order-header"><span class="order-id">#${order.id.slice(0,8)}</span><span class="order-status ${order.status}">${getStatusText(order.status)}</span></div>
        <div class="order-product"><div class="order-product-image">${imageHtml}</div>
        <div class="order-product-details"><div>${escapeHTML(product.name || 'منتج')}</div><div>الكمية: ${order.quantity}</div><div>الإجمالي: ${order.total_price} ج.م</div></div></div>
        ${actionsHtml}`;
    return card;
}

function switchDeliveryTab(tab) {
    appState.delivery.currentTab = tab;
    document.querySelectorAll('#deliveryDashboardScreen .seller-tab').forEach((t, i) => {
        t.classList.toggle('active', (tab === 'available' && i === 0) || (tab === 'my' && i === 1));
    });
    document.getElementById('availableOrdersTab').style.display = tab === 'available' ? 'block' : 'none';
    document.getElementById('myOrdersTab').style.display = tab === 'my' ? 'block' : 'none';
}

// ===================== تصدير الدوال العامة =====================
window.syncCartFromDB = syncCartFromDB;
window.addToCart = addToCart;
window.updateQuantity = updateQuantity;
window.removeFromCart = removeFromCart;
window.loadCart = loadCart;
window.updateCartBadgeFromDB = updateCartBadgeFromDB;
window.clearCartAfterOrder = clearCartAfterOrder;
window.openCheckout = openCheckout;
window.closeCheckoutModal = closeCheckoutModal;
window.confirmOrder = confirmOrder;
window.createOrder = createOrder;
window.toggleSelectAll = toggleSelectAll;
window.deselectAll = deselectAll;
window.deleteSelected = deleteSelected;
window.saveForLater = saveForLater;
window.loadBuyerOrders = loadBuyerOrders;
window.cancelOrder = cancelOrder;
window.getStatusText = getStatusText;
window.generateTimeline = generateTimeline;
window.loadBuyerOrdersWithTimeline = loadBuyerOrdersWithTimeline;
window.loadSellerOrders = loadSellerOrders;
window.updateOrderStatus = updateOrderStatus;
window.notifyDeliveryPersonsInCenter = notifyDeliveryPersonsInCenter;
window.loadAvailableOrders = loadAvailableOrders;
window.loadMyDeliveryOrders = loadMyDeliveryOrders;
window.claimOrder = claimOrder;
window.rejectOrderByDelivery = rejectOrderByDelivery;
window.pickupFromSeller = pickupFromSeller;
window.startDelivery = startDelivery;
window.completeDelivery = completeDelivery;
window.refreshDeliveryDashboard = refreshDeliveryDashboard;
window.displayAvailableOrders = displayAvailableOrders;
window.displayMyDeliveryOrders = displayMyDeliveryOrders;
window.createOrderCardForDelivery = createOrderCardForDelivery;
window.switchDeliveryTab = switchDeliveryTab;
window.filterBuyerOrders = filterBuyerOrders;
window.setOrdersFilter = setOrdersFilter;
window.renderFilteredOrders = renderFilteredOrders;
window.createBuyerOrderCard = createBuyerOrderCard;
window.deleteBuyerOrder = deleteBuyerOrder;
