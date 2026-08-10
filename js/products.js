// ========= تحميل المنتجات من قاعدة البيانات ==========
async function loadProductsFromDB() {
    const { data, error } = await supabaseClient.from('products').select('*').order('created_at', { ascending: false });
    if (error) { console.error(error); return []; }
    appState.products = data;
    return data;
}

// ========== عرض المنتجات المميزة في الصفحة الرئيسية ==========
function loadFeaturedProducts() {
    const container = document.getElementById('featuredProducts');
    if (!container) return;
    container.innerHTML = '';
    appState.products.slice(0,4).forEach(p => container.appendChild(createProductCard(p)));
}

// ========== عرض منتجات المتجر ==========
function loadMarketProducts() {
    const container = document.getElementById('marketProducts');
    if (!container) return;
    container.innerHTML = '';
    appState.products.forEach(p => container.appendChild(createProductCard(p)));
    
    // ربط حدث البحث في حقل الإدخال (مرة واحدة فقط لتجنب تكرار المستمعين)
    const searchInput = document.getElementById('marketSearchInput');
    if (searchInput && !searchInput._searchListenerAttached) {
        searchInput.addEventListener('input', function() {
            filterMarketProducts(this.value);
        });
        searchInput._searchListenerAttached = true;
    }
}

// ========== فلترة منتجات المتجر ==========
function filterMarketProducts(query) {
    const container = document.getElementById('marketProducts');
    if (!container) return;
    container.innerHTML = '';
    
    // إظهار/إخفاء زر مسح البحث
    const clearBtn = document.getElementById('clearSearch');
    if (clearBtn) {
        clearBtn.style.display = query ? 'block' : 'none';
    }
    
    const searchTerm = query.toLowerCase().trim();
    const filtered = appState.products.filter(p => {
        if (!searchTerm) return true;
        const name = (p.name || '').toLowerCase();
        const desc = (p.description || '').toLowerCase();
        const cat = (p.category || '').toLowerCase();
        return name.includes(searchTerm) || desc.includes(searchTerm) || cat.includes(searchTerm);
    });
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="grid-column:span2; text-align:center; padding:30px; color:#666;">لا توجد منتجات مطابقة للبحث</p>';
    } else {
        filtered.forEach(p => container.appendChild(createProductCard(p)));
    }
}

// ========== مسح البحث ==========
function clearSearch() {
    const input = document.getElementById('marketSearchInput');
    if (input) input.value = '';
    const clear = document.getElementById('clearSearch');
    if (clear) clear.style.display = 'none';
    filterMarketProducts('');
}

// ========== عرض تقييم المنتج (النجوم + العدد) ==========
function getProductRatingHTML(product) {
    const rating = parseFloat(product.avg_rating) || 0;
    const count = parseInt(product.review_count) || (product.reviews_count) || 0;
    if (rating <= 0) {
        return `<div class="product-rating"><span class="stars">☆☆☆☆☆</span><span class="rating-count">(0)</span></div>`;
    }
    const full = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;
    let stars = '★'.repeat(full);
    if (hasHalf) stars += '★';
    stars += '☆'.repeat(5 - Math.ceil(rating));
    while (stars.length < 5) stars += '☆';
    return `<div class="product-rating"><span class="stars">${stars}</span><span class="rating-value">${rating.toFixed(1)}</span><span class="rating-count">(${count})</span></div>`;
}

// ========== إنشاء بطاقة منتج ==========
function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    const imageUrl = product.images && product.images.length ? product.images[0] : (product.image_url || '');
    const imageHtml = imageUrl ? `<img src="${imageUrl}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div>📦</div>';">` : '<div>📦</div>';
    card.innerHTML = `<div class="product-image">${imageHtml}<div class="product-tag">${product.category || 'عام'}</div></div><div class="product-info"><div class="product-title">${escapeHTML(product.name)}</div><div class="product-price">${product.price} ج.م</div>${getProductRatingHTML(product)}<button class="add-to-cart" onclick="event.stopPropagation(); addToCart('${product.id}')"><i class="fas fa-cart-plus"></i> إضافة للسلة</button></div>`;
    card.addEventListener('click', () => openProductDetail(product));
    return card;
}

// ========== تحميل منتجات البائع ==========
async function loadSellerProducts(userId) {
    const { data, error } = await supabaseClient.from('products').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// ========== إضافة/تحديث/حذف منتج ==========
async function addProduct(productData) {
    const { data, error } = await supabaseClient.from('products').insert([productData]).select();
    if (error) throw error;
    return data[0];
}
async function updateProduct(id, updates) {
    const { data, error } = await supabaseClient.from('products').update(updates).eq('id', id).select();
    if (error) throw error;
    return data[0];
}
async function deleteProduct(id) {
    const { error } = await supabaseClient.from('products').delete().eq('id', id);
    if (error) throw error;
}

// ========== حفظ منتج (إضافة/تعديل) ==========
async function saveProduct() {
    const name = document.getElementById('productName').value.trim();
    const price = parseFloat(document.getElementById('productPrice').value);
    const stock = parseInt(document.getElementById('productStock').value) || 1;
    const desc = document.getElementById('productDescription').value.trim();
    const cat = document.getElementById('productCategory').value;
    const discount = parseFloat(document.getElementById('productDiscount').value) || 0;
    const id = document.getElementById('editingProductId').value;
    const files = document.getElementById('productImages').files;
    if (!name || isNaN(price) || price <= 0) { showToast('يرجى إدخال اسم المنتج وسعر صحيح', 'warning'); return; }
    showLoading(true);
    try {
        let imageUrls = [];
        if (files && files.length > 0) imageUrls = await uploadProductImages(Array.from(files));
        const productData = { name, price, stock, description: desc, category: cat, discount, user_id: appState.user.id, updated_at: new Date() };
        if (imageUrls.length > 0) { productData.image_url = imageUrls[0]; productData.images = imageUrls; }
        if (id) await updateProduct(id, productData);
        else await addProduct(productData);
        showToast(`تم ${id ? 'تحديث' : 'إضافة'} المنتج بنجاح`, 'success');
        closeProductModal();
        await refreshSellerDashboard();
        await loadProductsFromDB();
        loadMarketProducts(); loadFeaturedProducts();
    } catch (err) {
        if (err.message && err.message.includes('column "images"')) {
            showToast('ملاحظة: تم حفظ الصورة الرئيسية فقط.', 'warning');
            const files = document.getElementById('productImages').files;
            let imageUrls = [];
            if (files && files.length > 0) imageUrls = await uploadProductImages(Array.from(files));
            const productData = { name, price, stock, description: desc, category: cat, discount, user_id: appState.user.id, updated_at: new Date() };
            if (imageUrls.length > 0) productData.image_url = imageUrls[0];
            if (id) await updateProduct(id, productData);
            else await addProduct(productData);
            closeProductModal();
            await refreshSellerDashboard();
            await loadProductsFromDB();
            loadMarketProducts(); loadFeaturedProducts();
            showToast('تم الحفظ بنجاح', 'success');
        } else { showToast(err.message, 'error'); console.error(err); }
    } finally { showLoading(false); }
}

// ========== معاينة الصور المتعددة ==========
function previewMultipleImages(event) {
    const files = event.target.files;
    const container = document.getElementById('multiImagePreview');
    container.innerHTML = '';
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = function(e) {
            const div = document.createElement('div'); div.className = 'image-preview-item';
            div.innerHTML = `<img src="${e.target.result}" alt="صورة"><div class="remove-img" onclick="this.parentElement.remove()">×</div>`;
            container.appendChild(div);
        };
        reader.readAsDataURL(file);
    }
}

