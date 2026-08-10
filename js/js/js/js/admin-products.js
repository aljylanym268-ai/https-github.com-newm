// ============================================================
// إدارة المنتجات (عرض، إخفاء، نشر، مراجعة، حذف نهائي)
// ============================================================

let productsAdminFilter = { query: '', status: 'all' };

async function loadProductsTableAdmin(page = 1, pageSize = 10) {
    const products = await getAllProductsAdmin();
    const filtered = products.filter(p => {
        const q = productsAdminFilter.query.toLowerCase();
        const matchQuery = !q || p.name.toLowerCase().includes(q) ||
                           (p.user_data?.name && p.user_data.name.toLowerCase().includes(q)) ||
                           (p.category && p.category.toLowerCase().includes(q));
        const matchStatus = productsAdminFilter.status === 'all' || (p.status || 'published') === productsAdminFilter.status;
        return matchQuery && matchStatus;
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderProductsTableAdmin(pageData);
    renderPagination('productsPagination', total, page, pageSize, (p) => loadProductsTableAdmin(p, pageSize));
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

// ====== دوال الإجراءات ======
window.viewProductDetails = async function(productId) {
    const { data } = await supabaseClient.from('products').select('*').eq('id', productId).single();
    if (data) {
        document.getElementById('detailsContent').innerHTML = `
            <p><strong>الاسم:</strong> ${escapeHTML(data.name)}</p>
            <p><strong>السعر:</strong> ${data.price} ج.م</p>
            <p><strong>الوصف:</strong> ${escapeHTML(data.description || '')}</p>
            <p><strong>القسم:</strong> ${data.category || 'عام'}</p>
            <p><strong>الحالة:</strong> ${data.status || 'منشور'}</p>
            <p><strong>تاريخ الإضافة:</strong> ${new Date(data.created_at).toLocaleString('ar-EG')}</p>
        `;
        document.getElementById('detailsModal').classList.add('active');
    }
};

window.editProductAdmin = function(productId) {
    showToast('سيتم إضافة هذه الميزة قريباً', 'info');
};

window.hideProductAdmin = async function(productId) {
    if (!confirm('هل تريد إخفاء هذا المنتج؟')) return;
    showLoading(true);
    try {
        await updateProductStatusAdmin(productId, 'hidden');
        showToast('تم إخفاء المنتج', 'success');
        loadProductsTableAdmin();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.unhideProductAdmin = async function(productId) {
    if (!confirm('هل تريد إعادة نشر هذا المنتج؟')) return;
    showLoading(true);
    try {
        await updateProductStatusAdmin(productId, 'published');
        showToast('تم إعادة نشر المنتج', 'success');
        loadProductsTableAdmin();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

window.reviewProductAdmin = async function(productId) {
    if (!confirm('هل تريد وضع هذا المنتج قيد المراجعة؟')) return;
    showLoading(true);
    try {
        await updateProductStatusAdmin(productId, 'review');
        showToast('تم وضع المنتج قيد المراجعة', 'success');
        loadProductsTableAdmin();
    } catch (err) { showToast(err.message, 'error'); }
    finally { showLoading(false); }
};

// ====== الحذف النهائي باستخدام Soft Delete ======
window.deleteProductAdminConfirm = async function(productId) {
    if (!productId) {
        showToast('معرف المنتج غير صحيح', 'error');
        return;
    }

    if (!confirm('⚠️ هل أنت متأكد من حذف هذا المنتج نهائياً؟\nسيتم إخفاء المنتج عن جميع المستخدمين ولن يظهر في أي مكان.')) {
        return;
    }

    showLoading(true);
    try {
        // استخدام deleteProductAdmin التي تقوم بتحديث الحالة إلى 'deleted'
        await window.deleteProductAdmin(productId);
        showToast('✅ تم حذف المنتج نهائياً', 'success');
        
        // تحديث الجداول والقوائم
        await loadProductsTableAdmin();
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

window.filterProductsAdmin = function() {
    const input = document.getElementById('productSearchInput');
    productsAdminFilter.query = input ? input.value.trim() : '';
    loadProductsTableAdmin();
};

window.filterProductsAdminByStatus = function(status) {
    productsAdminFilter.status = status;
    document.querySelectorAll('#tab-products .filter-btn').forEach(btn => btn.classList.remove('active'));
    const btns = document.querySelectorAll('#tab-products .filter-btn');
    const index = ['all','published','hidden','review'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    loadProductsTableAdmin();
};

// تصدير دوال المنتجات
window.getAllProductsAdmin = getAllProductsAdmin;
window.updateProductStatusAdmin = updateProductStatusAdmin;
window.deleteProductAdmin = deleteProductAdmin;
window.hardDeleteProductAdmin = hardDeleteProductAdmin; // احتفظ بها للاستخدام الداخلي إن لزم
window.loadProductsTableAdmin = loadProductsTableAdmin;
window.renderProductsTableAdmin = renderProductsTableAdmin;
window.productsAdminFilter = productsAdminFilter;