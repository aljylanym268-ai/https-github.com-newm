// ============================================================
// الإعدادات العامة وإرسال الإشعارات الجماعية
// ============================================================

// ====== دوال الإشعارات الجماعية ======
window.sendBulkNotification = async function() {
    const title = document.getElementById('notificationTitle').value.trim();
    const message = document.getElementById('notificationMessage').value.trim();
    const recipientType = document.getElementById('notificationRecipients').value;
    const specificEmail = document.getElementById('specificUserEmail').value.trim();

    if (!title || !message) { showToast('يرجى إدخال العنوان والرسالة', 'warning'); return; }
    if (recipientType === 'specific' && !specificEmail) { showToast('يرجى إدخال البريد الإلكتروني للمستخدم', 'warning'); return; }

    showLoading(true);
    try {
        const count = await sendBulkNotification(recipientType, title, message, specificEmail);
        showToast(`تم إرسال الإشعار إلى ${count} مستخدم`, 'success');
        document.getElementById('notificationTitle').value = '';
        document.getElementById('notificationMessage').value = '';
        document.getElementById('specificUserEmail').value = '';
    } catch (err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
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
    } finally { showLoading(false); }
}; 
// ============================================================
// دالة ترقيم الصفحات (مشتركة)
// ============================================================
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
window.renderPagination = renderPagination;