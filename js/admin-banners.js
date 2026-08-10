// Admin (Founder) banners management: CRUD + image upload
let editingBannerId = null;

// Helper: check if current user is founder (returns boolean)
async function isCurrentUserFounder() {
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return false;
        // Try fetching user_data for this uid
        const { data, error } = await supabaseClient.from('user_data').select('account_type').eq('id', uid).maybeSingle();
        if (error) {
            console.warn('Could not read user_data to verify founder role:', error);
            return false;
        }
        return data?.account_type === 'founder';
    } catch (e) {
        console.error('Error checking founder role:', e);
        return false;
    }
}

async function refreshBannersAdmin() {
    try {
        const { data, error } = await supabaseClient
            .from('banners')
            .select('*')
            .order('sort_order', { ascending: true });
        if (error) throw error;
        renderBannersTable(data || []);
    } catch (e) {
        console.error('Failed to load banners (admin):', e);
        showToast('فشل جلب الإعلانات من الخادم', 'error');
    }
}

function renderBannersTable(banners) {
    const body = document.getElementById('bannersTableBody');
    body.innerHTML = '';
    banners.forEach(b => {
        const tr = document.createElement('tr');
        tr.setAttribute('draggable', 'true');
        tr.dataset.id = b.id;
        tr.innerHTML = `
            <td><img src="${escapeHTML(b.image_url||'')}" alt="${escapeHTML(b.title||'')}"></td>
            <td>${escapeHTML(b.title||'')}</td>
            <td style="direction:ltr;">${escapeHTML(b.link||'')}</td>
            <td class="sort-order-cell">${escapeHTML(String(b.sort_order||0))}</td>
            <td>${b.active ? 'نعم' : 'لا'}</td>
            <td class="banner-actions">
                <div class="sort-controls" title="اسحب أو استخدم الأسهم لترتيب">
                    <button onclick="moveBannerUp('${b.id}')" aria-label="نقل للأعلى">▲</button>
                    <button onclick="moveBannerDown('${b.id}')" aria-label="نقل للأسفل">▼</button>
                </div>
                <button class="google-btn" onclick="editBanner('${b.id}')"><i class="fas fa-edit"></i></button>
                <button class="founder-btn" onclick="toggleBannerActive('${b.id}', ${b.active ? 'false' : 'true'})">${b.active ? 'إيقاف' : 'تفعيل'}</button>
                <button class="remove-btn" onclick="confirmDeleteBanner('${b.id}')"><i class="fas fa-trash"></i></button>
            </td>
        `;
        // Attach drag event listeners
        tr.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', b.id);
            e.currentTarget.classList.add('dragging');
        });
        tr.addEventListener('dragend', (e) => {
            e.currentTarget.classList.remove('dragging');
        });
        tr.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.currentTarget;
            target.classList.add('drag-over');
        });
        tr.addEventListener('dragleave', (e) => {
            e.currentTarget.classList.remove('drag-over');
        });
        tr.addEventListener('drop', async (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            const targetId = e.currentTarget.dataset.id;
            if (!draggedId || !targetId || draggedId === targetId) return;
            // reorder DOM rows
            const draggedRow = body.querySelector(`tr[data-id='${draggedId}']`);
            const targetRow = body.querySelector(`tr[data-id='${targetId}']`);
            if (!draggedRow || !targetRow) return;
            body.insertBefore(draggedRow, targetRow.nextSibling);
            // persist new order
            await updateSortOrdersFromDOM();
        });
        body.appendChild(tr);
    });
}

// Move up/down helpers for accessibility (buttons)
function moveBannerUp(id) {
    const body = document.getElementById('bannersTableBody');
    const row = body.querySelector(`tr[data-id='${id}']`);
    if (row && row.previousElementSibling) {
        body.insertBefore(row, row.previousElementSibling);
        updateSortOrdersFromDOM();
    }
}
function moveBannerDown(id) {
    const body = document.getElementById('bannersTableBody');
    const row = body.querySelector(`tr[data-id='${id}']`);
    if (row && row.nextElementSibling) {
        body.insertBefore(row.nextElementSibling, row);
        updateSortOrdersFromDOM();
    }
}

