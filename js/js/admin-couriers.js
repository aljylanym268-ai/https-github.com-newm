// ============================================================
// إدارة المناديب (عرض، قبول، رفض، إيقاف، حذف)
// ============================================================

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

// ====== دوال العمليات ======
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