// ============================================================
// MISAR TECH — البرمجة والحلول الرقمية
// نموذج طلب المشروع + لوحة المؤسس + لوحة المدير العام
// الأمان: الفرض في RLS — الواجهة لا تقرر الصلاحية.
// ============================================================

// ---------- ثوابت ----------
const MISAR_TECH_STATUS_LABELS = {
    new: 'جديد',
    reviewing: 'قيد المراجعة',
    quoted: 'تم التسعير',
    in_progress: 'قيد التنفيذ',
    delivered: 'تم التسليم',
    cancelled: 'ملغي'
};
const MISAR_TECH_PROJECT_TYPES = {
    website: 'موقع إلكتروني',
    store: 'متجر أو منصة إلكترونية',
    mobile_app: 'تطبيق موبايل',
    business_system: 'نظام إدارة أعمال',
    ai_automation: 'ذكاء اصطناعي / أتمتة',
    other: 'أخرى'
};
const MISAR_TECH_SERVICES = [
    { icon: 'fas fa-globe', title: 'تصميم وتطوير المواقع الإلكترونية', desc: 'مواقع تعريفية، صفحات هبوط، بوابات خدمات' },
    { icon: 'fas fa-store', title: 'إنشاء المتاجر والمنصات الإلكترونية', desc: 'متاجر بمعالجة دفع وسلال وعملاء' },
    { icon: 'fas fa-mobile-alt', title: 'برمجة تطبيقات الموبايل', desc: 'أندرويد و iOS لتطبيق فكرتك' },
    { icon: 'fas fa-cogs', title: 'أنظمة إدارة الأعمال', desc: 'نقاط بيع، مخازن، فواتير، موارد بشرية' },
    { icon: 'fas fa-robot', title: 'حلول الذكاء الاصطناعي والأتمتة', desc: 'شات بوت، تحليل بيانات، أتمتة العمليات' }
];

// ---------- شاشة القسم ----------
function renderMisarTechServices() {
    const grid = document.getElementById('misarTechServices');
    if (!grid) return;
    grid.innerHTML = MISAR_TECH_SERVICES.map(s => `
        <div class="category-card" style="cursor:default;">
            <div class="category-icon"><i class="${s.icon}"></i></div>
            <div class="category-title">${s.title}</div>
            <div class="category-desc">${s.desc}</div>
        </div>`).join('');
}

function goBackFromMisarTech() {
    // عرض آخر شاشة سابقة (نفس منطق goBack العام)
    if (typeof goBack === 'function') { goBack(); return; }
    showScreen('homeScreen');
}

// تُستدعى عند فتح شاشة MISAR TECH من showScreen — إن لم يكن hook موجودًا فنسمع بالنقر مباشرة
function openMisarTechForm() {
    // تعبئة تاريخ اليوم كحد أدنى للموعد
    const dl = document.getElementById('mtDeadline');
    if (dl) dl.min = new Date().toISOString().split('T')[0];
    document.getElementById('misarTechFormModal').classList.add('active');
}

function closeMisarTechForm() {
    const m = document.getElementById('misarTechFormModal');
    if (m) m.classList.remove('active');
}

// ---------- نموذج الطلب ----------
let mtSubmitting = false;

function mtShowMsg(type, text) {
    const err = document.getElementById('mtFormError');
    const ok = document.getElementById('mtFormSuccess');
    if (err) { err.style.display = type === 'error' ? 'block' : 'none'; err.textContent = type === 'error' ? text : ''; }
    if (ok) { ok.style.display = type === 'success' ? 'block' : 'none'; ok.textContent = type === 'success' ? text : ''; }
}

