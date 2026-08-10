// ============================================================
// إدارة العملاء والبائعين (عرض، تعديل، إيقاف، حذف)
// ============================================================

// ------ العملاء ------
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

// ------ البائعين ------
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

// ====== عمليات العملاء والبائعين ======
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
        const activeTab = document.querySelector('.founder-tab.active');
        if (activeTab) {
            const tabId = activeTab.dataset.tab;
            if (tabId === 'deliveries') loadDeliveriesTable();
            else if (tabId === 'customers') loadCustomersTable();
            else if (tabId === 'sellers') loadSellersTable();
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
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