// ========== لوحة البائع ==========
async function refreshSellerDashboard() {
    if (!appState.user) return;
    showLoading(true);
    try {
        const [products, orders] = await Promise.all([ loadSellerProducts(appState.user.id), loadSellerOrders(appState.user.id) ]);
        appState.seller.products = products; appState.seller.orders = orders;
        updateSellerStats();
        if (appState.seller.currentTab === 'products') displaySellerProducts();
        else if (appState.seller.currentTab === 'orders') displaySellerOrders();
        else if (appState.seller.currentTab === 'analytics') updateAnalytics();
    } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
}
function updateSellerStats() {
    const prodCount = appState.seller.products.length, orderCount = appState.seller.orders.length, revenue = appState.seller.orders.reduce((s, o) => s + (o.total_price || 0), 0);
    document.getElementById('sellerProductCount').textContent = prodCount;
    document.getElementById('sellerOrderCount').textContent = orderCount;
    document.getElementById('sellerRevenue').textContent = revenue.toLocaleString() + ' ج.م';
    document.getElementById('totalProductsStat').textContent = prodCount;
    document.getElementById('totalOrdersStat').textContent = orderCount;
    document.getElementById('totalRevenueStat').textContent = revenue.toLocaleString() + ' ج.م';
    document.getElementById('averageOrderStat').textContent = (orderCount ? (revenue / orderCount).toFixed(0) : 0) + ' ج.م';
    const newOrders = appState.seller.orders.filter(o => o.status === 'pending').length;
    document.getElementById('sellerNotificationBadge').textContent = newOrders;
    document.getElementById('sellerNotificationBadge').style.display = newOrders ? 'flex' : 'none';
}
function displaySellerProducts(filterText = '') {
    const container = document.getElementById('sellerProductsList'); if (!container) return;
    let filtered = appState.seller.products;
    if (filterText) filtered = filtered.filter(p => p.name.toLowerCase().includes(filterText.toLowerCase()));
    if (appState.seller.filterCategory !== 'all') filtered = filtered.filter(p => p.category === appState.seller.filterCategory);
    container.innerHTML = filtered.length ? '' : '<p style="text-align:center; padding:20px;">لا توجد منتجات مطابقة</p>';
    filtered.forEach(p => {
        const div = document.createElement('div'); div.className = 'product-item';
        const imgUrl = p.images && p.images.length ? p.images[0] : (p.image_url || '');
        const imageHtml = imgUrl ? `<img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='📦';">` : '📦';
        div.innerHTML = `<div class="product-item-image">${imageHtml}</div><div class="product-item-info"><div class="product-item-name">${escapeHTML(p.name)}</div><div class="product-item-price">${p.price} ج.م</div><div class="product-item-stock">المتبقي: ${p.stock || 0}</div><div class="product-item-actions"><button class="product-action-btn edit" onclick="editProduct('${p.id}')"><i class="fas fa-edit"></i> تعديل</button><button class="product-action-btn stock" onclick="adjustStock('${p.id}')"><i class="fas fa-boxes"></i> كمية</button><button class="product-action-btn delete" onclick="confirmDelete('${p.id}')"><i class="fas fa-trash"></i> حذف</button></div></div>`;
        container.appendChild(div);
    });
}
function filterSellerProducts() { displaySellerProducts(document.getElementById('sellerProductSearch').value); }
document.querySelectorAll('#productCategoryFilters .filter-btn').forEach(btn => { btn.addEventListener('click', function() { document.querySelectorAll('#productCategoryFilters .filter-btn').forEach(b => b.classList.remove('active')); this.classList.add('active'); appState.seller.filterCategory = this.dataset.category; displaySellerProducts(document.getElementById('sellerProductSearch').value); }); });
function displaySellerOrders(filterText = '') {
    const container = document.getElementById('sellerOrdersList'); if (!container) return;
    let filtered = appState.seller.orders;
    if (filterText) filtered = filtered.filter(o => o.id.includes(filterText) || (o.customer_name && o.customer_name.includes(filterText)));
    if (appState.seller.filterOrderStatus !== 'all') filtered = filtered.filter(o => o.status === appState.seller.filterOrderStatus);
    container.innerHTML = filtered.length ? '' : '<p style="text-align:center; padding:20px;">لا توجد طلبات</p>';
    filtered.forEach(order => {
        const card = document.createElement('div'); card.className = 'order-card';
        const product = order.products || {};
        const imageHtml = product.image_url ? `<img src="${product.image_url}" loading="lazy">` : '📦';
        let actions = '';
        if (order.status === 'pending') actions = `<button class="product-action-btn edit" onclick="confirmOrderSeller('${order.id}')"><i class="fas fa-check"></i> تأكيد الطلب</button>`;
        else if (order.status === 'confirmed') actions = `<button class="product-action-btn edit" onclick="prepareOrderSeller('${order.id}')"><i class="fas fa-box"></i> تم التجهيز</button>`;
        card.innerHTML = `<div class="order-header"><span class="order-id">#${order.id.slice(0,8)}</span><span class="order-status ${order.status}">${getStatusText(order.status)}</span></div><div class="order-product"><div class="order-product-image">${imageHtml}</div><div class="order-product-details"><div>${escapeHTML(product.name || 'منتج')}</div><div>${order.total_price} ج.م × ${order.quantity}</div></div></div><div class="order-total">الإجمالي: ${order.total_price} ج.م</div><div class="order-actions">${actions}<button class="product-action-btn" onclick="viewOrderDetails('${order.id}')">تفاصيل</button></div>`;
        container.appendChild(card);
    });
}
function filterSellerOrders() { displaySellerOrders(document.getElementById('sellerOrderSearch').value); }
document.querySelectorAll('#sellerOrdersTab .filter-btn').forEach(btn => { btn.addEventListener('click', function() { document.querySelectorAll('#sellerOrdersTab .filter-btn').forEach(b => b.classList.remove('active')); this.classList.add('active'); appState.seller.filterOrderStatus = this.dataset.orderStatus; displaySellerOrders(document.getElementById('sellerOrderSearch').value); }); });
function switchSellerTab(tab) {
    appState.seller.currentTab = tab;
    document.querySelectorAll('.seller-tab').forEach((t,i) => { t.classList.toggle('active', (tab==='products' && i===0) || (tab==='orders' && i===1) || (tab==='analytics' && i===2)); });
    document.getElementById('sellerProductsTab').style.display = tab === 'products' ? 'block' : 'none';
    document.getElementById('sellerOrdersTab').style.display = tab === 'orders' ? 'block' : 'none';
    document.getElementById('sellerAnalyticsTab').style.display = tab === 'analytics' ? 'block' : 'none';
    if (tab === 'products') displaySellerProducts(document.getElementById('sellerProductSearch').value);
    else if (tab === 'orders') displaySellerOrders(document.getElementById('sellerOrderSearch').value);
    else if (tab === 'analytics') updateAnalytics();
}
function updateAnalytics() { if (appState.seller.chart) appState.seller.chart.destroy(); const ctx = document.getElementById('salesChart')?.getContext('2d'); if (!ctx) return; appState.seller.chart = new Chart(ctx, { type: 'line', data: { labels: ['يناير','فبراير','مارس','أبريل','مايو','يونيو'], datasets: [{ label: 'المبيعات', data: [12000,19000,15000,22000,18000,24000], borderColor: '#1a237e', tension: 0.1 }] } }); }
function showAddProductForm() { if (!appState.user || appState.userData.account_type !== 'seller') return showToast('غير مصرح', 'error'); document.getElementById('productModalTitle').textContent = 'إضافة منتج جديد'; document.getElementById('productName').value = ''; document.getElementById('productPrice').value = ''; document.getElementById('productStock').value = '1'; document.getElementById('productDescription').value = ''; document.getElementById('productCategory').value = ''; document.getElementById('productDiscount').value = ''; document.getElementById('editingProductId').value = ''; document.getElementById('multiImagePreview').innerHTML = ''; document.getElementById('productImages').value = ''; document.getElementById('productModal').classList.add('active'); }
function editProduct(id) { const p = appState.seller.products.find(p => p.id === id); if (!p) return; document.getElementById('productModalTitle').textContent = 'تعديل المنتج'; document.getElementById('productName').value = p.name || ''; document.getElementById('productPrice').value = p.price || ''; document.getElementById('productStock').value = p.stock || 1; document.getElementById('productDescription').value = p.description || ''; document.getElementById('productCategory').value = p.category || ''; document.getElementById('productDiscount').value = p.discount || ''; document.getElementById('editingProductId').value = id; document.getElementById('multiImagePreview').innerHTML = ''; document.getElementById('productImages').value = ''; document.getElementById('productModal').classList.add('active'); }
function confirmDelete(id) { if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) { showLoading(true); deleteProduct(id).then(async () => { showToast('تم الحذف', 'success'); await refreshSellerDashboard(); await loadProductsFromDB(); loadMarketProducts(); loadFeaturedProducts(); }).catch(err => showToast(err.message, 'error')).finally(() => showLoading(false)); } }
function adjustStock(id) { const p = appState.seller.products.find(p => p.id === id); if (!p) return; const newStock = prompt('أدخل الكمية الجديدة:', p.stock || 0); if (newStock !== null && !isNaN(parseInt(newStock))) { showLoading(true); updateProduct(id, { stock: parseInt(newStock) }).then(() => { showToast('تم تحديث الكمية', 'success'); refreshSellerDashboard(); }).catch(err => showToast(err.message, 'error')).finally(() => showLoading(false)); } }
function viewOrderDetails(orderId) { const order = appState.seller.orders.find(o => o.id === orderId); if (!order) return; let html = `<p><strong>العميل:</strong> ${order.customer_name || 'غير محدد'}</p><p><strong>الهاتف:</strong> ${order.customer_phone || 'غير محدد'}</p><p><strong>العنوان:</strong> ${order.shipping_address || 'غير محدد'}</p><p><strong>التاريخ:</strong> ${new Date(order.created_at).toLocaleString('ar-EG')}</p><h4 style="margin:15px 0 10px;">المنتجات:</h4>`; const product = order.products || {}; html += `<div style="display:flex; justify-content:space-between;"><span>${escapeHTML(product.name)} x${order.quantity}</span><span>${order.total_price} ج.م</span></div>`; html += `<h3 style="margin-top:15px; color:#1a237e;">الإجمالي: ${order.total_price} ج.م</h3>`; document.getElementById('orderDetails').innerHTML = html; const select = document.getElementById('orderStatusSelect'); select.innerHTML = ['pending','confirmed','prepared','picked_up','in_delivery','delivered','cancelled'].map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${getStatusText(s)}</option>`).join(''); select.dataset.orderId = orderId; document.getElementById('orderModal').classList.add('active'); }
async function updateOrderStatusFromModal() { const select = document.getElementById('orderStatusSelect'); const orderId = select.dataset.orderId; const newStatus = select.value; showLoading(true); try { await updateOrderStatus(orderId, newStatus); showToast('تم تحديث الحالة', 'success'); closeOrderModal(); await refreshSellerDashboard(); } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); } }
function closeOrderModal() { document.getElementById('orderModal').classList.remove('active'); }
function closeProductModal() { document.getElementById('productModal').classList.remove('active'); }
function showNotifications() { const newOrders = appState.seller.orders.filter(o => o.status === 'pending'); if (newOrders.length === 0) { showToast('لا توجد إشعارات جديدة', 'info'); return; } let msg = 'طلبات جديدة:\n'; newOrders.forEach(o => msg += `- طلب #${o.id.slice(0,8)} بمبلغ ${o.total_price} ج.م\n`); alert(msg); document.getElementById('sellerNotificationBadge').style.display = 'none'; }
function exportOrdersCSV() { const orders = appState.seller.orders; let csv = 'رقم الطلب,العميل,الهاتف,العنوان,التاريخ,الحالة,الإجمالي\n'; orders.forEach(o => { csv += `${o.id},${o.customer_name || ''},${o.customer_phone || ''},${o.shipping_address || ''},${new Date(o.created_at).toLocaleDateString()},${o.status},${o.total_price}\n`; }); const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'orders.csv'; link.click(); }
async function confirmOrderSeller(orderId) { showLoading(true); try { const order = await updateOrderStatus(orderId, 'confirmed'); await sendNotification(order.buyer_id, 'تم تأكيد طلبك', `تم تأكيد طلبك #${orderId.slice(0,8)}`); showToast('تم تأكيد الطلب', 'success'); await refreshSellerDashboard(); } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); } }
async function prepareOrderSeller(orderId) { showLoading(true); try { const { data: order, error: fetchError } = await supabaseClient.from('orders').select('*, buyer_id, center').eq('id', orderId).single(); if (fetchError) throw fetchError; await updateOrderStatus(orderId, 'prepared'); await sendNotification(order.buyer_id, 'تم تجهيز طلبك', `طلبك #${orderId.slice(0,8)} جاهز وسيتم توصيله قريباً`); if (order.center) await notifyDeliveryPersonsInCenter(order.center, orderId, 'شحنة جاهزة في منطقتك', `طلب #${orderId.slice(0,8)} جاهز للتوصيل في ${order.center}`); showToast('تم تحديث الحالة إلى "تم التجهيز" وإشعار المناديب', 'success'); await refreshSellerDashboard(); } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); } }

