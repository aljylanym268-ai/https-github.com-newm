// ============================================================
// إدارة الخدمات (عرض، إضافة، تعديل، تفعيل/إيقاف، حذف)
// ============================================================

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

    if (!name) { showToast('يرجى إدخال اسم الخدمة', 'warning'); return; }

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
        await loadServices();
    } catch (err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
};

window.editService = function(serviceId) {
    (async () => {
        const services = await getAllServices();
        const service = services.find(s => s.id === serviceId);
        if (!service) { showToast('الخدمة غير موجودة', 'error'); return; }
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
    } finally { showLoading(false); }
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
    } finally { showLoading(false); }
};

window.viewServiceDetails = function(serviceId) {
    showToast('عرض التفاصيل قيد التطوير', 'info');
};