function validateMisarTechForm() {
    const get = id => (document.getElementById(id)?.value || '').trim();
    const name = get('mtName'), contact = get('mtContact'), type = get('mtProjectType');
    const title = get('mtTitle'), brief = get('mtBrief'), budget = get('mtBudget'), deadline = get('mtDeadline');
    if (!name) return { ok: false, msg: 'الاسم مطلوب' };
    if (name.length < 3) return { ok: false, msg: 'الاسم قصير جدًا (3 أحرف على الأقل)' };
    if (!contact) return { ok: false, msg: 'وسيلة التواصل مطلوبة' };
    if (contact.length < 5) return { ok: false, msg: 'وسيلة التواصل قصيرة جدًا' };
    if (!type) return { ok: false, msg: 'اختر نوع المشروع' };
    if (!title) return { ok: false, msg: 'العنوان مطلوب' };
    if (title.length < 5) return { ok: false, msg: 'العنوان قصير جدًا (5 أحرف على الأقل)' };
    if (!brief) return { ok: false, msg: 'وصف الفكرة مطلوب' };
    if (brief.length < 20) return { ok: false, msg: 'وصف الفكرة قصير جدًا (20 حرفًا على الأقل)' };
    if (deadline && new Date(deadline) < new Date(new Date().toDateString())) return { ok: false, msg: 'الموعد المتوقع لا يمكن أن يكون بتاريخ ماضٍ' };
    return { ok: true, data: { name, contact, type, title, brief, budget: budget || null, deadline: deadline || null, notes: get('mtNotes') || null } };
}