// Read DOM order and update sort_order in DB accordingly
async function updateSortOrdersFromDOM() {
    try {
        showLoading(true);
        const body = document.getElementById('bannersTableBody');
        const rows = Array.from(body.querySelectorAll('tr'));
        // Build updates: smaller index => smaller sort_order (0-based)
        const updates = rows.map((r, idx) => ({ id: r.dataset.id, sort_order: idx }));
        // Ensure founder
        const isFounderUser = await isCurrentUserFounder();
        if (!isFounderUser) { showLoading(false); showToast('غير مصرح لك بتعديل الترتيب.', 'error'); return; }
        // Run updates in parallel
        const promises = updates.map(u => supabaseClient.from('banners').update({ sort_order: u.sort_order }).eq('id', u.id));
        const results = await Promise.all(promises);
        // Check for errors
        const error = results.find(r => r.error)?.error;
        if (error) throw error;
        showToast('تم تحديث ترتيب الإعلانات', 'success');
        await refreshBannersAdmin();
        if (typeof loadHeroBanners === 'function') loadHeroBanners();
    } catch (e) {
        console.error('updateSortOrdersFromDOM error:', e);
        showToast('فشل تحديث ترتيب الإعلانات', 'error');
    } finally { showLoading(false); }
}

async function saveBannerAdmin() {
    try {
        // ensure the user is founder before attempting mutations
        const isFounder = await isCurrentUserFounder();
        if (!isFounder) {
            showToast('غير مصرح لك. يجب أن تكون مؤسساً لإدارة الإعلانات.', 'error');
            console.warn('saveBannerAdmin blocked: current user is not founder');
            return;
        }

        const title = document.getElementById('bannerTitle').value.trim();
        const description = document.getElementById('bannerDescription').value.trim();
        const link = document.getElementById('bannerLink').value.trim();
        const sort_order = parseInt(document.getElementById('bannerSortOrder').value || '0');
        const active = document.getElementById('bannerActive').checked;
        const imageInput = document.getElementById('bannerImageInput');

        if (!title) { showToast('تأكد من كتابة عنوان الإعلان', 'warning'); return; }

        let image_url = null;
        if (imageInput && imageInput.files && imageInput.files.length > 0) {
            showLoading(true);
            const file = imageInput.files[0];
            // compress/upload using existing helper
            const compressed = await compressImage(file, 1600, 900, 0.8);
            const uniqueName = `banner-${Date.now()}-${Math.random().toString(36).substring(2)}.${file.name.split('.').pop()}`;
            const filePath = `banners/${uniqueName}`;
            const { error: upErr } = await supabaseClient.storage.from('product-images').upload(filePath, compressed, { cacheControl: '3600', upsert: false });
            if (upErr) throw upErr;
            const { data: { publicUrl } } = supabaseClient.storage.from('product-images').getPublicUrl(filePath);
            image_url = publicUrl;
            showLoading(false);
        }

        const payload = {
            title, description, link, sort_order, active
        };
        if (image_url) payload.image_url = image_url;

        if (editingBannerId) {
            const { data, error } = await supabaseClient.from('banners').update(payload).eq('id', editingBannerId).select().single();
            if (error) throw error;
            showToast('تم تحديث الإعلان بنجاح', 'success');
        } else {
            payload.created_at = new Date();
            const { data, error } = await supabaseClient.from('banners').insert(payload).select().single();
            if (error) throw error;
            showToast('تم إضافة الإعلان بنجاح', 'success');
        }

        clearBannerForm();
        await refreshBannersAdmin();
        // reload public slider
        if (typeof loadHeroBanners === 'function') loadHeroBanners();
    } catch (e) {
        showLoading(false);
        console.error('saveBannerAdmin error:', e);
        const msg = (e && (e.status === 403 || /permission|RLS|row level security|not authorized/i.test(String(e.message || e))))
            ? 'فشل الإجراء بسبب قيود الصلاحيات (RLS). تأكد أن حسابك مؤسس وأن سياسات RLS تسمح له بالكتابة.'
            : extractErrorMessage(e);
        showToast(msg, 'error');
    }
}

