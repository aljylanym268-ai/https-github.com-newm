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
    if (typeof fillCheckoutFormFromUserData === 'function') fillCheckoutFormFromUserData('checkout');
    if (typeof setupCheckoutLocationSelectors === 'function') setupCheckoutLocationSelectors('checkout');
    document.getElementById('checkoutModal').classList.add('active');
}
function closeCheckoutModal() { document.getElementById('checkoutModal').classList.remove('active'); }

// ========== إنشاء طلب ==========
async function createOrder(productId, quantity, totalPrice, sellerId, customerName, customerPhone, shippingAddress, center, deliveryFee = 0) {
    if (!appState.user) throw new Error('يجب تسجيل الدخول');
    console.log(`📦 [createOrder] Creating order for product ${productId}, quantity ${quantity}, total ${totalPrice}`);

    let sellerSnapshot = {
        seller_name: null,
        seller_phone: null,
        seller_address: null,
        seller_center: null,
        seller_governorate: null
    };

    if (sellerId) {
        const { data: seller, error: sellerError } = await supabaseClient
            .from('user_data')
            .select('name, full_name, shop_name, store_name, display_name, phone, mobile, phone_number, address, street_address, shop_address, center, governorate, village')
            .eq('id', sellerId)
            .maybeSingle();

        if (!sellerError && seller) {
            const sellerName = seller.name || seller.full_name || seller.shop_name || seller.store_name || seller.display_name || 'بائع غير معروف';
            const sellerPhone = seller.phone || seller.mobile || seller.phone_number || null;
            const sellerAddressParts = [seller.governorate, seller.center, seller.village, seller.address, seller.street_address, seller.shop_address].filter(Boolean);
            const sellerAddress = sellerAddressParts.join(' - ') || seller.address || seller.center || seller.governorate || null;
            sellerSnapshot = {
                seller_name: sellerName,
                seller_phone: sellerPhone,
                seller_address: sellerAddress,
                seller_center: seller.center || null,
                seller_governorate: seller.governorate || null
            };
        }
    }

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
        seller_name: sellerSnapshot.seller_name,
        seller_phone: sellerSnapshot.seller_phone,
        seller_address: sellerSnapshot.seller_address,
        seller_center: sellerSnapshot.seller_center,
        seller_governorate: sellerSnapshot.seller_governorate,
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
    const governorate = document.getElementById('checkoutGovernorate')?.value || '';
    const center = document.getElementById('checkoutCenter')?.value || '';
    if (!name || !phone || !address || !governorate || !center) { showToast('يرجى ملء جميع الحقول المطلوبة', 'warning'); return; }
    const phoneRegex = /^01[0125][0-9]{8}$/;
    if (!phoneRegex.test(phone)) { showToast('رقم الهاتف غير صحيح', 'error'); return; }
    if (typeof saveAddressAsDefaultIfRequested === 'function') {
        await saveAddressAsDefaultIfRequested('checkout', governorate, center, address, phone);
    }
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

        // جلب طلبات الاسترجاع الخاصة بالمشتري وربطها بالطلبات
        try {
            const { data: returnsData } = await supabaseClient.from('returns').select('*').eq('buyer_id', appState.user.id);
            if (returnsData && returnsData.length) {
                const returnMap = new Map();
                returnsData.forEach(r => {
                    if (!returnMap.has(r.order_id) || new Date(r.requested_at) > new Date(returnMap.get(r.order_id).requested_at)) {
                        returnMap.set(r.order_id, r);
                    }
                });
                orders.forEach(order => {
                    if (returnMap.has(order.id)) {
                        order.return_request = returnMap.get(order.id);
                    }
                });
            }
        } catch (retErr) {
            console.warn('تحذير أثناء جلب المرتجعات:', retErr);
        }

        const productIds = [...new Set(orders.map(o => o.product_id).filter(id => id))];
        let productMap = new Map();
        if (productIds.length) {
            const { data: products, error: prodError } = await supabaseClient.from('products').select('id, name, image_url, user_id').in('id', productIds);
            if (!prodError && products) {
                productMap = new Map(products.map(p => [p.id, p]));
                orders.forEach(order => { if (order.product_id) order.products = productMap.get(order.product_id) || { name: 'منتج غير معروف', image_url: null }; });
            }
        }

        const sellerIds = [...new Set(orders.map(order => order.seller_id || (order.product_id && productMap.get(order.product_id)?.user_id)).filter(Boolean))];
        if (sellerIds.length) {
            const { data: sellers, error: sellerError } = await supabaseClient.from('user_data').select('id, name, full_name, shop_name, store_name, display_name, phone, mobile, phone_number, image_url, center, village, governorate, address, street_address, shop_address').in('id', sellerIds);
            if (!sellerError && sellers) {
                const sellerMap = new Map(sellers.map(s => [s.id, normalizeSellerRecord(s)]));
                orders.forEach(order => {
                    const resolvedSellerId = order.seller_id || (order.product_id && productMap.get(order.product_id)?.user_id);
                    if (resolvedSellerId && sellerMap.has(resolvedSellerId)) {
                        order.seller = sellerMap.get(resolvedSellerId);
                    }
                });
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
async function deleteBuyerOrder(orderId) {
    if (!confirm('هل أنت متأكد من حذف هذا الطلب نهائياً؟')) return;
    showLoading(true);
    try {
        // محاولة الحذف الحقيقي من قاعدة البيانات
        const { data: deleted, error: deleteError } = await supabaseClient
            .from('orders')
            .delete()
            .eq('id', orderId)
            .select()
            .maybeSingle();

        if (deleteError) throw deleteError;

        if (deleted) {
            console.log(`✅ [deleteBuyerOrder] Order ${orderId} deleted from database`);
            showToast('تم حذف الطلب نهائياً', 'success');
        } else {
            // الصلاحيات (RLS) تمنع الحذف → نحفظ الإخفاء بشكل دائم محلياً
            console.warn(`⚠️ [deleteBuyerOrder] Delete blocked by RLS, hiding locally for order ${orderId}`);
            hideOrderLocally(orderId);
            showToast('تم حذف الطلب من قائمتك', 'success');
        }

        // إزالة الطلب من المصفوفة المحلية وتحديث العرض
        if (appState.buyerOrders) {
            appState.buyerOrders = appState.buyerOrders.filter(o => o.id !== orderId);
        }

        // تحديث عداد الطلبات في الملف الشخصي
        const profileOrdersCountEl = document.getElementById('profileOrdersCount');
        if (profileOrdersCountEl && appState.buyerOrders) {
            profileOrdersCountEl.textContent = appState.buyerOrders.length;
        }

        renderFilteredOrders();

        // إذا لم يعد هناك طلبات، عرض رسالة "لا توجد طلبات"
        if (!appState.buyerOrders || appState.buyerOrders.length === 0) {
            const container = document.getElementById('buyerOrdersList');
            const emptyMsg = document.getElementById('ordersEmptyMessage');
            if (container) container.innerHTML = '';
            if (emptyMsg) emptyMsg.style.display = 'block';
        }
    } catch (err) {
        console.error('❌ [deleteBuyerOrder] Error:', err);
        showToast(err.message || 'حدث خطأ أثناء حذف الطلب', 'error');
    } finally {
        showLoading(false);
    }
}

// ========== إخفاء الطلب محلياً بشكل دائم (عند منع الحذف) ==========
function hideOrderLocally(orderId) {
    try {
        const hidden = JSON.parse(localStorage.getItem('msaar_hidden_orders') || '[]');
        if (!hidden.includes(orderId)) hidden.push(orderId);
        localStorage.setItem('msaar_hidden_orders', JSON.stringify(hidden));
    } catch (e) { console.warn('تعذر حفظ الإخفاء', e); }
}

// ========== جلب الطلبات مع استبعاد المخفيين ==========
function getVisibleOrders(orders) {
    let hidden = [];
    try { hidden = JSON.parse(localStorage.getItem('msaar_hidden_orders') || '[]'); } catch (e) {}
    return orders.filter(o => !hidden.includes(o.id));
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
        { key: 'pending', label: 'تم الطلب', icon: 'fa-clipboard-list' },
        { key: 'confirmed', label: 'تم التأكيد', icon: 'fa-check' },
        { key: 'prepared', label: 'تم التجهيز', icon: 'fa-box' },
        { key: 'picked_up', label: 'استلمه المندوب', icon: 'fa-motorcycle' },
        { key: 'picked_up_from_seller', label: 'استلم من البائع', icon: 'fa-hand-holding' },
        { key: 'in_delivery', label: 'في الطريق', icon: 'fa-truck' },
        { key: 'delivered', label: 'تم التوصيل', icon: 'fa-house' }
    ];

    // في حالة الإلغاء نعرض خطوة واحدة حمراء فقط
    if (currentStatus === 'cancelled') {
        return `<div class="timeline-steps">
            <div class="timeline-step cancelled">
                <div class="timeline-dot"><i class="fas fa-times"></i></div>
                <div class="timeline-label">تم إلغاء الطلب</div>
            </div>
        </div>`;
    }

    const statusIndex = steps.findIndex(s => s.key === currentStatus);
    const effectiveIndex = statusIndex === -1 ? 0 : statusIndex;

    // عرض الخطوات التي حدثت فعلاً فقط (وحدة وحدة) + الخطوة الحالية بنبض
    let html = '<div class="timeline-steps">';
    steps.forEach((step, idx) => {
        if (idx > effectiveIndex) return; // الخطوات التي لم تحدث بعد لا تظهر
        const isCurrent = idx === effectiveIndex && currentStatus !== 'delivered';
        const state = isCurrent ? 'current' : 'done';
        const icon = isCurrent ? `<i class="fas ${step.icon}"></i>` : '<i class="fas fa-check"></i>';
        const label = isCurrent ? `${step.label} <span class="timeline-now">الآن</span>` : step.label;
        html += `<div class="timeline-step ${state}">
            <div class="timeline-dot">${icon}</div>
            <div class="timeline-label">${label}</div>
        </div>`;
    });

    // تلميح بالخطوة القادمة (رمادي خفيف)
    const next = steps[effectiveIndex + 1];
    if (next) {
        html += `<div class="timeline-next"><i class="fas fa-hourglass-half"></i> في انتظار: ${next.label}</div>`;
    }
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
    let filtered = getVisibleOrders(appState.buyerOrders || []);
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

    let returnHtml = '';
    if (order.return_request) {
        const ret = order.return_request;
        const status = ret.status;
        if (status === 'pending') {
            returnHtml = `
      <div style="margin-top:10px; padding:12px; background:#fff8e1; border-radius:10px; border:1px solid #ffe082;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:bold; color:#b78103;"><i class="fas fa-hourglass-half"></i> تم إرسال طلب الاسترجاع</span>
          <span style="font-size:0.8rem; background:#fff3e0; padding:3px 10px; border-radius:12px; color:#e65100; font-weight:bold;">قيد المراجعة</span>
        </div>
        <div style="font-size:0.9rem; color:#5d4037; margin-top:6px; font-weight:500;">
          ⏳ سيتم الاسترجاع في أقرب وقت والتواصل معك لاستلام المنتج.
        </div>
        ${ret.return_reason ? `<div style="font-size:0.82rem; color:#8d6e63; margin-top:4px;"><strong>سبب الاسترجاع:</strong> ${escapeHTML(ret.return_reason)}</div>` : ''}
      </div>
    `;
        } else if (status === 'approved') {
            returnHtml = `
      <div style="margin-top:10px; padding:12px; background:#e8f5e9; border-radius:10px; border:1px solid #81c784;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:bold; color:#2e7d32;"><i class="fas fa-check-circle"></i> تم قبول طلب الاسترجاع</span>
          <span style="font-size:0.8rem; background:#c8e6c9; padding:3px 10px; border-radius:12px; color:#1b5e20; font-weight:bold;">تم القبول</span>
        </div>
        <div style="font-size:0.9rem; color:#2e7d32; margin-top:6px; font-weight:500;">
          ✅ وافق البائع على طلب الاسترجاع، وسيتم إسناد مندوب لاستلام المنتج منك في أقرب وقت.
        </div>
      </div>
    `;
        } else if (status === 'assigned' || status === 'courier_on_way_to_customer') {
            returnHtml = `
      <div style="margin-top:10px; padding:12px; background:#e3f2fd; border-radius:10px; border:1px solid #90caf9;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:bold; color:#1565c0;">
          <i class="fas fa-shipping-fast"></i> المندوب في طريقه إليك لاستلام المرتجع
        </div>
        <div style="font-size:0.85rem; color:#0d47a1; margin-top:4px;">
          يرجى تجهيز المنتج مع ملحقاته لتسليمه للمندوب.
        </div>
      </div>
    `;
        } else if (status === 'picked_up_from_customer' || status === 'courier_on_way_to_seller') {
            returnHtml = `
      <div style="margin-top:10px; padding:12px; background:#e8eaf6; border-radius:10px; border:1px solid #9fa8da;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:bold; color:#283593;">
          <i class="fas fa-box-check"></i> تم استلام المنتج من المندوب
        </div>
        <div style="font-size:0.85rem; color:#3949ab; margin-top:4px;">
          المنتج في الطريق إلى البائع لإتمام عملية الاسترجاع.
        </div>
      </div>
    `;
        } else if (status === 'delivered_to_seller' || status === 'completed') {
            returnHtml = `
      <div style="margin-top:10px; padding:12px; background:#e8f5e9; border-radius:10px; border:1px solid #a5d6a7;">
        <div style="display:flex; align-items:center; gap:8px; font-weight:bold; color:#1b5e20;">
          <i class="fas fa-check-double"></i> تم الاسترجاع بنجاح
        </div>
        <div style="font-size:0.85rem; color:#2e7d32; margin-top:4px;">
          تم استلام المرتجع بواسطة البائع وإتمام العملية بنجاح.
        </div>
      </div>
    `;
        } else if (status === 'rejected') {
            returnHtml = `
      <div style="margin-top:10px; padding:12px; background:#ffebee; border-radius:10px; border:1px solid #ef9a9a;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:bold; color:#c62828;"><i class="fas fa-times-circle"></i> تم رفض طلب الاسترجاع</span>
          <span style="font-size:0.8rem; background:#ffcdd2; padding:3px 10px; border-radius:12px; color:#b71c1c; font-weight:bold;">مرفوض</span>
        </div>
        ${ret.rejection_reason ? `<div style="font-size:0.85rem; color:#b71c1c; margin-top:4px;"><strong>سبب الرفض:</strong> ${escapeHTML(ret.rejection_reason)}</div>` : ''}
      </div>
    `;
        }
    } else if (order.status === 'delivered' && order.delivered_at) {
        const remaining = getReturnTimeRemaining(order);
        if (remaining) {
            returnHtml = `
      <div style="margin-top:10px; padding:10px; background:#e8f5e9; border-radius:10px; border:1px solid #4caf50;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
          <span><i class="fas fa-clock" style="color:#2e7d32;"></i> <strong>متاح للاسترجاع</strong></span>
          <span style="font-weight:900; color:#1a237e; font-size:1.1rem;" id="timer_${order.id}">${remaining}</span>
        </div>
        <button class="add-to-cart" onclick="openReturnModal('${order.id}')" style="margin-top:8px; background:#ff9800; color:#fff; border:none; padding:8px 16px; border-radius:30px; font-weight:700; cursor:pointer;">
          <i class="fas fa-undo-alt"></i> طلب استرجاع
        </button>
      </div>
    `;
            // بدء تحديث العداد كل ثانية
            startReturnTimer(order.id, order.delivered_at);
        } else {
            returnHtml = `
      <div style="margin-top:10px; padding:10px; background:#ffebee; border-radius:10px; border:1px solid #ef5350;">
        <span style="color:#c62828;"><i class="fas fa-times-circle"></i> انتهت مدة الاسترجاع لهذا الطلب</span>
      </div>
    `;
        }
    }

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
        <div style="margin-top:6px; padding-top:6px; border-top:1px dashed var(--gold, #d4af37); font-weight:800; color:var(--gold, #d4af37); display:flex; justify-content:space-between; align-items:center;">
            <span><i class="fas fa-calculator"></i> الإجمالي</span>
            <span>${Number(order.total_price || 0).toFixed(0)} ج.م</span>
        </div>
        <div class="order-timeline" style="margin-top:15px;">${timeline}</div>
        ${returnHtml}
        ${otpDisplay}${deliveryHtml}
        ${actionsHtml}`;

    return card;
}

async function loadBuyerOrdersWithTimeline() {
    const orders = await loadBuyerOrders();
    const container = document.getElementById('buyerOrdersList');
    if (!container) return;

    // تخزين الطلبات في الحالة العامة للتصفية (مع استبعاد المحذوفين/المخفيين)
    appState.buyerOrders = getVisibleOrders(orders);

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
function normalizeSellerRecord(record) {
    if (!record || typeof record !== 'object') return null;
    const normalized = { ...record };
    normalized.name = normalized.name || normalized.full_name || normalized.shop_name || normalized.store_name || normalized.display_name || normalized.seller_name || 'بائع غير معروف';
    normalized.phone = normalized.phone || normalized.mobile || normalized.phone_number || normalized.seller_phone || 'غير متوفر';
    const addressParts = [normalized.governorate, normalized.center, normalized.village, normalized.address, normalized.street_address, normalized.shop_address, normalized.seller_address].filter(part => typeof part === 'string' ? part.trim() : part);
    normalized.address = addressParts.join(' - ') || normalized.seller_address || 'عنوان البائع غير محدد';
    normalized.center = normalized.center || normalized.seller_center || 'غير محدد';
    normalized.governorate = normalized.governorate || normalized.seller_governorate || 'غير محدد';
    return normalized;
}

async function hydrateOrderSellerData(orders) {
    if (!orders || !orders.length) return orders || [];

    const productIds = [...new Set(orders.map(order => order.product_id).filter(Boolean))];
    let productMap = new Map();
    if (productIds.length) {
        const { data: products, error: prodError } = await supabaseClient.from('products').select('id, user_id, name, image_url').in('id', productIds);
        if (!prodError && products) {
            productMap = new Map(products.map(product => [product.id, product]));
        }
    }

    const sellerIds = [...new Set(orders.map(order => order.seller_id || (order.product_id && productMap.get(order.product_id)?.user_id)).filter(Boolean))];
    let sellerMap = new Map();
    if (sellerIds.length) {
        const { data: sellers, error: sellerError } = await supabaseClient
            .from('user_data')
            .select('id, name, full_name, shop_name, store_name, display_name, phone, mobile, phone_number, image_url, center, village, governorate, address, street_address, shop_address, city')
            .in('id', sellerIds);
        if (!sellerError && sellers) {
            sellerMap = new Map(sellers.map(seller => [seller.id, normalizeSellerRecord(seller)]));
        } else {
            console.warn('⚠️ [hydrateOrderSellerData] فشل جلب بيانات البائعين:', sellerError);
        }
    }

    orders.forEach(order => {
        const resolvedSellerId = order.seller_id || (order.product_id && productMap.get(order.product_id)?.user_id);
        const mappedSeller = order.seller && order.seller.id ? normalizeSellerRecord(order.seller) : null;
        const sellerFromMap = resolvedSellerId ? sellerMap.get(resolvedSellerId) : null;
        // Snapshot fields stored on orders (added by migration) can be used when user_data is not readable due to RLS
        const orderSellerSnapshot = {
            name: order.seller_name || null,
            phone: order.seller_phone || null,
            center: order.seller_center || null,
            governorate: order.seller_governorate || null,
            address: order.seller_address || null
        };
        // Prefer live seller data (mappedSeller), then sellerFromMap (from user_data), then order snapshot, then sensible fallback
        const seller = mappedSeller || sellerFromMap || (orderSellerSnapshot.name || orderSellerSnapshot.phone || orderSellerSnapshot.address || orderSellerSnapshot.center || orderSellerSnapshot.governorate ? orderSellerSnapshot : {
            name: 'بائع غير معروف',
            phone: 'غير متوفر',
            center: order.center || 'غير محدد',
            governorate: order.governorate || 'غير محدد',
            address: order.shipping_address || 'عنوان البائع غير محدد'
        });
        order.seller = normalizeSellerRecord(seller) || seller;
        order.products = (order.product_id && productMap.get(order.product_id)) || { name: 'منتج غير معروف', image_url: null };
    });

    return orders;
}

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
        return await hydrateOrderSellerData(orders);
    } catch (error) { console.error('Error loading available orders:', error); return []; }
}

async function loadMyDeliveryOrders() {
    if (!appState.user) return [];
    try {
        const { data: orders, error } = await supabaseClient.from('orders').select('*').eq('delivery_id', appState.user.id).order('created_at', { ascending: false });
        if (error) throw error;
        if (!orders.length) return orders;
        const hydratedOrders = await hydrateOrderSellerData(orders);
        const buyerIds = [...new Set(hydratedOrders.map(o => o.buyer_id).filter(id => id))];
        let userMap = new Map();
        if (buyerIds.length) {
            const { data: users, error: userError } = await supabaseClient.from('user_data').select('id, name, phone, image_url, center, village, governorate, address').in('id', buyerIds);
            if (!userError && users) {
                userMap = new Map(users.map(u => [u.id, u]));
            } else {
                console.warn('⚠️ [loadMyDeliveryOrders] فشل جلب بيانات المستخدمين:', userError);
            }
        }
        hydratedOrders.forEach(order => {
            if (order.buyer_id && userMap.has(order.buyer_id)) {
                order.buyer = userMap.get(order.buyer_id);
            } else {
                order.buyer = { name: order.customer_name || 'العميل', phone: order.customer_phone || 'غير متوفر', address: order.shipping_address || 'العنوان غير محدد' };
            }
        });
        return hydratedOrders;
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
        const availCountEl = document.getElementById('availableOrdersCount');
        if (availCountEl) availCountEl.textContent = available.length;
        const myCountEl = document.getElementById('myOrdersCount');
        if (myCountEl) myCountEl.textContent = my.length;
        displayAvailableOrders(available);
        displayMyDeliveryOrders(my);

        if (typeof displayDeliveryReturns === 'function') {
            await displayDeliveryReturns();
        }
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

// ========== دالة إخفاء رقم الهاتف (تظهر أول رقمين وآخر رقمين فقط) ==========
function maskPhone(phone) {
    if (!phone) return 'غير متوفر';
    const str = String(phone);
    if (str.length < 10) return str; // لو الرقم قصير جداً
    return str.slice(0, 2) + '********' + str.slice(-2);
}

// ========== إنشاء بطاقة الطلب للمندوب (مع التحكم في إظهار البيانات حسب الحالة) ==========
function createOrderCardForDelivery(order, isAvailable) {
    const card = document.createElement('div');
    card.className = 'order-card';
    const product = order.products || {};
    const imageHtml = product.image_url ? `<img src="${product.image_url}" loading="lazy">` : '📦';

    // بيانات البائع (نأخذها من order.seller أو نبحث عنها)
    const seller = order.seller || {};
    const sellerImage = seller.image_url ? `<img src="${seller.image_url}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">` : '<i class="fas fa-store" style="font-size:1.2rem;"></i>';

    // بيانات العميل
    const buyer = order.buyer || {};

    // --- معلومات إضافية عن الطلب ---
    const paymentMethod = order.payment_method || 'نقدي'; // افتراضي
    const notes = order.notes || '';
    const deliveryFee = order.delivery_fee || 0;
    const totalPrice = order.total_price || 0;
    const estimatedTime = 'حوالي 30-45 دقيقة'; // يمكن جلبها من API أو حسابها

    // --- عنوان البائع التفصيلي (يظهر دائماً في كل الحالات) ---
    const sellerFullAddress = [seller.governorate, seller.center, seller.village, seller.address].filter(Boolean).join(' - ') || seller.address || seller.center || 'عنوان البائع غير محدد';
    // --- عنوان العميل التفصيلي ---
    const buyerFullAddress = order.shipping_address || buyer.address || buyer.center || order.center || 'العنوان غير محدد';

    // --- المتغيرات التي ستتغير حسب isAvailable ---
    let buyerPhoneDisplay = '';
    let buyerAddressDisplay = '';
    let sellerPhoneDisplay = '';
    let sellerAddressDisplay = '';
    let actionButtonsHtml = '';
    let contactButtonsHtml = '';

    if (isAvailable) {
        // =====================================================
        // 1. حالة "طلبات متاحة" (قبل الاستلام)
        // الأرقام مخفية، والعنوان الكامل غير معروض، ولا توجد أزرار اتصال
        // =====================================================
        buyerPhoneDisplay = maskPhone(buyer.phone || order.customer_phone); // مخفي جزئياً
        buyerAddressDisplay = buyerFullAddress; // العنوان التفصيلي
        sellerPhoneDisplay = maskPhone(seller.phone); // مخفي جزئياً
        sellerAddressDisplay = sellerFullAddress; // العنوان التفصيلي للبائع

        // زر الإجراء الوحيد: استلام الطلب (مع معلومات كافية عن المنتج والمنطقة)
        actionButtonsHtml = `
            <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
                <button class="add-to-cart" onclick="claimOrder('${order.id}')" style="flex:1;">
                    <i class="fas fa-box-open"></i> استلام الطلب
                </button>
                <button class="action-btn-danger" onclick="rejectOrderByDelivery('${order.id}')" style="flex:0 0 auto;">
                    <i class="fas fa-times"></i> رفض
                </button>
            </div>
        `;

        // لا توجد أزرار اتصال أو خريطة
        contactButtonsHtml = '';

    } else {
        // =====================================================
        // 2. حالة "طلباتي" (بعد الاستلام)
        // البيانات كاملة مع أزرار الاتصال
        // =====================================================
        buyerPhoneDisplay = buyer.phone || order.customer_phone || 'غير متوفر'; // كامل
        buyerAddressDisplay = buyerFullAddress; // العنوان التفصيلي
        sellerPhoneDisplay = seller.phone || 'غير متوفر'; // كامل
        sellerAddressDisplay = sellerFullAddress; // العنوان التفصيلي للبائع

        // أزرار الاتصال بالعميل
        const buyerContact = `
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:4px;">
                <a href="tel:${buyerPhoneDisplay}" style="background:#1a237e; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-phone"></i> اتصال</a>
                <a href="https://wa.me/${buyerPhoneDisplay}" target="_blank" style="background:#25D366; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fab fa-whatsapp"></i> واتساب</a>
                <a href="https://www.google.com/maps/search/${encodeURIComponent(buyerAddressDisplay)}" target="_blank" style="background:#ff5722; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
            </div>
        `;

        // أزرار الاتصال بالبائع
        const sellerContact = `
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:4px;">
                <a href="tel:${sellerPhoneDisplay}" style="background:#1a237e; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-phone"></i> اتصال</a>
                <a href="https://wa.me/${sellerPhoneDisplay}" target="_blank" style="background:#25D366; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fab fa-whatsapp"></i> واتساب</a>
                <a href="https://www.google.com/maps/search/${encodeURIComponent(sellerAddressDisplay)}" target="_blank" style="background:#ff5722; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:0.8rem; display:inline-flex; align-items:center; gap:4px;"><i class="fas fa-map-marker-alt"></i> الخريطة</a>
            </div>
        `;

        contactButtonsHtml = `
            <div style="margin-top:10px; padding:10px; background:#f5f7fa; border-radius:8px; border:1px solid #e0e0e0;">
                <div style="font-weight:bold; color:#1976d2; margin-bottom:4px;"><i class="fas fa-user"></i> بيانات العميل:</div>
                <div><strong>الاسم:</strong> ${escapeHTML(buyer.name || order.customer_name || 'غير معروف')}</div>
                <div><strong>الهاتف:</strong> <span dir="ltr">${escapeHTML(buyerPhoneDisplay)}</span></div>
                <div><strong>العنوان:</strong> ${escapeHTML(buyerAddressDisplay)}</div>
                ${buyerContact}
            </div>
            <div style="margin-top:8px; padding:10px; background:#fef8e8; border-radius:8px; border:1px solid #ffe0b2;">
                <div style="font-weight:bold; color:#f57c00; margin-bottom:4px;"><i class="fas fa-store"></i> بيانات البائع:</div>
                <div><strong>الاسم:</strong> ${escapeHTML(seller.name || 'غير معروف')}</div>
                <div><strong>الهاتف:</strong> <span dir="ltr">${escapeHTML(sellerPhoneDisplay)}</span></div>
                <div><strong>العنوان:</strong> ${escapeHTML(sellerAddressDisplay)}</div>
                ${sellerContact}
            </div>
        `;

        // أزرار التحكم في حالة الطلب (حسب الحالة الحالية)
        let statusActions = '';
        if (order.status === 'picked_up') {
            statusActions = `<button class="add-to-cart" onclick="pickupFromSeller('${order.id}')"><i class="fas fa-hand-holding"></i> تم الاستلام من البائع</button>`;
        } else if (order.status === 'picked_up_from_seller') {
            statusActions = `<button class="add-to-cart" style="background:#ff9800;" onclick="startDelivery('${order.id}')"><i class="fas fa-truck"></i> بدء التوصيل</button>`;
        } else if (order.status === 'in_delivery') {
            const inputId = `otpInput_${order.id}`;
            statusActions = `
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;align-items:center;">
                    <input type="text" id="${inputId}" style="flex:1;min-width:120px;padding:10px 14px; border:2px solid #1a237e; border-radius:8px; direction:ltr; text-align:left; font-weight:bold; color:#000; background:#fff;" placeholder="رمز OTP (6 أرقام)" maxlength="6" inputmode="numeric" autocomplete="off">
                    <button class="add-to-cart" style="background:#4caf50;white-space:nowrap;" onclick="completeDelivery('${order.id}', document.getElementById('${inputId}').value)">
                        <i class="fas fa-check-circle"></i> تأكيد التوصيل
                    </button>
                </div>
            `;
        }

        actionButtonsHtml = `
            <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
                ${statusActions}
            </div>
        `;
    }

    // =========================================================
    // بناء بطاقة الطلب الكاملة (المعلومات المشتركة بين الحالتين)
    // =========================================================
    const sellerInfoHtml = `
        <div style="display:flex; align-items:center; gap:8px; margin:5px 0; font-size:0.9rem; flex-wrap:wrap;">
            ${sellerImage}
            <span><strong>البائع:</strong> ${escapeHTML(seller.name || 'غير معروف')}</span>
            <span style="color:#888; font-size:0.8rem;">| الهاتف: ${escapeHTML(sellerPhoneDisplay)}</span>
            <span style="color:#888; font-size:0.8rem;">📍 ${escapeHTML(sellerAddressDisplay)}</span>
        </div>
    `;

    const buyerInfoHtml = `
        <div style="display:flex; align-items:center; gap:8px; margin:5px 0; font-size:0.9rem; flex-wrap:wrap;">
            <i class="fas fa-user" style="color:#1976d2;"></i>
            <span><strong>العميل:</strong> ${escapeHTML(buyer.name || order.customer_name || 'غير معروف')}</span>
            <span style="color:#888; font-size:0.8rem;">| الهاتف: ${escapeHTML(buyerPhoneDisplay)}</span>
            <span style="color:#888; font-size:0.8rem;">📍 ${escapeHTML(buyerAddressDisplay)}</span>
            ${notes ? `<span style="color:#e65100; font-size:0.8rem;">📝 ملاحظات: ${escapeHTML(notes)}</span>` : ''}
        </div>
    `;

    const deliveryDetailsHtml = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; background:#faf8f5; padding:8px 12px; border-radius:8px; margin:6px 0; font-size:0.85rem; border:1px solid #eee;">
            <span><strong>💰 السعر:</strong> ${order.price || product.price || totalPrice || 0} ج.م</span>
            <span><strong>📦 الكمية:</strong> ${order.quantity}</span>
            <span><strong>🚚 التوصيل:</strong> ${deliveryFee} ج.م</span>
            <span><strong>💳 الدفع:</strong> ${escapeHTML(paymentMethod)}</span>
            <span style="grid-column: span 2;"><strong>⏱ الوقت المتوقع:</strong> ${estimatedTime}</span>
        </div>
    `;

    card.innerHTML = `
        <div class="order-header">
            <span class="order-id">#${order.id.slice(0,8)}</span>
            <span class="order-status ${order.status}">${getStatusText(order.status)}</span>
        </div>
        <div class="order-product">
            <div class="order-product-image">${imageHtml}</div>
            <div class="order-product-details">
                <div style="font-weight:700; font-size:1rem;">${escapeHTML(product.name || 'منتج')}</div>
                ${deliveryDetailsHtml}
            </div>
        </div>
        ${sellerInfoHtml}
        ${buyerInfoHtml}
        ${contactButtonsHtml}
        ${actionButtonsHtml}
    `;
    return card;
}

function switchDeliveryTab(tab) {
    appState.delivery.currentTab = tab;
    document.querySelectorAll('#deliveryDashboardScreen .seller-tab').forEach((t, i) => {
        t.classList.toggle('active',
            (tab === 'available' && i === 0) ||
            (tab === 'my' && i === 1) ||
            (tab === 'returns_available' && i === 2) ||
            (tab === 'my_returns' && i === 3)
        );
    });
    const availTab = document.getElementById('availableOrdersTab');
    if (availTab) availTab.style.display = tab === 'available' ? 'block' : 'none';
    const myTab = document.getElementById('myOrdersTab');
    if (myTab) myTab.style.display = tab === 'my' ? 'block' : 'none';
    const availReturnsTab = document.getElementById('availableReturnsTab');
    if (availReturnsTab) availReturnsTab.style.display = tab === 'returns_available' ? 'block' : 'none';
    const myReturnsTab = document.getElementById('myReturnsTab');
    if (myReturnsTab) myReturnsTab.style.display = tab === 'my_returns' ? 'block' : 'none';

    if ((tab === 'returns_available' || tab === 'my_returns') && typeof displayDeliveryReturns === 'function') {
        displayDeliveryReturns();
    }
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
// ===================== دوال المؤقت العد التنازلي والاسترجاع =====================
const returnTimers = {};

function startReturnTimer(orderId, deliveredAt) {
  if (returnTimers[orderId]) clearInterval(returnTimers[orderId]);

  returnTimers[orderId] = setInterval(() => {
    const order = appState.buyerOrders?.find(o => o.id === orderId);
    if (!order || order.status !== 'delivered') {
      clearInterval(returnTimers[orderId]);
      delete returnTimers[orderId];
      return;
    }
    const remaining = getReturnTimeRemaining(order);
    const timerEl = document.getElementById(`timer_${orderId}`);
    if (timerEl) {
      if (remaining) {
        timerEl.textContent = remaining;
      } else {
        timerEl.textContent = 'انتهت';
        clearInterval(returnTimers[orderId]);
        delete returnTimers[orderId];
        // تحديث البطاقة لإخفاء الزر
        // يمكن إعادة تحميل الطلبات أو تحديث الـ DOM
        loadBuyerOrdersWithTimeline();
      }
    }
  }, 1000);
}

// دالة فتح مودال إنشاء طلب استرجاع
function openReturnModal(orderId) {
  // ابحث عن الطلب
  const order = appState.buyerOrders?.find(o => o.id === orderId);
  if (!order) {
    showToast('الطلب غير موجود', 'error');
    return;
  }

  // تعبئة المودال
  const orderIdEl = document.getElementById('returnOrderId');
  if (orderIdEl) orderIdEl.value = orderId;
  const prodIdEl = document.getElementById('returnProductId');
  if (prodIdEl) prodIdEl.value = order.product_id;

  // عرض اسم المنتج
  const product = appState.products?.find(p => p.id === order.product_id) || order.products;
  const prodNameEl = document.getElementById('returnProductName');
  if (prodNameEl) prodNameEl.textContent = product?.name || 'غير معروف';

  const maxQtyEl = document.getElementById('returnMaxQuantity');
  if (maxQtyEl) {
    if ('value' in maxQtyEl) maxQtyEl.value = order.quantity;
    maxQtyEl.textContent = order.quantity;
  }

  const qtyInput = document.getElementById('returnQuantity');
  if (qtyInput) {
    qtyInput.value = 1;
    qtyInput.max = order.quantity;
  }

  const reasonEl = document.getElementById('returnReason');
  if (reasonEl) reasonEl.selectedIndex = 0;
  const otherGroup = document.getElementById('otherReasonGroup');
  if (otherGroup) otherGroup.style.display = 'none';
  const otherReasonEl = document.getElementById('returnOtherReason');
  if (otherReasonEl) otherReasonEl.value = '';
  const notesEl = document.getElementById('returnNotes');
  if (notesEl) notesEl.value = '';

  // مسح معاينة الصور القديمة
  const previewEl = document.getElementById('returnImagesPreview');
  if (previewEl) previewEl.innerHTML = '';
  const fileInput = document.getElementById('returnImages');
  if (fileInput) fileInput.value = '';

  // عرض رسوم الاسترجاع (جلبها من الإعدادات أو استخدام قيمة افتراضية)
  // يمكن جلبها عبر RPC أو من app_settings
  const fee = 20; // مؤقتاً
  const feeEl = document.getElementById('returnFeeDisplay');
  if (feeEl) feeEl.textContent = fee + ' ج.م';

  // عرض المودال
  const modal = document.getElementById('returnModal');
  if (modal) modal.classList.add('active');
}

// إظهار/إخفاء حقل السبب الآخر
document.addEventListener('DOMContentLoaded', function() {
  const reasonSelect = document.getElementById('returnReason');
  const otherGroup = document.getElementById('otherReasonGroup');
  if (reasonSelect && otherGroup) {
    reasonSelect.addEventListener('change', function() {
      otherGroup.style.display = this.value === 'سبب آخر' ? 'block' : 'none';
    });
  }
});

document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'returnReason') {
    const otherGroup = document.getElementById('otherReasonGroup');
    if (otherGroup) {
      otherGroup.style.display = e.target.value === 'سبب آخر' ? 'block' : 'none';
    }
  }
});