async function submitMisarTechRequest() {
    if (mtSubmitting) return;               // منع الإرسال المتكرر بالضغط السريع
    const v = validateMisarTechForm();
    if (!v.ok) { mtShowMsg('error', v.msg); return; }
    mtSubmitting = true;
    const btn = document.getElementById('mtSubmitBtn');
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...';
    try {
        const payload = {
            client_id: appState.user ? appState.user.id : null,
            client_name: v.data.name,
            client_contact: v.data.contact,
            project_type: v.data.type,
            project_title: v.data.title,
            project_brief: v.data.brief,
            budget: v.data.budget,
            deadline: v.data.deadline,
            notes: v.data.notes,
            status: 'new'
        };
        const { error } = await supabaseClient.from('misar_tech_requests').insert(payload);
        if (error) throw error;
        mtShowMsg('error', '');
        mtShowMsg('success', 'تم إرسال طلبك بنجاح! سيتم التواصل معك قريبًا.');
        ['mtName','mtContact','mtProjectType','mtTitle','mtBrief','mtBudget','mtDeadline','mtNotes'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
    } catch (err) {
        mtShowMsg('error', 'فشل إرسال الطلب: ' + (err.message || 'خطأ غير معروف'));
    } finally {
        mtSubmitting = false;
        btn.disabled = false;
        btn.innerHTML = oldHtml;
    }
}

// ---------- لوحة المؤسس + المدير العام ----------
let misarTechCache = [];

async function loadMisarTechRequests() {
    const { data, error } = await supabaseClient
        .from('misar_tech_requests')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { showToast('تعذر تحميل طلبات MISAR TECH: ' + error.message, 'error'); return; }
    misarTechCache = data || [];
    const ctx = document.querySelector('#generalManagerDashboardScreen.active') ? 'gm' : 'founder';
    renderMisarTechAdminTable(ctx);
}

function misarTechFilter(ctx) {
    const pre = ctx === 'gm' ? 'gmMt' : 'mt';
    const q = (document.getElementById(pre + 'SearchInput')?.value || '').toLowerCase().trim();
    const st = document.getElementById(pre + 'StatusFilter')?.value || '';
    const dt = document.getElementById(pre + 'DateFilter')?.value || '';
    return misarTechCache.filter(r => {
        if (q && !(`${r.client_name} ${r.project_title}`.toLowerCase().includes(q))) return false;
        if (st && r.status !== st) return false;
        if (dt && !(r.created_at || '').startsWith(dt)) return false;
        return true;
    });
}

function renderMisarTechAdminTable(ctx = 'founder') {
    const bodyId = ctx === 'gm' ? 'gmMisarTechAdminTableBody' : 'misarTechAdminTableBody';
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;
    const rows = misarTechFilter(ctx);
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#666;">لا توجد طلبات مطابقة</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${escapeHTML(r.client_name || '')}</td>
            <td>${escapeHTML(MISAR_TECH_PROJECT_TYPES[r.project_type] || r.project_type || '')}</td>
            <td>${escapeHTML(r.project_title || '')}</td>
            <td><span class="mt-status mt-status-${r.status}">${MISAR_TECH_STATUS_LABELS[r.status] || r.status}</span>
                ${r.admin_notes ? `<i class="fas fa-sticky-note" title="ملاحظات إدارية" style="color:#f57c00;cursor:help;"></i>` : ''}
            </td>
            <td>${r.quoted_price ? escapeHTML(r.quoted_price) : '—'}</td>
            <td>${r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : ''}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="openMisarTechDetails('${r.id}', '${ctx}')">التفاصيل</button>
                ${ctx === 'founder' && typeof misarIsFounder === 'function' && misarIsFounder()
                    ? `<button class="remove-btn btn-sm" onclick="deleteMisarTechRequest('${r.id}')" aria-label="حذف طلب ${escapeHTML(r.project_title || '')}"><i class="fas fa-trash-alt"></i> حذف</button>`
                    : ''}
            </td>
        </tr>`).join('');
}

async function deleteMisarTechRequest(id) {
    if (typeof misarIsFounder !== 'function' || !misarIsFounder()) {
        showToast('حذف طلبات MISAR TECH متاح للمؤسس فقط', 'error');
        return;
    }
    const request = misarTechCache.find(item => String(item.id) === String(id));
    if (!request) {
        showToast('الطلب غير موجود أو تم حذفه بالفعل', 'error');
        return;
    }
    if (!confirm(`سيتم حذف طلب «${request.project_title || 'بدون عنوان'}» نهائياً مع تفاصيله. هل تريد المتابعة؟`)) return;

    showLoading(true);
    try {
        const { data, error } = await supabaseClient
            .from('misar_tech_requests')
            .delete()
            .eq('id', id)
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('لم يتم حذف الطلب. تحقق من صلاحية الحذف في قاعدة البيانات.');

        misarTechCache = misarTechCache.filter(item => String(item.id) !== String(id));
        renderMisarTechAdminTable('founder');
        showToast('تم حذف طلب المشروع نهائياً', 'success');
    } catch (err) {
        console.error('فشل حذف طلب MISAR TECH:', err);
        showToast('فشل حذف الطلب: ' + (err.message || 'خطأ غير معروف'), 'error');
    } finally {
        showLoading(false);
    }
}

// تفاصيل الطلب + تحديث الحالة/السعر/الملاحظات
function openMisarTechDetails(id, ctx = 'founder') {
    const r = misarTechCache.find(x => x.id === id);
    if (!r) { showToast('الطلب غير موجود', 'error'); return; }
    // المدير العام يعدّل فقط إذا كانت لديه صلاحية misar_tech.edit
    const canEdit = ctx === 'founder' ? true : (typeof misarGmCan === 'function' ? misarGmCan('misar_tech', 'edit') : false);
    const statusOpts = Object.entries(MISAR_TECH_STATUS_LABELS).map(([k, lbl]) =>
        `<option value="${k}" ${r.status === k ? 'selected' : ''}>${lbl}</option>`).join('');
    const modalHtml = `
    <div class="modal active" id="mtDetailsModal" onclick="if(event.target===this) closeMisarTechDetails()">
        <div class="modal-content" style="max-width:560px; width:94%; max-height:88vh; overflow-y:auto;">
            <h3 style="color:#1a237e; margin-bottom:12px;"><i class="fas fa-file-alt"></i> طلب: ${escapeHTML(r.project_title)}</h3>
            <table class="founder-table" style="margin-bottom:14px;">
                <tr><th>العميل</th><td>${escapeHTML(r.client_name)}</td></tr>
                <tr><th>وسيلة التواصل</th><td>${escapeHTML(r.client_contact)}</td></tr>
                <tr><th>نوع المشروع</th><td>${escapeHTML(MISAR_TECH_PROJECT_TYPES[r.project_type] || r.project_type || '')}</td></tr>
                <tr><th>العنوان</th><td>${escapeHTML(r.project_title)}</td></tr>
                <tr><th>الوصف</th><td style="white-space:pre-wrap;">${escapeHTML(r.project_brief)}</td></tr>
                <tr><th>الميزانية</th><td>${r.budget ? escapeHTML(r.budget) : '—'}</td></tr>
                <tr><th>الموعد المتوقع</th><td>${r.deadline ? escapeHTML(r.deadline) : '—'}</td></tr>
                <tr><th>ملاحظات العميل</th><td style="white-space:pre-wrap;">${r.notes ? escapeHTML(r.notes) : '—'}</td></tr>
                <tr><th>تاريخ الطلب</th><td>${r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : ''}</td></tr>
                <tr><th>آخر تحديث</th><td>${r.updated_at ? new Date(r.updated_at).toLocaleString('ar-EG') : ''}</td></tr>
            </table>
            ${canEdit ? `
            <div class="form-group">
                <label>حالة الطلب</label>
                <select id="mtDetStatus">${statusOpts}</select>
            </div>
            <div class="form-group">
                <label>السعر المقترح / المدة المتوقعة</label>
                <input type="text" id="mtDetPrice" value="${escapeHTML(r.quoted_price || '')}" maxlength="100" placeholder="مثال: 8000 ج.م — مدة 6 أسابيع">
            </div>
            <div class="form-group">
                <label>ملاحظات إدارية</label>
                <textarea id="mtDetNotes" rows="3" maxlength="1000">${escapeHTML(r.admin_notes || '')}</textarea>
            </div>
            <button class="btn btn-primary" style="width:100%;" onclick="saveMisarTechAdmin('${r.id}', '${ctx}')">
                <i class="fas fa-save"></i> حفظ التحديثات
                ${ctx === 'gm' ? ' <small style="opacity:.7;">(بصلاحية المدير العام)</small>' : ''}
            </button>` : `
            <p style="text-align:center; color:#777; padding:8px;">لديك صلاحية عرض فقط — التعديل يتم من إعدادات صلاحيات المدير العام (يُمنح من المؤسس).</p>`}
        </div>
    </div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = modalHtml;
    document.body.appendChild(wrap.firstElementChild);
}

function closeMisarTechDetails() {
    const m = document.getElementById('mtDetailsModal');
    if (m) m.remove();
}

async function saveMisarTechAdmin(id, ctx) {
    const status = document.getElementById('mtDetStatus').value;
    const price = document.getElementById('mtDetPrice').value.trim();
    const notes = document.getElementById('mtDetNotes').value.trim();
    try {
        const patch = {
            status,
            quoted_price: price || null,
            admin_notes: notes || null,
            updated_by: appState.user ? appState.user.id : null
        };
        const { error } = await supabaseClient.from('misar_tech_requests').update(patch).eq('id', id);
        if (error) throw error;
        // سجل النشاط (إن وُجد)
        if (typeof logActivity === 'function' && appState.user) {
            await logActivity(appState.user.id, 'misar_tech_request_updated', {
                section: 'misar_tech', request_id: id, status, price: price || null, context: ctx
            });
        }
        closeMisarTechDetails();
        showToast('تم تحديث الطلب', 'success');
        await loadMisarTechRequests();
    } catch (err) {
        showToast('فشل تحديث الطلب: ' + (err.message || ''), 'error');
    }
}

// ---------- تصدير للنطاق العام ----------
window.renderMisarTechServices = renderMisarTechServices;
window.openMisarTechForm = openMisarTechForm;
window.closeMisarTechForm = closeMisarTechForm;
window.submitMisarTechRequest = submitMisarTechRequest;
window.loadMisarTechRequests = loadMisarTechRequests;
window.renderMisarTechAdminTable = renderMisarTechAdminTable;
window.deleteMisarTechRequest = deleteMisarTechRequest;
window.openMisarTechDetails = openMisarTechDetails;
window.closeMisarTechDetails = closeMisarTechDetails;
window.saveMisarTechAdmin = saveMisarTechAdmin;
window.goBackFromMisarTech = goBackFromMisarTech;
