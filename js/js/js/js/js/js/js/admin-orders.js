// ============================================================
// إدارة الطلبات (عرض، تغيير الحالة)
// ============================================================

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
    } finally { showLoading(false); }
};