// ========== خدمات ==========
function loadServices() {
    const container = document.getElementById('servicesList');
    if (!container) return;
    container.innerHTML = '';
    appState.services.forEach(s => {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.innerHTML = `<div class="service-header"><div class="service-icon"><i class="${s.icon}"></i></div><div><div class="service-title">${s.name}</div><div class="service-price">${s.price}</div></div></div><div class="service-desc">${s.description}</div><button class="book-service-btn" onclick="bookService(${s.id})"><i class="fas fa-calendar-check"></i> حجز الخدمة</button>`;
        container.appendChild(card);
    });
}
function bookService(serviceId) { const service = appState.services.find(s => s.id === serviceId); if (service) showToast(`تم حجز خدمة ${service.name} بنجاح`, 'success'); }

// ========== أدوات متجر البائع ==========
function getStoreUrl() { let baseUrl = window.location.origin + window.location.pathname; baseUrl = baseUrl.split('?')[0]; if (appState.userData.username) return `${baseUrl}?store=${encodeURIComponent(appState.userData.username)}`; else return `${baseUrl}?store=${encodeURIComponent(appState.user.id)}`; }
function generateStoreQR(storeUrl, containerId) { const container = document.getElementById(containerId); if (!container) return; container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(storeUrl)}" alt="QR Code" style="width:150px;height:150px;">`; }
function copyStoreLink(link) { navigator.clipboard.writeText(link).then(() => showToast('تم نسخ الرابط', 'success')).catch(() => showToast('فشل النسخ', 'error')); }
function shareStoreLink(link, sellerName) { if (navigator.share) { navigator.share({ title: `متجر ${sellerName} على Misar Systems`, text: 'تفضل بزيارة متجري', url: link }).catch(() => {}); } else { copyStoreLink(link); } }
async function addSellerStoreTools() { const toolsDiv = document.getElementById('sellerStoreTools'); if (!toolsDiv) return; toolsDiv.style.display = 'block'; if (!toolsDiv.dataset.initialized) { document.getElementById('copyStoreLinkBtn')?.addEventListener('click', () => { copyStoreLink(getStoreUrl()); }); document.getElementById('shareStoreLinkBtn')?.addEventListener('click', () => { shareStoreLink(getStoreUrl(), appState.userData.name || 'بائع'); }); document.getElementById('viewMyStoreBtn')?.addEventListener('click', () => { const identifier = appState.userData.username || appState.user.id; showStorePage(identifier); }); document.getElementById('downloadQRBtn')?.addEventListener('click', () => { const link = document.createElement('a'); link.download = `store_${appState.userData.username || appState.user.id}.png`; const qrImg = document.querySelector('#storeQRCode img'); if (qrImg && qrImg.src) { link.href = qrImg.src; link.click(); } else { showToast('لم يتم العثور على QR', 'error'); } }); toolsDiv.dataset.initialized = 'true'; } updateStoreTools(); }
async function updateStoreTools() { if (!appState.user || appState.userData.account_type !== 'seller') return; const linkDisplay = document.getElementById('storeLinkDisplay'); const qrContainer = document.getElementById('storeQRCode'); if (!linkDisplay || !qrContainer) return; const storeUrl = getStoreUrl(); linkDisplay.textContent = storeUrl; generateStoreQR(storeUrl, 'storeQRCode'); }

// ========== عرض صفحة متجر البائع ==========
async function showStorePage(identifier) { showLoading(true); let sellerData = null; if (identifier.startsWith('user_') || (identifier.length > 20 && identifier.includes('-'))) { const { data, error } = await supabaseClient.from('user_data').select('*').eq('id', identifier).single(); if (!error && data) sellerData = data; } else { const { data, error } = await supabaseClient.from('user_data').select('*').eq('username', identifier).single(); if (!error && data) sellerData = data; } if (!sellerData) { showLoading(false); showToast('البائع غير موجود', 'error'); showScreen('homeScreen'); return; } const { data: products } = await supabaseClient.from('products').select('*').eq('user_id', sellerData.id).order('created_at', { ascending: false }); const container = document.getElementById('storeContent'); const avatarUrl = sellerData.image_url || ''; const avatarHtml = avatarUrl ? `<img src="${avatarUrl}" alt="صورة البائع">` : '<i class="fas fa-user" style="font-size:3rem; color:#aaa;"></i>'; const sellerName = sellerData.name || sellerData.email?.split('@')[0] || 'بائع'; const bioHtml = sellerData.bio ? `<div class="store-bio">${escapeHTML(sellerData.bio)}</div>` : ''; let productsHtml = '<div class="products-grid" id="storeProductsGrid">'; if (products && products.length) { products.forEach(p => { const img = p.images && p.images[0] ? p.images[0] : (p.image_url || ''); productsHtml += `<div class="product-card" onclick="openProductDetailFromStore('${p.id}')"><div class="product-image"><img src="${img}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div>📦</div>';"> <div class="product-tag">${p.category || 'عام'}</div></div><div class="product-info"><div class="product-title">${escapeHTML(p.name)}</div><div class="product-price">${p.price} ج.م</div>${getProductRatingHTML(p)}<button class="add-to-cart" onclick="event.stopPropagation(); addToCart('${p.id}')"><i class="fas fa-cart-plus"></i> إضافة للسلة</button></div></div>`; }); } else { productsHtml += '<p style="grid-column:span2; text-align:center; padding:30px;">لا توجد منتجات متاحة حالياً</p>'; } productsHtml += '</div>'; container.innerHTML = `<div class="seller-store-header"><div class="seller-store-avatar">${avatarHtml}</div><div class="seller-store-name">${escapeHTML(sellerName)}</div><div class="seller-store-subtitle"><i class="fas fa-store"></i> متجر مسجل على Misar Systems</div>${bioHtml}</div><div class="store-products"><div class="section-title"><i class="fas fa-box"></i> جميع المنتجات</div>${productsHtml}</div>`; showLoading(false); showScreen('storeScreen'); }
function openProductDetailFromStore(productId) { const product = appState.products.find(p => p.id === productId); if (product) openProductDetail(product); else showToast('المنتج غير موجود', 'error'); }

// ===================== إضافة دالة إظهار/إخفاء كلمة المرور =====================
/**
 * تبديل إظهار/إخفاء كلمة المرور
 * @param {string} inputId - معرف حقل الإدخال
 * @param {HTMLElement} toggleEl - العنصر الذي تم النقر عليه (الـ span)
 */
