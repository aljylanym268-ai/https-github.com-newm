// ============================================================
// إدارة المواقع (المحافظات والمراكز) - للمؤسس فقط
// المؤسس يقدر: يحذف نهائياً / يسترجع / يضيف محافظة أو مركز / استرجاع الأصل
// التخزين: app_settings (deleted_governorates / deleted_centers / extra_centers)
//  - deleted_governorates: محافظات محذوفة نهائياً (مش بتظهر في أي قائمة)
//  - deleted_centers: { 'قنا': ['نقادة'] } مراكز محذوفة نهائياً
//  - extra_centers: { 'قنا': ['مركز جديد'] } مراكز/محافظات مضافة من المؤسس
// ============================================================

let _locAdminSettings = null;

function _allBaseGovs() {
    return Object.keys(MISAR_GOV_CENTERS);
}

async function initFounderLocationsAdmin() {
    if (!appState.user || appState.userData?.account_type !== 'founder') {
        showToast('غير مصرح لك. يجب أن تكون مؤسساً.', 'error');
        return;
    }
    const s = await getLocationSettings();
    _locAdminSettings = {
        deletedGovernorates: [...(s.deletedGovernorates || [])],
        deletedCenters: JSON.parse(JSON.stringify(s.deletedCenters || {})),
        extraCenters: JSON.parse(JSON.stringify(s.extraCenters || {}))
    };
    _renderLocAdminGovSelect();
}

// قائمة المحافظات اللي تظهر في قائمة التحكم (المحذوفة تظهر بعلامة عشان تسترجعها)
function _renderLocAdminGovSelect() {
    const govSelect = document.getElementById('locAdminGovSelect');
    if (!govSelect || !_locAdminSettings) return;
    const base = _allBaseGovs();
    const extraGovs = Object.keys(_locAdminSettings.extraCenters).filter(g => !MISAR_GOV_CENTERS[g]);
    const all = base.concat(extraGovs);
    const deleted = _locAdminSettings.deletedGovernorates;
    const active = all.filter(g => !deleted.includes(g));
    const removed = all.filter(g => deleted.includes(g));
    const currentVal = govSelect.value;
    govSelect.innerHTML =
        active.map(g => `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`).join('') +
        removed.map(g => `<option value="${escapeHTML(g)}">${escapeHTML(g)} (محذوفة)</option>`).join('');
    if (currentVal && all.includes(currentVal)) govSelect.value = currentVal;
    renderLocAdminCentersList();
}
window.renderLocAdminGovSelect = _renderLocAdminGovSelect;
// alias قديم (onchange في HTML)
window.renderLocAdminCenters = function () { renderLocAdminCentersList(); };