function clearBannerForm() {
    editingBannerId = null;
    document.getElementById('bannerTitle').value = '';
    document.getElementById('bannerDescription').value = '';
    document.getElementById('bannerLink').value = '';
    document.getElementById('bannerSortOrder').value = '0';
    document.getElementById('bannerActive').checked = true;
    const input = document.getElementById('bannerImageInput');
    if (input) input.value = '';
    // clear preview
    const previewImg = document.getElementById('bannerImagePreviewImg');
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
}

// show live preview of selected image
function previewBannerImage(e) {
    const file = e.target.files && e.target.files[0];
    const previewImg = document.getElementById('bannerImagePreviewImg');
    if (!previewImg) return;
    if (!file) { previewImg.src = ''; previewImg.style.display = 'none'; return; }
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.style.display = 'block';
}

async function editBanner(id) {
    try {
        const { data, error } = await supabaseClient.from('banners').select('*').eq('id', id).single();
        if (error) throw error;
        editingBannerId = id;
        document.getElementById('bannerTitle').value = data.title || '';
        document.getElementById('bannerDescription').value = data.description || '';
        document.getElementById('bannerLink').value = data.link || '';
        document.getElementById('bannerSortOrder').value = data.sort_order || 0;
        document.getElementById('bannerActive').checked = !!data.active;
        showToast('تم تحميل بيانات الإعلان للتحرير', 'info');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { console.error(e); showToast('فشل تحميل بيانات الإعلان', 'error'); }
}

function confirmDeleteBanner(id) {
    document.getElementById('confirmMessage').textContent = 'هل أنت متأكد من حذف هذا الإعلان نهائياً؟';
    document.getElementById('confirmActionBtn').onclick = () => deleteBanner(id);
    document.getElementById('confirmModal').style.display = 'flex';
}

async function deleteBanner(id) {
    try {
        const isFounder = await isCurrentUserFounder();
        if (!isFounder) { showToast('غير مصرح لك. يجب أن تكون مؤسساً لحذف الإعلانات.', 'error'); return; }
        const { error } = await supabaseClient.from('banners').delete().eq('id', id);
        if (error) throw error;
        showToast('تم حذف الإعلان', 'success');
        document.getElementById('confirmModal').style.display = 'none';
        await refreshBannersAdmin();
        if (typeof loadHeroBanners === 'function') loadHeroBanners();
    } catch (e) { console.error('deleteBanner error:', e); const msg = (e && (e.status === 403 || /permission|RLS|row level security|not authorized/i.test(String(e.message || e)))) ? 'فشل الحذف بسبب قيود الصلاحيات (RLS)' : 'فشل حذف الإعلان'; showToast(msg, 'error'); }
}

async function toggleBannerActive(id, newState) {
    try {
        const isFounder = await isCurrentUserFounder();
        if (!isFounder) { showToast('غير مصرح لك. يجب أن تكون مؤسساً لتغيير حالة الإعلان.', 'error'); return; }
        const { error } = await supabaseClient.from('banners').update({ active: newState }).eq('id', id);
        if (error) throw error;
        await refreshBannersAdmin();
        if (typeof loadHeroBanners === 'function') loadHeroBanners();
        showToast('تم تحديث حالة الإعلان', 'success');
    } catch (e) { console.error('toggleBannerActive error:', e); const msg = (e && (e.status === 403 || /permission|RLS|row level security|not authorized/i.test(String(e.message || e)))) ? 'فشل تحديث الحالة بسبب قيود الصلاحيات (RLS)' : 'فشل تحديث الحالة'; showToast(msg, 'error'); }
}

// Bind UI
document.addEventListener('DOMContentLoaded', function() {
    const saveBtn = document.getElementById('saveBannerBtn');
    const clearBtn = document.getElementById('clearBannerFormBtn');
    if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); saveBannerAdmin(); });
    if (clearBtn) clearBtn.addEventListener('click', (e) => { e.preventDefault(); clearBannerForm(); });
    // refresh when founder dashboard opens
    window.refreshBannersAdmin = refreshBannersAdmin;
    // expose helper for debugging
    window.isCurrentUserFounder = isCurrentUserFounder;

    // bind image preview
    const imageInput = document.getElementById('bannerImageInput');
    if (imageInput) imageInput.addEventListener('change', previewBannerImage);

    // expose preview helper
    window.previewBannerImage = previewBannerImage;
});