function closeReturnModal() {
  const modal = document.getElementById('returnModal');
  if (modal) modal.classList.remove('active');
}

// معاينة صور طلب الاسترجاع
function previewReturnImages(event) {
  const container = document.getElementById('returnImagesPreview');
  if (!container) return;
  container.innerHTML = '';
  const files = Array.from(event.target.files || []);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.width = '60px';
      img.style.height = '60px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '8px';
      img.style.margin = '4px';
      img.style.border = '1px solid #ddd';
      container.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

async function confirmReturn() {
  const orderId = document.getElementById('returnOrderId')?.value;
  const productId = document.getElementById('returnProductId')?.value;
  const quantity = parseInt(document.getElementById('returnQuantity')?.value || '1', 10);
  const reason = document.getElementById('returnReason')?.value;
  const otherReason = document.getElementById('returnOtherReason')?.value?.trim() || '';
  const notes = document.getElementById('returnNotes')?.value?.trim() || '';

  if (!orderId || !productId || !quantity || quantity < 1) {
    showToast('يرجى إدخال كمية صحيحة', 'warning');
    return;
  }

  const finalReason = reason === 'سبب آخر' ? otherReason : reason;
  if (!finalReason) {
    showToast('يرجى كتابة سبب الاسترجاع', 'warning');
    return;
  }

  // التحقق من الكمية
  const order = appState.buyerOrders?.find(o => o.id === orderId);
  if (!order) {
    showToast('الطلب غير موجود', 'error');
    return;
  }
  if (quantity > order.quantity) {
    showToast('الكمية المطلوبة تتجاوز الكمية المشتراة', 'error');
    return;
  }

  showLoading(true);
  try {
    const fileInput = document.getElementById('returnImages');
    const images = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    const returnId = await createReturn(orderId, productId, quantity, finalReason, notes, images);
    if (returnId) {
      closeReturnModal();
      await loadBuyerOrdersWithTimeline(); // تحديث القائمة
    }
  } catch (err) {
    showToast(err.message || 'فشل إنشاء طلب الاسترجاع', 'error');
  } finally {
    showLoading(false);
  }
}

window.completeDelivery = completeDelivery;
window.refreshDeliveryDashboard = refreshDeliveryDashboard;
window.displayAvailableOrders = displayAvailableOrders;
window.displayMyDeliveryOrders = displayMyDeliveryOrders;
window.createOrderCardForDelivery = createOrderCardForDelivery;
window.switchDeliveryTab = switchDeliveryTab;
window.maskPhone = maskPhone;
window.filterBuyerOrders = filterBuyerOrders;
window.setOrdersFilter = setOrdersFilter;
window.renderFilteredOrders = renderFilteredOrders;
window.createBuyerOrderCard = createBuyerOrderCard;
window.deleteBuyerOrder = deleteBuyerOrder;
window.hideOrderLocally = hideOrderLocally;
window.getVisibleOrders = getVisibleOrders;
window.startReturnTimer = startReturnTimer;
window.openReturnModal = openReturnModal;
window.closeReturnModal = closeReturnModal;
window.previewReturnImages = previewReturnImages;
window.confirmReturn = confirmReturn;
window.returnTimers = returnTimers;