window.renderLocAdminCentersList = function () {
    const govSelect = document.getElementById('locAdminGovSelect');
    const listEl = document.getElementById('locAdminCentersList');
    const toggleLabel = document.getElementById('locAdminGovToggleLabel');
    if (!govSelect || !listEl || !_locAdminSettings) return;
    const gov = govSelect.value;
    if (!gov) { listEl.innerHTML = ''; return; }

    const isDeleted = _locAdminSettings.deletedGovernorates.includes(gov);
    if (toggleLabel) toggleLabel.textContent = isDeleted ? 'المحافظة محذوفة' : 'المحافظة مفعّلة ✓';
    const delBtnSpan = document.getElementById('locAdminDeleteGovBtn');
    if (delBtnSpan) delBtnSpan.innerHTML = isDeleted ? 'استرجاع المحافظة' : 'حذف المحافظة نهائياً';

    const base = MISAR_GOV_CENTERS[gov] || [];
    const extra = (_locAdminSettings.extraCenters[gov] || []).filter(c => !base.includes(c));
    const allCenters = base.concat(extra);
    const deletedCenters = _locAdminSettings.deletedCenters[gov] || [];

    if (isDeleted) {
        listEl.innerHTML = `<p style="color:#c62828; grid-column:1/-1;">⚠️ المحافظة "<b>${escapeHTML(gov)}</b>" محذوفة نهائياً — مش بتظهر للمستخدمين في أي مكان. اضغط "استرجاع المحافظة" لو عايزها ترجع.</p>`;
        return;
    }

    listEl.innerHTML = allCenters.map(c => {
        const isDel = deletedCenters.includes(c);
        return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; padding:8px 10px; background:${isDel ? '#ffebee' : '#e8f5e9'}; border-radius:10px; border:1px solid ${isDel ? '#ef9a9a' : '#a5d6a7'};">
            <span style="font-size:0.9rem; ${isDel ? 'text-decoration:line-through; color:#999;' : ''}">${escapeHTML(c)}${isDel ? ' 🚫' : ''}</span>
            <button class="${isDel ? 'founder-btn' : 'remove-btn'}" style="width:auto; padding:4px 10px; font-size:0.75rem;"
                onclick="deleteLocAdminCenter('${escapeHTML(c)}', ${isDel})">${isDel ? 'استرجاع' : 'حذف'}</button>
        </div>`;
    }).join('');
};

// حذف/استرجاع محافظة نهائياً (زرار واحد بيبدّل بين الحالتين)
window.deleteLocAdminGov = function () {
    const govSelect = document.getElementById('locAdminGovSelect');
    if (!govSelect || !_locAdminSettings) return;
    const gov = govSelect.value;
    if (!gov) return;
    const idx = _locAdminSettings.deletedGovernorates.indexOf(gov);
    if (idx === -1) {
        if (!confirm(`هل أنت متأكد من حذف محافظة "${gov}" نهائياً؟ مش هتظهر للمستخدمين في أي مكان (اختر موقعك، التسجيل، الطلب).`)) return;
        _locAdminSettings.deletedGovernorates.push(gov);
    } else {
        _locAdminSettings.deletedGovernorates.splice(idx, 1);
    }
    _renderLocAdminGovSelect();
};

// حذف/استرجاع مركز نهائياً (isDel=true معناها المركز محذوف وعايزين نسترجعه)
window.deleteLocAdminCenter = function (center, isDel) {
    const govSelect = document.getElementById('locAdminGovSelect');
    if (!govSelect || !_locAdminSettings) return;
    const gov = govSelect.value;
    if (!gov) return;
    const deleted = _locAdminSettings.deletedCenters[gov] || [];
    if (isDel) {
        _locAdminSettings.deletedCenters[gov] = deleted.filter(c => c !== center);
    } else {
        if (!confirm(`حذف مركز "${center}" نهائياً من محافظة "${gov}"؟`)) return;
        _locAdminSettings.deletedCenters[gov] = [...deleted, center];
    }
    renderLocAdminCentersList();
};

// إضافة محافظة جديدة تماماً (مش موجودة في القائمة الأساسية)
window.addLocAdminGov = function () {
    const input = document.getElementById('locAdminNewGov');
    if (!input || !_locAdminSettings) return;
    const name = input.value.trim();
    if (!name) { showToast('اكتب اسم المحافظة الجديدة', 'error'); return; }
    // لو المحافظة موجودة في القائمة الأساسية لكن محذوفة → استرجعها بدل ما ترفض
    if (MISAR_GOV_CENTERS[name]) {
        if (_locAdminSettings.deletedGovernorates.includes(name)) {
            _locAdminSettings.deletedGovernorates = _locAdminSettings.deletedGovernorates.filter(g => g !== name);
            input.value = '';
            _renderLocAdminGovSelect();
            const govSelect = document.getElementById('locAdminGovSelect');
            if (govSelect) govSelect.value = name;
            renderLocAdminCentersList();
            showToast(`المحافظة "${name}" كانت محذوفة — تم استرجاعها ✓ (اضغط حفظ التغييرات)`, 'success');
            return;
        }
        showToast('المحافظة موجودة أصلاً وفعّالة', 'error');
        return;
    }
    if (_locAdminSettings.extraCenters[name]) { showToast('المحافظة مضافة بالفعل', 'error'); return; }
    _locAdminSettings.extraCenters[name] = [];
    _locAdminSettings.deletedGovernorates = _locAdminSettings.deletedGovernorates.filter(g => g !== name);
    input.value = '';
    _renderLocAdminGovSelect();
    const govSelect = document.getElementById('locAdminGovSelect');
    if (govSelect) govSelect.value = name;
    renderLocAdminCentersList();
    showToast(`تمت إضافة محافظة "${name}" — ضيف مراكزها واضغط "حفظ التغييرات"`, 'success');
};

// إضافة مركز جديد داخل محافظة
window.addLocAdminCenter = function () {
    const govSelect = document.getElementById('locAdminGovSelect');
    const input = document.getElementById('locAdminNewCenter');
    if (!govSelect || !input || !_locAdminSettings) return;
    const gov = govSelect.value;
    const name = input.value.trim();
    if (!gov) { showToast('اختر محافظة أولاً', 'error'); return; }
    if (!name) { showToast('اكتب اسم المركز الجديد', 'error'); return; }
    if (_locAdminSettings.deletedGovernorates.includes(gov)) { showToast('المحافظة محذوفة — استرجعها أولاً', 'error'); return; }
    const base = MISAR_GOV_CENTERS[gov] || [];
    const extra = _locAdminSettings.extraCenters[gov] || [];
    if (base.includes(name) || extra.includes(name)) {
        showToast('المركز موجود بالفعل', 'error');
        return;
    }
    _locAdminSettings.extraCenters[gov] = [...extra, name];
    _locAdminSettings.deletedCenters[gov] = (_locAdminSettings.deletedCenters[gov] || []).filter(c => c !== name);
    input.value = '';
    renderLocAdminCentersList();
    showToast(`تمت إضافة "${name}" (اضغط حفظ التغييرات لتثبيتها)`, 'success');
};

// استرجاع كل حاجة للأصل (مسح كل التعديلات)
window.restoreLocAdminDefaults = function () {
    if (!confirm('هل تريد إرجاع كل المحافظات والمراكز للقائمة الأصلية؟ كل تعديلاتك هتتشال.')) return;
    _locAdminSettings = { deletedGovernorates: [], deletedCenters: {}, extraCenters: {} };
    _renderLocAdminGovSelect();
    showToast('تم الرجوع للأصل — اضغط "حفظ التغييرات" لتثبيت ذلك', 'success');
};

window.saveLocAdminSettings = async function () {
    if (!appState.user || appState.userData?.account_type !== 'founder') {
        showToast('غير مصرح لك.', 'error');
        return;
    }
    showLoading(true);
    try {
        await saveLocationSettings(_locAdminSettings);
        showToast('✅ تم حفظ إعدادات المواقع وطبقت على كل المستخدمين', 'success');
    } catch (e) {
        console.error('Error saving location settings:', e);
        showToast('فشل الحفظ: ' + (e.message || e), 'error');
    } finally {
        showLoading(false);
    }
};