function togglePasswordVisibility(inputId, toggleEl) {
    const input = document.getElementById(inputId);
    if (!input || !toggleEl) return;

    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';

    const icon = toggleEl.querySelector('i');
    if (icon) {
        icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
}
// ============================================================
// دوال إدارة المنتجات من المؤسس (مكملة)
// ============================================================

// ====== تحميل المنتجات في جدول المؤسس ======
async function loadProductsTableAdmin(page = 1, pageSize = 10) {
    const products = await getAllProductsAdmin();
    // فلترة حسب البحث والحالة (سيتم تطبيقها في الواجهة)
    const filtered = filterProductsAdminData(products);
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderProductsTableAdmin(pageData);
    renderPagination('productsPagination', total, page, pageSize, (p) => loadProductsTableAdmin(p, pageSize));
}

let productsAdminFilter = { query: '', status: 'all' };

function filterProductsAdminData(products) {
    const { query, status } = productsAdminFilter;
    return products.filter(p => {
        const matchQuery = !query || p.name.toLowerCase().includes(query.toLowerCase()) ||
                           (p.user_data?.name && p.user_data.name.toLowerCase().includes(query.toLowerCase())) ||
                           (p.category && p.category.toLowerCase().includes(query.toLowerCase()));
        const matchStatus = status === 'all' || (p.status || 'published') === status;
        return matchQuery && matchStatus;
    });
}

function renderProductsTableAdmin(data) {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px;">لا توجد منتجات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(p => {
        const img = (p.images && p.images[0]) || p.image_url || '';
        const imgHtml = img ? `<img src="${img}" class="avatar-img" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='📦';">` : '📦';
        const sellerName = p.user_data?.name || 'غير معروف';
        const statusClass = p.status || 'published';
        const statusMap = {
            'published': 'منشور',
            'hidden': 'مخفي',
            'review': 'قيد المراجعة',
            'deleted': 'محذوف'
        };
        const statusText = statusMap[statusClass] || 'منشور';
        return `<tr>
            <td>${imgHtml}</td>
            <td>${escapeHTML(p.name)}</td>
            <td>${escapeHTML(sellerName)}</td>
            <td>${escapeHTML(p.user_data?.name || '')}</td>
            <td>${escapeHTML(p.category || 'عام')}</td>
            <td>${p.price} ج.م</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
            <td>
                <div class="action-group">
                    <button class="btn-sm view" onclick="viewProductDetails('${p.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm edit" onclick="editProductAdmin('${p.id}')"><i class="fas fa-edit"></i></button>
                    ${statusClass !== 'hidden' ? `<button class="btn-sm hide" onclick="hideProductAdmin('${p.id}')"><i class="fas fa-eye-slash"></i></button>` :
                    `<button class="btn-sm unhide" onclick="unhideProductAdmin('${p.id}')"><i class="fas fa-eye"></i></button>`}
                    ${statusClass !== 'review' ? `<button class="btn-sm review" onclick="reviewProductAdmin('${p.id}')"><i class="fas fa-clock"></i></button>` : ''}
                    ${statusClass !== 'deleted' ? `<button class="btn-sm delete" onclick="deleteProductAdminConfirm('${p.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ====== دوال المنتجات (إدارة المؤسس) ======

// ملاحظة: دالة deleteProductAdmin موجودة في supabase.js
// يتم استدعاؤها عبر window.deleteProductAdmin

// حذف منتج نهائياً من قاعدة البيانات (استخدام بحذر)
async function hardDeleteProductAdmin(productId) {
    if (!productId) throw new Error('معرف المنتج مطلوب');
    
    const { data, error } = await supabaseClient
        .from('products')
        .delete()
        .eq('id', productId)
        .select()
        .maybeSingle();
    
    if (error) throw error;
    await logActivity(appState.user.id, 'hard_delete_product_admin', { product_id: productId });
    return data;
}

// دالة تأكيد الحذف من واجهة المؤسس (تم تعديلها لاستخدام hardDeleteProductAdmin)
window.deleteProductAdminConfirm = async function(productId) {
    if (!productId) {
        showToast('معرف المنتج غير صحيح', 'error');
        return;
    }

    // طلب تأكيد من المستخدم
    if (!confirm('⚠️ هل أنت متأكد من حذف هذا المنتج نهائياً؟\nسيتم حذف المنتج وجميع بياناته بشكل دائم.')) {
        return;
    }

    showLoading(true);
    try {
        const { error } = await supabaseClient.rpc('delete_product_with_orders', {
            product_id: productId
        });
        if (error) throw error;

        showToast('✅ تم حذف المنتج وجميع طلباته بنجاح', 'success');
        
        // تحديث الجدول وعرض المنتجات
        await loadProductsTableAdmin();
        
        // تحديث قائمة المنتجات في المتجر
        await loadProductsFromDB();
        loadMarketProducts();
        loadFeaturedProducts();
        
    } catch (err) {
        console.error('❌ خطأ في حذف المنتج:', err);
        showToast(err.message || 'فشل حذف المنتج', 'error');
    } finally {
        showLoading(false);
    }
};

// دالة حذف فوري (بدون تأكيد - تستخدم في بعض الحالات)
async function forceDeleteProductAdmin(productId) {
    if (!productId) return;
    showLoading(true);
    try {
        await hardDeleteProductAdmin(productId);
        showToast('✅ تم حذف المنتج نهائياً', 'success');
        await loadProductsTableAdmin();
        await loadProductsFromDB();
        loadMarketProducts();
        loadFeaturedProducts();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// دوال الإجراءات
window.viewProductDetails = async function(productId) {
    const product = await supabaseClient.from('products').select('*').eq('id', productId).single();
    if (product.data) {
        document.getElementById('detailsContent').innerHTML = `
            <p><strong>الاسم:</strong> ${escapeHTML(product.data.name)}</p>
            <p><strong>السعر:</strong> ${product.data.price} ج.م</p>
            <p><strong>الوصف:</strong> ${escapeHTML(product.data.description || '')}</p>
            <p><strong>القسم:</strong> ${product.data.category || 'عام'}</p>
            <p><strong>الحالة:</strong> ${product.data.status || 'منشور'}</p>
            <p><strong>تاريخ الإضافة:</strong> ${new Date(product.data.created_at).toLocaleString('ar-EG')}</p>
        `;
        document.getElementById('detailsModal').classList.add('active');
    }
};

window.editProductAdmin = function(productId) {
    // فتح نموذج تعديل المنتج (يمكن إعادة استخدام مودال البائع)
    // نوجه المستخدم إلى صفحة تعديل المنتج في لوحة البائع أو نفتح مودال مشابه
    showToast('سيتم إضافة هذه الميزة قريباً', 'info');
};

window.hideProductAdmin = async function(productId) {
    if (!confirm('هل تريد إخفاء هذا المنتج؟')) return;
    showLoading(true);
    try {
        await updateProductStatusAdmin(productId, 'hidden');
        showToast('تم إخفاء المنتج', 'success');
        loadProductsTableAdmin();
    } catch (err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
};

window.unhideProductAdmin = async function(productId) {
    if (!confirm('هل تريد إعادة نشر هذا المنتج؟')) return;
    showLoading(true);
    try {
        await updateProductStatusAdmin(productId, 'published');
        showToast('تم إعادة نشر المنتج', 'success');
        loadProductsTableAdmin();
    } catch (err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
};

window.reviewProductAdmin = async function(productId) {
    if (!confirm('هل تريد وضع هذا المنتج قيد المراجعة؟')) return;
    showLoading(true);
    try {
        await updateProductStatusAdmin(productId, 'review');
        showToast('تم وضع المنتج قيد المراجعة', 'success');
        loadProductsTableAdmin();
    } catch (err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
};

window.filterProductsAdmin = function() {
    const input = document.getElementById('productSearchInput');
    productsAdminFilter.query = input ? input.value.trim() : '';
    loadProductsTableAdmin();
};

window.filterProductsAdminByStatus = function(status) {
    productsAdminFilter.status = status;
    document.querySelectorAll('#tab-products .filter-btn').forEach(btn => btn.classList.remove('active'));
    // تحديد الزر النشط
    const btns = document.querySelectorAll('#tab-products .filter-btn');
    const index = ['all','published','hidden','review'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadProductsTableAdmin();
};

// ====== دوال العقارات ======
let propertiesFilter = { query: '', status: 'all' };
async function loadPropertiesTable(page = 1, pageSize = 10) {
    const properties = await getAllProperties();
    const filtered = properties.filter(p => {
        const q = propertiesFilter.query.toLowerCase();
        const matchQuery = !q || p.name.toLowerCase().includes(q) ||
                           (p.owner?.name && p.owner.name.toLowerCase().includes(q)) ||
                           (p.city && p.city.toLowerCase().includes(q));
        const matchStatus = propertiesFilter.status === 'all' || p.status === propertiesFilter.status;
        return matchQuery && matchStatus;
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderPropertiesTable(pageData);
    renderPagination('propertiesPagination', total, page, pageSize, (p) => loadPropertiesTable(p, pageSize));
}

function renderPropertiesTable(data) {
    const tbody = document.getElementById('propertiesTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">لا توجد عقارات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(p => {
        const img = (p.images && p.images[0]) || '';
        const imgHtml = img ? `<img src="${img}" class="avatar-img" loading="lazy">` : '🏠';
        const statusMap = {
            'available': 'متاح',
            'reserved': 'محجوز',
            'sold': 'مباع',
            'hidden': 'مخفي'
        };
        const statusText = statusMap[p.status] || p.status;
        return `<tr>
            <td>${imgHtml}</td>
            <td>${escapeHTML(p.name)}</td>
            <td>${escapeHTML(p.owner?.name || 'غير معروف')}</td>
            <td>${p.price} ج.م</td>
            <td>${escapeHTML(p.city || '')}</td>
            <td><span class="status-badge ${p.status}">${statusText}</span></td>
            <td>
                <div class="action-group">
                    <button class="btn-sm view" onclick="viewPropertyDetails('${p.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm edit" onclick="editProperty('${p.id}')"><i class="fas fa-edit"></i></button>
                    ${p.status !== 'hidden' ? `<button class="btn-sm hide" onclick="hideProperty('${p.id}')"><i class="fas fa-eye-slash"></i></button>` :
                    `<button class="btn-sm unhide" onclick="unhideProperty('${p.id}')"><i class="fas fa-eye"></i></button>`}
                    <button class="btn-sm delete" onclick="deletePropertyConfirm('${p.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.viewPropertyDetails = function(propertyId) {
    // مشابه لمنتج
    showToast('عرض التفاصيل قيد التطوير', 'info');
};

window.editProperty = function(propertyId) {
    showToast('تعديل العقار قيد التطوير', 'info');
};

window.hideProperty = async function(propertyId) {
    if (!confirm('إخفاء هذا العقار؟')) return;
    showLoading(true);
    try {
        await updatePropertyStatus(propertyId, 'hidden');
        showToast('تم إخفاء العقار', 'success');
        loadPropertiesTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.unhideProperty = async function(propertyId) {
    if (!confirm('إعادة نشر هذا العقار؟')) return;
    showLoading(true);
    try {
        await updatePropertyStatus(propertyId, 'available');
        showToast('تم إعادة نشر العقار', 'success');
        loadPropertiesTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.deletePropertyConfirm = async function(propertyId) {
    if (!confirm('حذف هذا العقار نهائياً؟')) return;
    showLoading(true);
    try {
        await deleteProperty(propertyId);
        showToast('تم حذف العقار', 'success');
        loadPropertiesTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.filterProperties = function() {
    const input = document.getElementById('propertySearchInput');
    propertiesFilter.query = input ? input.value.trim() : '';
    loadPropertiesTable();
};

window.filterPropertiesByStatus = function(status) {
    propertiesFilter.status = status;
    document.querySelectorAll('#tab-properties .filter-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('#tab-properties .filter-btn');
    const index = ['all','available','reserved','sold','hidden'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadPropertiesTable();
};

window.showAddPropertyForm = function() {
    document.getElementById('propertyModalTitle').textContent = 'إضافة عقار';
    document.getElementById('editingPropertyId').value = '';
    document.getElementById('propertyName').value = '';
    document.getElementById('propertyDescription').value = '';
    document.getElementById('propertyPrice').value = '';
    document.getElementById('propertyLocation').value = '';
    document.getElementById('propertyCity').value = '';
    document.getElementById('propertyOwnerEmail').value = '';
    document.getElementById('propertyStatus').value = 'available';
    document.getElementById('propertyImagePreview').innerHTML = '';
    document.getElementById('propertyImages').value = '';
    document.getElementById('propertyModal').classList.add('active');
};

window.closePropertyModal = function() {
    document.getElementById('propertyModal').classList.remove('active');
};

window.previewPropertyImages = function(event) {
    const files = event.target.files;
    const container = document.getElementById('propertyImagePreview');
    container.innerHTML = '';
    for (let i = 0; i < files.length && i < 5; i++) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.width = '60px';
            img.style.height = '60px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '8px';
            img.style.margin = '4px';
            container.appendChild(img);
        };
        reader.readAsDataURL(files[i]);
    }
};

window.saveProperty = async function() {
    const name = document.getElementById('propertyName').value.trim();
    const description = document.getElementById('propertyDescription').value.trim();
    const price = parseFloat(document.getElementById('propertyPrice').value);
    const location = document.getElementById('propertyLocation').value.trim();
    const city = document.getElementById('propertyCity').value.trim();
    const ownerEmail = document.getElementById('propertyOwnerEmail').value.trim();
    const status = document.getElementById('propertyStatus').value;
    const id = document.getElementById('editingPropertyId').value;

    if (!name || !price) {
        showToast('يرجى إدخال الاسم والسعر', 'warning');
        return;
    }

    let ownerId = null;
    if (ownerEmail) {
        const { data } = await supabaseClient.from('user_data').select('id').eq('email', ownerEmail).maybeSingle();
        if (data) ownerId = data.id;
        else {
            showToast('المالك غير موجود في النظام', 'error');
            return;
        }
    }

    const imagesInput = document.getElementById('propertyImages');
    let imageUrls = [];
    if (imagesInput.files.length) {
        // رفع الصور (نستخدم دالة موجودة أو نكتبها)
        for (const file of imagesInput.files) {
            const url = await uploadPropertyImage(file);
            if (url) imageUrls.push(url);
        }
    }

    const propertyData = {
        id: id || undefined,
        name,
        description,
        price,
        location,
        city,
        owner_id: ownerId,
        images: imageUrls,
        status,
        updated_at: new Date()
    };
    showLoading(true);
    try {
        await saveProperty(propertyData);
        showToast(id ? 'تم تحديث العقار' : 'تم إضافة العقار', 'success');
        closePropertyModal();
        loadPropertiesTable();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

async function uploadPropertyImage(file) {
    try {
        const compressed = await compressImage(file, 800, 800, 0.8);
        const path = `properties/${Date.now()}-${file.name}`;
        const { error } = await supabaseClient.storage.from('property-images').upload(path, compressed);
        if (error) throw error;
        const { data } = supabaseClient.storage.from('property-images').getPublicUrl(path);
        return data.publicUrl;
    } catch (err) {
        console.warn('فشل رفع صورة العقار:', err);
        return null;
    }
}

// ====== دوال الخدمات (المؤسس) ======
let servicesAdminFilter = { query: '' };
async function loadServicesTableAdmin(page = 1, pageSize = 10) {
    const services = await getAllServices();
    const filtered = services.filter(s => {
        const q = servicesAdminFilter.query.toLowerCase();
        return !q || s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q));
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderServicesTableAdmin(pageData);
    renderPagination('servicesPagination', total, page, pageSize, (p) => loadServicesTableAdmin(p, pageSize));
}

function renderServicesTableAdmin(data) {
    const tbody = document.getElementById('servicesTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">لا توجد خدمات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(s => {
        const statusText = s.status === 'active' ? 'نشط' : 'غير نشط';
        const statusClass = s.status === 'active' ? 'active' : 'inactive';
        return `<tr>
            <td>${escapeHTML(s.name)}</td>
            <td>${escapeHTML(s.description || '')}</td>
            <td>${escapeHTML(s.price || '')}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>
                <div class="action-group">
                    <button class="btn-sm view" onclick="viewServiceDetails('${s.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm edit" onclick="editService('${s.id}')"><i class="fas fa-edit"></i></button>
                    ${s.status === 'active' ? `<button class="btn-sm suspend" onclick="toggleServiceStatus('${s.id}', 'inactive')"><i class="fas fa-pause"></i></button>` :
                    `<button class="btn-sm reactivate" onclick="toggleServiceStatus('${s.id}', 'active')"><i class="fas fa-play"></i></button>`}
                    <button class="btn-sm delete" onclick="deleteServiceConfirm('${s.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.filterServicesAdmin = function() {
    const input = document.getElementById('serviceSearchInput');
    servicesAdminFilter.query = input ? input.value.trim() : '';
    loadServicesTableAdmin();
};

window.showAddServiceForm = function() {
    document.getElementById('serviceModalTitle').textContent = 'إضافة خدمة';
    document.getElementById('editingServiceId').value = '';
    document.getElementById('serviceName').value = '';
    document.getElementById('serviceDescription').value = '';
    document.getElementById('servicePrice').value = '';
    document.getElementById('serviceIcon').value = 'fas fa-concierge-bell';
    document.getElementById('serviceStatus').value = 'active';
    document.getElementById('serviceModal').classList.add('active');
};

window.closeServiceModal = function() {
    document.getElementById('serviceModal').classList.remove('active');
};

window.saveService = async function() {
    const name = document.getElementById('serviceName').value.trim();
    const description = document.getElementById('serviceDescription').value.trim();
    const price = document.getElementById('servicePrice').value.trim();
    const icon = document.getElementById('serviceIcon').value.trim() || 'fas fa-concierge-bell';
    const status = document.getElementById('serviceStatus').value;
    const id = document.getElementById('editingServiceId').value;

    if (!name) {
        showToast('يرجى إدخال اسم الخدمة', 'warning');
        return;
    }

    const serviceData = {
        id: id || undefined,
        name,
        description,
        price,
        icon,
        status,
        updated_at: new Date()
    };
    showLoading(true);
    try {
        await saveService(serviceData);
        showToast(id ? 'تم تحديث الخدمة' : 'تم إضافة الخدمة', 'success');
        closeServiceModal();
        loadServicesTableAdmin();
        // تحديث قائمة الخدمات في appState (إذا لزم الأمر)
        await loadServices();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

window.editService = function(serviceId) {
    // جلب الخدمة وتعبئة النموذج
    (async () => {
        const services = await getAllServices();
        const service = services.find(s => s.id === serviceId);
        if (!service) {
            showToast('الخدمة غير موجودة', 'error');
            return;
        }
        document.getElementById('serviceModalTitle').textContent = 'تعديل خدمة';
        document.getElementById('editingServiceId').value = service.id;
        document.getElementById('serviceName').value = service.name;
        document.getElementById('serviceDescription').value = service.description || '';
        document.getElementById('servicePrice').value = service.price || '';
        document.getElementById('serviceIcon').value = service.icon || 'fas fa-concierge-bell';
        document.getElementById('serviceStatus').value = service.status || 'active';
        document.getElementById('serviceModal').classList.add('active');
    })();
};

window.toggleServiceStatus = async function(serviceId, newStatus) {
    if (!confirm(`هل تريد ${newStatus === 'active' ? 'تفعيل' : 'إيقاف'} هذه الخدمة؟`)) return;
    showLoading(true);
    try {
        await saveService({ id: serviceId, status: newStatus, updated_at: new Date() });
        showToast(newStatus === 'active' ? 'تم تفعيل الخدمة' : 'تم إيقاف الخدمة', 'success');
        loadServicesTableAdmin();
        await loadServices();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

window.deleteServiceConfirm = async function(serviceId) {
    if (!confirm('حذف هذه الخدمة نهائياً؟')) return;
    showLoading(true);
    try {
        await deleteService(serviceId);
        showToast('تم حذف الخدمة', 'success');
        loadServicesTableAdmin();
        await loadServices();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

// ====== دوال الطلبات (المؤسس) ======
let ordersAdminFilter = { query: '', status: 'all' };
async function loadOrdersTableAdmin(page = 1, pageSize = 10) {
    const orders = await getAllOrdersAdmin();
    const filtered = orders.filter(o => {
        const q = ordersAdminFilter.query.toLowerCase();
        const matchQuery = !q || o.id.toLowerCase().includes(q) ||
                           (o.buyer?.name && o.buyer.name.toLowerCase().includes(q)) ||
                           (o.seller?.name && o.seller.name.toLowerCase().includes(q)) ||
                           (o.delivery?.name && o.delivery.name.toLowerCase().includes(q));
        const matchStatus = ordersAdminFilter.status === 'all' || o.status === ordersAdminFilter.status;
        return matchQuery && matchStatus;
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderOrdersTableAdmin(pageData);
    renderPagination('ordersPagination', total, page, pageSize, (p) => loadOrdersTableAdmin(p, pageSize));
}

function renderOrdersTableAdmin(data) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">لا توجد طلبات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(o => {
        const statusMap = {
            'pending': 'قيد الانتظار',
            'confirmed': 'مؤكد',
            'prepared': 'تم التجهيز',
            'in_delivery': 'قيد التوصيل',
            'delivered': 'مكتمل',
            'cancelled': 'ملغي'
        };
        const statusText = statusMap[o.status] || o.status;
        return `<tr>
            <td>#${o.id.slice(0,8)}</td>
            <td>${escapeHTML(o.buyer?.name || 'غير معروف')}</td>
            <td>${escapeHTML(o.seller?.name || 'غير معروف')}</td>
            <td>${escapeHTML(o.delivery?.name || 'غير معين')}</td>
            <td>${o.total_price} ج.م</td>
            <td><span class="status-badge ${o.status}">${statusText}</span></td>
            <td>${new Date(o.created_at).toLocaleDateString('ar-EG')}</td>
            <td>
                <div class="action-group">
                    <button class="btn-sm view" onclick="viewOrderDetailsAdmin('${o.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm edit" onclick="showOrderStatusModal('${o.id}')"><i class="fas fa-edit"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.filterOrdersAdmin = function() {
    const input = document.getElementById('orderSearchInput');
    ordersAdminFilter.query = input ? input.value.trim() : '';
    loadOrdersTableAdmin();
};

window.filterOrdersAdminByStatus = function(status) {
    ordersAdminFilter.status = status;
    document.querySelectorAll('#tab-orders .filter-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('#tab-orders .filter-btn');
    const index = ['all','pending','confirmed','prepared','in_delivery','delivered','cancelled'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadOrdersTableAdmin();
};

window.viewOrderDetailsAdmin = function(orderId) {
    // عرض تفاصيل الطلب في مودال
    (async () => {
        const { data } = await supabaseClient.from('orders').select('*, buyer:buyer_id(*), seller:seller_id(*), delivery:delivery_id(*)').eq('id', orderId).single();
        if (data) {
            const buyer = data.buyer || {};
            const seller = data.seller || {};
            const delivery = data.delivery || {};
            document.getElementById('detailsContent').innerHTML = `
                <p><strong>رقم الطلب:</strong> #${data.id}</p>
                <p><strong>العميل:</strong> ${escapeHTML(buyer.name || 'غير معروف')} (${buyer.email || ''})</p>
                <p><strong>البائع:</strong> ${escapeHTML(seller.name || 'غير معروف')}</p>
                <p><strong>المندوب:</strong> ${escapeHTML(delivery.name || 'غير معين')}</p>
                <p><strong>المنتج:</strong> ${escapeHTML(data.product_name || '')}</p>
                <p><strong>الكمية:</strong> ${data.quantity}</p>
                <p><strong>الإجمالي:</strong> ${data.total_price} ج.م</p>
                <p><strong>الحالة:</strong> ${data.status}</p>
                <p><strong>تاريخ الطلب:</strong> ${new Date(data.created_at).toLocaleString('ar-EG')}</p>
                <p><strong>عنوان التوصيل:</strong> ${escapeHTML(data.shipping_address || '')}</p>
            `;
            document.getElementById('detailsModal').classList.add('active');
        }
    })();
};

window.showOrderStatusModal = function(orderId) {
    document.getElementById('orderStatusOrderId').value = orderId;
    document.getElementById('orderStatusModal').classList.add('active');
};

window.closeOrderStatusModal = function() {
    document.getElementById('orderStatusModal').classList.remove('active');
};

window.updateOrderStatusAdmin = async function() {
    const orderId = document.getElementById('orderStatusOrderId').value;
    const status = document.getElementById('orderStatusSelectAdmin').value;
    if (!orderId || !status) return;
    showLoading(true);
    try {
        await updateOrderStatusAdmin(orderId, status);
        showToast('تم تحديث حالة الطلب', 'success');
        closeOrderStatusModal();
        loadOrdersTableAdmin();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

// ====== دوال البلاغات ======
let reportsFilter = { query: '', status: 'all' };
async function loadReportsTable(page = 1, pageSize = 10) {
    const reports = await getAllReports();
    const filtered = reports.filter(r => {
        const q = reportsFilter.query.toLowerCase();
        const matchQuery = !q || r.target_type.toLowerCase().includes(q) ||
                           (r.reporter?.name && r.reporter.name.toLowerCase().includes(q)) ||
                           (r.reason && r.reason.toLowerCase().includes(q));
        const matchStatus = reportsFilter.status === 'all' || r.status === reportsFilter.status;
        return matchQuery && matchStatus;
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderReportsTable(pageData);
    renderPagination('reportsPagination', total, page, pageSize, (p) => loadReportsTable(p, pageSize));
}

function renderReportsTable(data) {
    const tbody = document.getElementById('reportsTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">لا توجد بلاغات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(r => {
        const statusMap = {
            'pending': 'قيد المراجعة',
            'approved': 'مقبول',
            'rejected': 'مرفوض'
        };
        const statusText = statusMap[r.status] || r.status;
        const typeMap = {
            'product': 'منتج',
            'property': 'عقار',
            'service': 'خدمة',
            'user': 'مستخدم'
        };
        const typeText = typeMap[r.target_type] || r.target_type;
        return `<tr>
            <td>${escapeHTML(r.reporter?.name || 'غير معروف')}</td>
            <td>${typeText}</td>
            <td>${escapeHTML(r.reason || '')}</td>
            <td>${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
            <td><span class="status-badge ${r.status}">${statusText}</span></td>
            <td>
                <div class="action-group">
                    ${r.status === 'pending' ? `
                        <button class="btn-sm approve" onclick="approveReport('${r.id}')"><i class="fas fa-check"></i></button>
                        <button class="btn-sm reject" onclick="rejectReport('${r.id}')"><i class="fas fa-times"></i></button>
                    ` : ''}
                    <button class="btn-sm view" onclick="viewReportDetails('${r.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm delete" onclick="deleteReportContent('${r.id}')"><i class="fas fa-trash"></i></button>
                    <button class="btn-sm suspend" onclick="warnReportOwner('${r.id}')"><i class="fas fa-exclamation-triangle"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.filterReports = function() {
    const input = document.getElementById('reportSearchInput');
    reportsFilter.query = input ? input.value.trim() : '';
    loadReportsTable();
};

window.filterReportsByStatus = function(status) {
    reportsFilter.status = status;
    document.querySelectorAll('#tab-reports .filter-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('#tab-reports .filter-btn');
    const index = ['all','pending','approved','rejected'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadReportsTable();
};

window.approveReport = async function(reportId) {
    if (!confirm('قبول هذا البلاغ؟')) return;
    showLoading(true);
    try {
        await updateReportStatus(reportId, 'approved');
        showToast('تم قبول البلاغ', 'success');
        loadReportsTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.rejectReport = async function(reportId) {
    if (!confirm('رفض هذا البلاغ؟')) return;
    showLoading(true);
    try {
        await updateReportStatus(reportId, 'rejected');
        showToast('تم رفض البلاغ', 'success');
        loadReportsTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.viewReportDetails = function(reportId) {
    showToast('عرض التفاصيل قيد التطوير', 'info');
};

window.deleteReportContent = function(reportId) {
    // حذف المحتوى المبلغ عنه (منتج/عقار/خدمة)
    if (!confirm('حذف المحتوى المبلغ عنه؟')) return;
    // سيتم تنفيذ حسب نوع البلاغ
    showToast('سيتم حذف المحتوى', 'info');
};

window.warnReportOwner = function(reportId) {
    // إرسال تحذير لصاحب المحتوى
    showToast('تم إرسال تحذير', 'success');
};

// ====== دوال سجل النشاط ======
let logsFilter = { query: '' };
async function loadLogsTable(page = 1, pageSize = 10) {
    const logs = await getAllActivityLogs();
    const filtered = logs.filter(l => {
        const q = logsFilter.query.toLowerCase();
        return !q || l.action_type.toLowerCase().includes(q) ||
               (l.admin?.name && l.admin.name.toLowerCase().includes(q));
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderLogsTable(pageData);
    renderPagination('logsPagination', total, page, pageSize, (p) => loadLogsTable(p, pageSize));
}

function renderLogsTable(data) {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">لا توجد سجلات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(l => {
        const details = l.details ? JSON.stringify(l.details) : '';
        return `<tr>
            <td>${escapeHTML(l.admin?.name || 'غير معروف')}</td>
            <td>${escapeHTML(l.action_type)}</td>
            <td>${escapeHTML(details)}</td>
            <td>${new Date(l.created_at).toLocaleString('ar-EG')}</td>
        </tr>`;
    }).join('');
}

window.filterLogs = function() {
    const input = document.getElementById('logSearchInput');
    logsFilter.query = input ? input.value.trim() : '';
    loadLogsTable();
};

// ====== دوال الإشعارات ======
window.sendBulkNotification = async function() {
    const title = document.getElementById('notificationTitle').value.trim();
    const message = document.getElementById('notificationMessage').value.trim();
    const recipientType = document.getElementById('notificationRecipients').value;
    const specificEmail = document.getElementById('specificUserEmail').value.trim();

    if (!title || !message) {
        showToast('يرجى إدخال العنوان والرسالة', 'warning');
        return;
    }

    if (recipientType === 'specific' && !specificEmail) {
        showToast('يرجى إدخال البريد الإلكتروني للمستخدم', 'warning');
        return;
    }

    showLoading(true);
    try {
        const count = await sendBulkNotification(recipientType, title, message, specificEmail);
        showToast(`تم إرسال الإشعار إلى ${count} مستخدم`, 'success');
        document.getElementById('notificationTitle').value = '';
        document.getElementById('notificationMessage').value = '';
        document.getElementById('specificUserEmail').value = '';
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

// ====== دوال الإعدادات ======
async function loadSettingsForm() {
    const container = document.getElementById('settingsForm');
    if (!container) return;
    const settings = await getAppSettings();
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.setting_key] = s.setting_value);

    container.innerHTML = `
        <div class="input-group"><label class="input-label">اسم التطبيق</label><input type="text" id="setting_app_name" class="input-field" value="${escapeHTML(settingsMap.app_name || 'Misar Systems')}"></div>
        <div class="input-group"><label class="input-label">رسوم التوصيل الافتراضية (ج.م)</label><input type="number" id="setting_delivery_fee" class="input-field" value="${settingsMap.delivery_fee || 20}"></div>
        <div class="input-group"><label class="input-label">عمولة البائع (%)</label><input type="number" id="setting_seller_commission" class="input-field" value="${settingsMap.seller_commission || 5}"></div>
        <div class="input-group"><label class="input-label">عمولة المندوب (%)</label><input type="number" id="setting_delivery_commission" class="input-field" value="${settingsMap.delivery_commission || 10}"></div>
        <div class="input-group"><label class="input-label">الحد الأدنى للسحب (ج.م)</label><input type="number" id="setting_min_withdrawal" class="input-field" value="${settingsMap.min_withdrawal || 100}"></div>
    `;
}

window.saveAllSettings = async function() {
    const settings = [
        { setting_key: 'app_name', setting_value: document.getElementById('setting_app_name').value.trim() },
        { setting_key: 'delivery_fee', setting_value: document.getElementById('setting_delivery_fee').value.trim() },
        { setting_key: 'seller_commission', setting_value: document.getElementById('setting_seller_commission').value.trim() },
        { setting_key: 'delivery_commission', setting_value: document.getElementById('setting_delivery_commission').value.trim() },
        { setting_key: 'min_withdrawal', setting_value: document.getElementById('setting_min_withdrawal').value.trim() }
    ];
    showLoading(true);
    try {
        await saveAppSettings(settings);
        showToast('تم حفظ الإعدادات', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

// ====== دوال المناديب (جدول) ======
let deliveriesFilter = { query: '', status: 'all' };
async function loadDeliveriesTable(page = 1, pageSize = 10) {
    const deliveries = await getAllDeliveries();
    const filtered = deliveries.filter(d => {
        const q = deliveriesFilter.query.toLowerCase();
        const matchQuery = !q || (d.name && d.name.toLowerCase().includes(q)) ||
                           (d.phone && d.phone.includes(q)) ||
                           (d.governorate && d.governorate.toLowerCase().includes(q)) ||
                           (d.center && d.center.toLowerCase().includes(q)) ||
                           (d.status && d.status.toLowerCase().includes(q));
        const matchStatus = deliveriesFilter.status === 'all' || d.status === deliveriesFilter.status;
        return matchQuery && matchStatus;
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderDeliveriesTable(pageData);
    renderPagination('deliveriesPagination', total, page, pageSize, (p) => loadDeliveriesTable(p, pageSize));
}

function renderDeliveriesTable(data) {
    const tbody = document.getElementById('deliveriesTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px;">لا يوجد مناديب</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(d => {
        const img = d.image_url ? `<img src="${d.image_url}" class="avatar-img" loading="lazy">` : '<i class="fas fa-user" style="font-size:1.5rem;"></i>';
        const statusMap = {
            'pending': 'قيد المراجعة',
            'approved': 'معتمد',
            'suspended': 'موقوف',
            'rejected': 'مرفوض'
        };
        const statusText = statusMap[d.status] || d.status;
        const lastLogin = d.last_login ? new Date(d.last_login).toLocaleDateString('ar-EG') : 'غير معروف';
        return `<tr>
            <td>${img}</td>
            <td>${escapeHTML(d.name || 'غير معروف')}</td>
            <td>${escapeHTML(d.phone || '')}</td>
            <td>${escapeHTML(d.email || '')}</td>
            <td>${escapeHTML(d.governorate || '')}</td>
            <td>${escapeHTML(d.center || '')}</td>
            <td>${new Date(d.created_at).toLocaleDateString('ar-EG')}</td>
            <td>${lastLogin}</td>
            <td><span class="status-badge ${d.status}">${statusText}</span></td>
            <td>
                <div class="action-group">
                    ${d.status === 'pending' ? `
                        <button class="btn-sm approve" onclick="approveDelivery('${d.id}')"><i class="fas fa-check"></i></button>
                        <button class="btn-sm reject" onclick="rejectDelivery('${d.id}')"><i class="fas fa-times"></i></button>
                    ` : ''}
                    ${d.status === 'approved' ? `<button class="btn-sm suspend" onclick="suspendDelivery('${d.id}')"><i class="fas fa-pause"></i></button>` : ''}
                    ${d.status === 'suspended' ? `<button class="btn-sm reactivate" onclick="reactivateDelivery('${d.id}')"><i class="fas fa-play"></i></button>` : ''}
                    <button class="btn-sm edit" onclick="editUser('${d.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn-sm view" onclick="viewUserDetails('${d.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm contact" onclick="contactUser('${d.id}')"><i class="fas fa-phone"></i></button>
                    <button class="btn-sm message" onclick="messageUser('${d.id}')"><i class="fas fa-envelope"></i></button>
                    <button class="btn-sm delete" onclick="deleteDeliveryConfirm('${d.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.filterDeliveries = function() {
    const input = document.getElementById('deliverySearchInput');
    deliveriesFilter.query = input ? input.value.trim() : '';
    loadDeliveriesTable();
};

window.filterDeliveriesByStatus = function(status) {
    deliveriesFilter.status = status;
    document.querySelectorAll('#tab-deliveries .filter-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('#tab-deliveries .filter-btn');
    const index = ['all','pending','approved','suspended','rejected'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadDeliveriesTable();
};

// ====== دوال العملاء (جدول) ======
let customersFilter = { query: '' };
async function loadCustomersTable(page = 1, pageSize = 10) {
    const clients = await getAllClients();
    const filtered = clients.filter(c => {
        const q = customersFilter.query.toLowerCase();
        return !q || (c.name && c.name.toLowerCase().includes(q)) ||
               (c.phone && c.phone.includes(q)) ||
               (c.email && c.email.toLowerCase().includes(q));
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderCustomersTable(pageData);
    renderPagination('customersPagination', total, page, pageSize, (p) => loadCustomersTable(p, pageSize));
}

function renderCustomersTable(data) {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">لا يوجد عملاء</td></tr>';
        return;
    }
    // جلب عدد طلبات كل عميل
    (async () => {
        for (let c of data) {
            const { count } = await supabaseClient.from('orders').select('id', { count: 'exact' }).eq('buyer_id', c.id);
            c.order_count = count || 0;
        }
        tbody.innerHTML = data.map(c => {
            const img = c.image_url ? `<img src="${c.image_url}" class="avatar-img" loading="lazy">` : '<i class="fas fa-user" style="font-size:1.5rem;"></i>';
            return `<tr>
                <td>${img}</td>
                <td>${escapeHTML(c.name || 'غير معروف')}</td>
                <td>${escapeHTML(c.phone || '')}</td>
                <td>${escapeHTML(c.email || '')}</td>
                <td>${c.order_count}</td>
                <td>${new Date(c.created_at).toLocaleDateString('ar-EG')}</td>
                <td>
                    <div class="action-group">
                        <button class="btn-sm view" onclick="viewUserDetails('${c.id}')"><i class="fas fa-eye"></i></button>
                        <button class="btn-sm edit" onclick="editUser('${c.id}')"><i class="fas fa-edit"></i></button>
                        <button class="btn-sm suspend" onclick="suspendClient('${c.id}')"><i class="fas fa-pause"></i></button>
                        <button class="btn-sm delete" onclick="deleteClientConfirm('${c.id}')"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    })();
}

window.filterCustomers = function() {
    const input = document.getElementById('customerSearchInput');
    customersFilter.query = input ? input.value.trim() : '';
    loadCustomersTable();
};

// ====== دوال البائعين (جدول) ======
let sellersFilter = { query: '', status: 'all' };
async function loadSellersTable(page = 1, pageSize = 10) {
    const sellers = await getAllSellers();
    const filtered = sellers.filter(s => {
        const q = sellersFilter.query.toLowerCase();
        const matchQuery = !q || (s.name && s.name.toLowerCase().includes(q)) ||
                           (s.username && s.username.toLowerCase().includes(q)) ||
                           (s.store_name && s.store_name.toLowerCase().includes(q));
        const matchStatus = sellersFilter.status === 'all' || s.status === sellersFilter.status;
        return matchQuery && matchStatus;
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderSellersTable(pageData);
    renderPagination('sellersPagination', total, page, pageSize, (p) => loadSellersTable(p, pageSize));
}

function renderSellersTable(data) {
    const tbody = document.getElementById('sellersTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px;">لا يوجد بائعين</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(s => {
        const img = s.image_url ? `<img src="${s.image_url}" class="avatar-img" loading="lazy">` : '<i class="fas fa-store" style="font-size:1.5rem;"></i>';
        const statusText = s.status === 'approved' ? 'نشط' : (s.status === 'suspended' ? 'موقوف' : 'غير معروف');
        const statusClass = s.status === 'approved' ? 'active' : (s.status === 'suspended' ? 'suspended' : '');
        return `<tr>
            <td>${img}</td>
            <td>${escapeHTML(s.username || s.name || 'غير معروف')}</td>
            <td>${escapeHTML(s.name || 'غير معروف')}</td>
            <td>${escapeHTML(s.phone || '')}</td>
            <td>${s.product_count || 0}</td>
            <td>${s.order_count || 0}</td>
            <td>${s.avg_rating ? s.avg_rating.toFixed(1) : '0'}</td>
            <td>${new Date(s.created_at).toLocaleDateString('ar-EG')}</td>
            <td>
                <div class="action-group">
                    <button class="btn-sm view" onclick="viewUserDetails('${s.id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-sm edit" onclick="editUser('${s.id}')"><i class="fas fa-edit"></i></button>
                    ${s.status === 'approved' ? `<button class="btn-sm suspend" onclick="suspendSeller('${s.id}')"><i class="fas fa-pause"></i></button>` :
                    `<button class="btn-sm reactivate" onclick="reactivateSeller('${s.id}')"><i class="fas fa-play"></i></button>`}
                    <button class="btn-sm delete" onclick="deleteSellerConfirm('${s.id}')"><i class="fas fa-trash"></i></button>
                    <button class="btn-sm contact" onclick="contactUser('${s.id}')"><i class="fas fa-phone"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

window.filterSellers = function() {
    const input = document.getElementById('sellerSearchInput');
    sellersFilter.query = input ? input.value.trim() : '';
    loadSellersTable();
};

window.filterSellersByStatus = function(status) {
    sellersFilter.status = status;
    document.querySelectorAll('#tab-sellers .filter-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('#tab-sellers .filter-btn');
    const index = ['all','approved','suspended'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadSellersTable();
};

// ====== دوال عامة للعمليات على المستخدمين ======
window.approveDelivery = async function(userId) {
    if (!confirm('قبول هذا المندوب؟')) return;
    showLoading(true);
    try {
        await updateDeliveryStatus(userId, 'approved');
        showToast('تم قبول المندوب', 'success');
        loadDeliveriesTable();
        loadPendingDeliveries();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.rejectDelivery = async function(userId) {
    if (!confirm('رفض هذا المندوب؟')) return;
    showLoading(true);
    try {
        await updateDeliveryStatus(userId, 'rejected');
        showToast('تم رفض المندوب', 'success');
        loadDeliveriesTable();
        loadPendingDeliveries();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.suspendDelivery = async function(userId) {
    if (!confirm('إيقاف هذا المندوب؟')) return;
    showLoading(true);
    try {
        await updateDeliveryStatus(userId, 'suspended');
        showToast('تم إيقاف المندوب', 'success');
        loadDeliveriesTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.reactivateDelivery = async function(userId) {
    if (!confirm('إعادة تفعيل هذا المندوب؟')) return;
    showLoading(true);
    try {
        await updateDeliveryStatus(userId, 'approved');
        showToast('تم إعادة تفعيل المندوب', 'success');
        loadDeliveriesTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.deleteDeliveryConfirm = async function(userId) {
    if (!confirm('حذف هذا المندوب نهائياً؟')) return;
    showLoading(true);
    try {
        await deleteDelivery(userId);
        showToast('تم حذف المندوب', 'success');
        loadDeliveriesTable();
        loadPendingDeliveries();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.suspendClient = async function(userId) {
    if (!confirm('إيقاف هذا العميل؟')) return;
    showLoading(true);
    try {
        await updateClientStatus(userId, 'suspended');
        showToast('تم إيقاف العميل', 'success');
        loadCustomersTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.deleteClientConfirm = async function(userId) {
    if (!confirm('حذف هذا العميل نهائياً؟')) return;
    showLoading(true);
    try {
        await deleteClient(userId);
        showToast('تم حذف العميل', 'success');
        loadCustomersTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.suspendSeller = async function(userId) {
    if (!confirm('إيقاف هذا البائع؟')) return;
    showLoading(true);
    try {
        await updateSellerStatus(userId, 'suspended');
        showToast('تم إيقاف البائع', 'success');
        loadSellersTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.reactivateSeller = async function(userId) {
    if (!confirm('إعادة تفعيل هذا البائع؟')) return;
    showLoading(true);
    try {
        await updateSellerStatus(userId, 'approved');
        showToast('تم إعادة تفعيل البائع', 'success');
        loadSellersTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.deleteSellerConfirm = async function(userId) {
    if (!confirm('حذف هذا البائع نهائياً؟')) return;
    showLoading(true);
    try {
        await updateSellerStatus(userId, 'deleted');
        showToast('تم حذف البائع', 'success');
        loadSellersTable();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

// ====== دوال المستخدمين (عرض/تعديل/اتصال) ======
window.viewUserDetails = function(userId) {
    (async () => {
        const { data } = await supabaseClient.from('user_data').select('*').eq('id', userId).single();
        if (data) {
            document.getElementById('detailsContent').innerHTML = `
                <p><strong>الاسم:</strong> ${escapeHTML(data.name || '')}</p>
                <p><strong>البريد:</strong> ${escapeHTML(data.email || '')}</p>
                <p><strong>الهاتف:</strong> ${escapeHTML(data.phone || '')}</p>
                <p><strong>المحافظة:</strong> ${escapeHTML(data.governorate || '')}</p>
                <p><strong>المركز:</strong> ${escapeHTML(data.center || '')}</p>
                <p><strong>نوع الحساب:</strong> ${data.account_type}</p>
                <p><strong>الحالة:</strong> ${data.status}</p>
                <p><strong>تاريخ التسجيل:</strong> ${new Date(data.created_at).toLocaleString('ar-EG')}</p>
            `;
            document.getElementById('detailsModal').classList.add('active');
        }
    })();
};

window.editUser = function(userId) {
    (async () => {
        const { data } = await supabaseClient.from('user_data').select('*').eq('id', userId).single();
        if (data) {
            document.getElementById('editingUserId').value = data.id;
            document.getElementById('editUserName').value = data.name || '';
            document.getElementById('editUserPhone').value = data.phone || '';
            document.getElementById('editUserGovernorate').value = data.governorate || '';
            document.getElementById('editUserCenter').value = data.center || '';
            document.getElementById('userEditModal').classList.add('active');
        }
    })();
};

window.closeUserEditModal = function() {
    document.getElementById('userEditModal').classList.remove('active');
};

window.saveUserEdit = async function() {
    const userId = document.getElementById('editingUserId').value;
    const name = document.getElementById('editUserName').value.trim();
    const phone = document.getElementById('editUserPhone').value.trim();
    const governorate = document.getElementById('editUserGovernorate').value.trim();
    const center = document.getElementById('editUserCenter').value.trim();
    if (!userId) return;
    showLoading(true);
    try {
        await supabaseClient.from('user_data').update({
            name, phone, governorate, center,
            updated_at: new Date()
        }).eq('id', userId);
        showToast('تم تحديث بيانات المستخدم', 'success');
        closeUserEditModal();
        // تحديث الجدول النشط
        const activeTab = document.querySelector('.founder-tab.active');
        if (activeTab) {
            const tabId = activeTab.dataset.tab;
            if (tabId === 'deliveries') loadDeliveriesTable();
            else if (tabId === 'customers') loadCustomersTable();
            else if (tabId === 'sellers') loadSellersTable();
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
};

window.contactUser = function(userId) {
    (async () => {
        const { data } = await supabaseClient.from('user_data').select('phone').eq('id', userId).single();
        if (data && data.phone) {
            window.location.href = `tel:${data.phone}`;
        } else {
            showToast('رقم الهاتف غير متوفر', 'warning');
        }
    })();
};

window.messageUser = function(userId) {
    (async () => {
        const { data } = await supabaseClient.from('user_data').select('email').eq('id', userId).single();
        if (data && data.email) {
            window.location.href = `mailto:${data.email}`;
        } else {
            showToast('البريد الإلكتروني غير متوفر', 'warning');
        }
    })();
};

// ====== مودال التأكيد ======
window.showConfirmModal = function(message, onConfirm) {
    document.getElementById('confirmMessage').textContent = message;
    const confirmBtn = document.getElementById('confirmActionBtn');
    confirmBtn.onclick = function() {
        closeConfirmModal();
        onConfirm();
    };
    document.getElementById('confirmModal').classList.add('active');
};

window.closeConfirmModal = function() {
    document.getElementById('confirmModal').classList.remove('active');
};

// ====== مودال التفاصيل ======
window.closeDetailsModal = function() {
    document.getElementById('detailsModal').classList.remove('active');
};

// ====== دالة ترقيم الصفحات ======
function renderPagination(containerId, total, currentPage, pageSize, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="${i === currentPage ? 'active' : ''}" onclick="(function(){ ${onPageChange.toString()}( ${i} ); })()">${i}</button>`;
    }
    container.innerHTML = html;
}
// ===================== تصدير الدوال العامة =====================
window.loadProductsFromDB = loadProductsFromDB;
window.loadFeaturedProducts = loadFeaturedProducts;
window.loadMarketProducts = loadMarketProducts;
window.filterMarketProducts = filterMarketProducts;
window.clearSearch = clearSearch;
window.createProductCard = createProductCard;
window.loadSellerProducts = loadSellerProducts;
window.addProduct = addProduct;
window.updateProduct = updateProduct;
window.deleteProduct = deleteProduct;
window.saveProduct = saveProduct;
window.previewMultipleImages = previewMultipleImages;
window.refreshSellerDashboard = refreshSellerDashboard;
window.updateSellerStats = updateSellerStats;
window.displaySellerProducts = displaySellerProducts;
window.displaySellerOrders = displaySellerOrders;
window.filterSellerProducts = filterSellerProducts;
window.filterSellerOrders = filterSellerOrders;
window.switchSellerTab = switchSellerTab;
window.updateAnalytics = updateAnalytics;
window.showAddProductForm = showAddProductForm;
window.editProduct = editProduct;
window.confirmDelete = confirmDelete;
window.adjustStock = adjustStock;
window.viewOrderDetails = viewOrderDetails;
window.updateOrderStatusFromModal = updateOrderStatusFromModal;
window.closeOrderModal = closeOrderModal;
window.closeProductModal = closeProductModal;
window.showNotifications = showNotifications;
window.exportOrdersCSV = exportOrdersCSV;
window.confirmOrderSeller = confirmOrderSeller;
window.prepareOrderSeller = prepareOrderSeller;
window.loadServices = loadServices;
window.bookService = bookService;
window.addSellerStoreTools = addSellerStoreTools;
window.updateStoreTools = updateStoreTools;
window.getStoreUrl = getStoreUrl;
window.generateStoreQR = generateStoreQR;
window.copyStoreLink = copyStoreLink;
window.shareStoreLink = shareStoreLink;
window.showStorePage = showStorePage;
window.openProductDetailFromStore = openProductDetailFromStore;
window.togglePasswordVisibility = togglePasswordVisibility;  // ✅ إضافة الدالة الجديدة
// تصدير دوال إدارة المنتجات (المؤسس)
// ملاحظة: deleteProductAdmin موجودة في supabase.js ويتم تصديرها هناك
window.hardDeleteProductAdmin = hardDeleteProductAdmin;
window.deleteProductAdminConfirm = deleteProductAdminConfirm;
window.forceDeleteProductAdmin = forceDeleteProductAdmin;
window.loadProductsTableAdmin = loadProductsTableAdmin;
window.renderProductsTableAdmin = renderProductsTableAdmin;
window.filterProductsAdminData = filterProductsAdminData;
window.productsAdminFilter = productsAdminFilter;