// ============================================================
// إدارة العقارات (عرض، إضافة، تعديل، إخفاء، حذف)
// ============================================================

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

    if (!name || !price) { showToast('يرجى إدخال الاسم والسعر', 'warning'); return; }

    let ownerId = null;
    if (ownerEmail) {
        const { data } = await supabaseClient.from('user_data').select('id').eq('email', ownerEmail).maybeSingle();
        if (data) ownerId = data.id;
        else { showToast('المالك غير موجود في النظام', 'error'); return; }
    }

    const imagesInput = document.getElementById('propertyImages');
    let imageUrls = [];
    if (imagesInput.files.length) {
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
    } finally { showLoading(false); }
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