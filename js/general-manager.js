// ============================================================
// MISAR SYSTEMS — نظام General Manager (المدير العام)
// ------------------------------------------------------------
// المصدر الوحيد للثقة: user_data.account_type
//   founder  → أعلى صلاحية (ثابت في الكود فقط كقراءة)
//   general_manager → مدير عام تحت المؤسس
//
// الصلاحيات تُقرأ من app_settings (general_manager_permissions)
// والتحقق النهائي يحدث في قاعدة البيانات (RLS) — الواجهة للعرض فقط.
// ============================================================

// ============================================================
// 1) الأقسام والصلاحيات (نفس المفاتيح المستخدمة في RLS)
// ============================================================
const MISAR_GM_SECTIONS = [
    { key: 'dashboard', label: 'نظرة عامة', icon: 'fas fa-chart-pie', actions: ['view'] },
    { key: 'orders', label: 'الطلبات', icon: 'fas fa-shopping-cart', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'misar_tech', label: 'طلبات MISAR TECH', icon: 'fas fa-code', actions: ['view', 'edit'] },
    { key: 'founder_notes', label: 'ملاحظات المؤسس', icon: 'fas fa-sticky-note', actions: ['view'] },
    { key: 'products', label: 'المنتجات', icon: 'fas fa-boxes', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'services', label: 'الخدمات', icon: 'fas fa-concierge-bell', actions: ['view', 'create', 'edit', 'delete'] },
    { key: 'users', label: 'المستخدمون', icon: 'fas fa-users', actions: ['view', 'edit'] },
    { key: 'sellers', label: 'البائعون', icon: 'fas fa-store', actions: ['view', 'edit'] },
    { key: 'delivery', label: 'المندوبون', icon: 'fas fa-truck', actions: ['view', 'edit'] },
    { key: 'returns', label: 'المرتجعات', icon: 'fas fa-undo-alt', actions: ['view', 'edit'] },
    { key: 'ads', label: 'الإعلانات', icon: 'fas fa-bullhorn', actions: ['view', 'edit'] },
    { key: 'banners', label: 'البنرات', icon: 'fas fa-image', actions: ['view', 'edit'] },
    { key: 'locations', label: 'المواقع', icon: 'fas fa-map-marked-alt', actions: ['view', 'edit'] },
    { key: 'reports', label: 'الإحصائيات والتقارير', icon: 'fas fa-chart-bar', actions: ['view'] },
    { key: 'activity_logs', label: 'سجل النشاط', icon: 'fas fa-history', actions: ['view'] },
    { key: 'settings', label: 'الإعدادات', icon: 'fas fa-cog', actions: ['view', 'edit'] }
];

const MISAR_GM_ACTION_LABELS = { view: 'عرض', create: 'إنشاء', edit: 'تعديل', delete: 'حذف' };

// صلاحيات افتراضية (مطابقة للـ SQL) — تُستخدم إن تعذّر القراءة
const MISAR_GM_DEFAULT_PERMS = {
    dashboard: { view: true },
    orders: { view: true, create: false, edit: false, delete: false },
    founder_notes: { view: true },
    misar_tech: { view: true, edit: false },
    products: { view: true, create: false, edit: false, delete: false },
    services: { view: true, create: false, edit: false, delete: false },
    users: { view: true, edit: false },
    sellers: { view: true, edit: false },
    delivery: { view: true, edit: false },
    returns: { view: true, edit: false },
    ads: { view: true, edit: false },
    banners: { view: false, edit: false },
    locations: { view: false, edit: false },
    reports: { view: true, edit: false },
    activity_logs: { view: false },
    settings: { view: false, edit: false }
};

// ============================================================
// أنواع المدراء (قابلة للتوسعة — المؤسس يسمّيهم كما يشاء)
// ============================================================
const MISAR_GM_ROLE_TYPES = [
    { key: 'general_manager', label: 'مدير عام' },
    { key: 'supervisor',      label: 'مشرف' },
    { key: 'administrator',   label: 'إداري' },
    { key: 'auditor',         label: 'مراجع' }
];

// الحالة العامة لنظام المدير العام
window.misarGmState = {
    permissions: null,          // كائن الصلاحيات المشترك (توافق خلفي)
    byUser: {},                 // { uuid: { label, role, perms } } — صلاحيات كل مدير
    suspended: [],              // مصفوفة UUID المدراء الموقوفين
    isGeneralManager: false,
    isFounder: false,
    gmList: [],                 // قائمة المدراء العامين (للمؤسس)
    currentGmId: null           // المدير الجاري تعديله في لوحة المؤسس
};

// الصلاحيات الفعّالة للمدير الحالي: تخصيصه الشخصي أولاً، ثم الافتراضي
function misarGmEffectivePerms(userId) {
    const uid = userId || (appState.user && appState.user.id);
    const byUser = window.misarGmState.byUser || {};
    if (uid && byUser[uid] && byUser[uid].perms) {
        return { ...MISAR_GM_DEFAULT_PERMS, ...byUser[uid].perms };
    }
    return window.misarGmState.permissions || MISAR_GM_DEFAULT_PERMS;
}

// بيانات التسمية/الدور لمدير معيّن
function misarGmProfile(userId) {
    const byUser = window.misarGmState.byUser || {};
    const entry = byUser[userId] || {};
    return {
        label: entry.label || '',
        role: entry.role || 'general_manager'
    };
}

// ============================================================
// طبقة توجيه العناصر (Prefix Routing) — مفتاح إصلاح عرض بيانات GM
// ------------------------------------------------------------
// لوحة المؤسس ولوحة المدير العام كانتا تتشاركان نفس معرّفات HTML،
// فكان document.getElementById يرجّع عنصر لوحة المؤسس المخفي دائمًا
// (لأنه الأسبق في المستند)، فتظهر بيانات GM فارغة.
// الحل: عناصر لوحة GM صارت بادئة gm-، وهذه الطبقة تعيد توجيه
// كل دالة عرض/فلترة للعنصر الصحيح حسب اللوحة النشطة.
// ============================================================

// هل نحن حاليًا داخل لوحة المدير العام؟
// ملاحظة مهمة: نستخدم querySelector فقط — ولا نستدعي getElementById هنا إطلاقًا
// حتى لا يحدث استدعاء دائري (recursion) عند ترقيع getElementById.
function misarIsGmContext() {
    // 1) الشاشة نفسها نشطة؟
    const gmScreen = document.querySelector('#generalManagerDashboardScreen.active');
    if (gmScreen) return true;
    // 2) أو يوجد تبويب GM نشط ظاهر؟
    return !!document.querySelector('.gm-tab-panel.active');
}

// إرجاع البادئة المناسبة ('gm-' للمدير العام، '' للمؤسس)
function misarViewPrefix() {
    return misarIsGmContext() ? 'gm-' : '';
}

// جلب عنصر بالمعرّف المناسب للسياق الحالي (يجرّب gm- أولًا داخل لوحة GM)
function misarViewEl(baseId) {
    const raw = document.getElementById.bind(document);
    if (misarIsGmContext()) {
        const gmEl = raw('gm-' + baseId);
        if (gmEl) return gmEl;
    }
    return raw(baseId);
}

// معرّفات إخراج الدوال المشتركة (tbody/pagination) التي تُعاد توجيهها في سياق GM
const MISAR_GM_ROUTE_IDS = [
    'productsTableBody', 'productsPagination',
    'customersTableBody', 'customersPagination',
    'sellersTableBody', 'sellersPagination',
    'deliveriesTableBody', 'deliveriesPagination',
    'ordersTableBody', 'ordersPagination',
    'servicesTableBody',
    'bannersTableBody', 'bannersTableBody2'
];

// ============================================================
// توجيه العناصر — بديل آمن تمامًا بلا ترقيع getElementById
// ------------------------------------------------------------
// استبدلنا الترقيع الذي كان يسبب استدعاءً دائريًا (stack overflow)
// بحل صريح: دوال العرض المشتركة تستدعي misarGmRenderTarget()
// لتحديد العنصر الصحيح. لا يتغير سلوك لوحة المؤسس إطلاقًا.
// ============================================================
function misarApplyGmIdRouting() {
    // لم نعد نرقّع أي دالة أصلية — هذا حاجز أمان فقط.
    // التوجيه يحدث داخل دوال العرض عبر misarGmRenderTarget().
    window.__misarGmIdPatch = false;
}

// إرجاع العنصر الصحيح لكتابة مخرجات دالة مشتركة (tbody/pagination)
function misarGmRenderTarget(baseId) {
    if (misarIsGmContext()) {
        const gmEl = document.getElementById('gm-' + baseId);
        if (gmEl) return gmEl;
    }
    return document.getElementById(baseId);
}

// ============================================================
// دوال فلترة مخصصة للمدير العام (تستخدم محددات #gm-tab- الصحيحة)
// ============================================================
window.misarGmFilterProducts = function () {
    if (typeof productsAdminFilter === 'undefined') return;
    const input = document.getElementById('gm-productSearchInput');
    productsAdminFilter.query = input ? input.value.trim() : '';
    if (typeof loadProductsTableAdmin === 'function') loadProductsTableAdmin();
};

window.misarGmFilterProductsByStatus = function (status) {
    if (typeof productsAdminFilter === 'undefined') return;
    productsAdminFilter.status = status;
    document.querySelectorAll('#gm-tab-products .filter-btn').forEach(b => b.classList.remove('active'));
    const btns = document.querySelectorAll('#gm-tab-products .filter-btn');
    const index = ['all', 'published', 'hidden', 'review'].indexOf(status);
    if (btns[index]) btns[index].classList.add('active');
    if (typeof loadProductsTableAdmin === 'function') loadProductsTableAdmin();
};

window.misarGmFilterOrders = function () {
    if (typeof ordersAdminFilter === 'undefined') return;
    const input = document.getElementById('gm-orderSearchInput');
    ordersAdminFilter.query = input ? input.value.trim() : '';
    if (typeof loadOrdersTableAdmin === 'function') loadOrdersTableAdmin();
};

window.misarGmFilterCustomers = function () {
    if (typeof customersFilter === 'undefined') return;
    const input = document.getElementById('gm-customerSearchInput');
    customersFilter.query = input ? input.value.trim() : '';
    if (typeof loadCustomersTable === 'function') loadCustomersTable();
};

window.misarGmFilterSellers = function () {
    if (typeof sellersFilter === 'undefined') return;
    const input = document.getElementById('gm-sellerSearchInput');
    sellersFilter.query = input ? input.value.trim() : '';
    if (typeof loadSellersTable === 'function') loadSellersTable();
};

window.misarGmFilterDeliveries = function () {
    if (typeof deliveriesFilter === 'undefined') return;
    const input = document.getElementById('gm-deliverySearchInput');
    deliveriesFilter.query = input ? input.value.trim() : '';
    if (typeof loadDeliveriesTable === 'function') loadDeliveriesTable();
};

window.misarGmFilterServices = function () {
    if (typeof servicesAdminFilter === 'undefined') return;
    const input = document.getElementById('gm-serviceSearchInput');
    servicesAdminFilter.query = input ? input.value.trim() : '';
    if (typeof loadServicesTableAdmin === 'function') loadServicesTableAdmin();
};

// ============================================================
// 2) دوال تحديد الدور (قراءة فقط من user_data — لا كتابة أبداً)
// ============================================================
function misarIsFounder() {
    return !!(appState.user && appState.userData && appState.userData.account_type === 'founder');
}

function misarIsGeneralManager() {
    if (!appState.user || !appState.userData) return false;
    if (appState.userData.account_type !== 'general_manager') return false;
    // الإيقاف الفوري (قراءة محلية للعرض؛ الـ RLS هي الحارس الحقيقي)
    const suspended = window.misarGmState.suspended || [];
    if (suspended.includes(appState.user.id)) return false;
    if (appState.userData.status && appState.userData.status !== 'approved') return false;
    return true;
}

// هل يملك المدير العام صلاحية قسم + إجراء؟ (للعرض فقط — الحماية في RLS)
function misarGmCan(section, action = 'view') {
    if (misarIsFounder()) return true; // المؤسس يملك كل شيء
    if (!misarIsGeneralManager()) return false;
    // الصلاحيات الشخصية للمدير الحالي إن وُجدت، وإلا الافتراضية العامة
    const perms = misarGmEffectivePerms();
    if (!perms || !perms[section]) return false;
    return perms[section][action] === true;
}

// ============================================================
// 3) تحميل إعدادات المدير العام من app_settings
// ============================================================
async function misarLoadGmSettings() {
    const defaults = {
        permissions: { ...MISAR_GM_DEFAULT_PERMS },
        suspended: [],
        byUser: {}
    };
    try {
        const { data, error } = await supabaseClient
            .from('app_settings')
            .select('setting_key, setting_value')
            .in('setting_key', [
                'general_manager_permissions',
                'general_manager_suspended',
                'general_manager_byuser'
            ]);
        if (error) throw error;

        const map = {};
        (data || []).forEach(s => { map[s.setting_key] = s.setting_value; });

        // الصلاحيات العامة الافتراضية
        let perms = { ...MISAR_GM_DEFAULT_PERMS };
        if (map.general_manager_permissions) {
            try {
                const parsed = typeof map.general_manager_permissions === 'string'
                    ? JSON.parse(map.general_manager_permissions)
                    : map.general_manager_permissions;
                if (parsed && typeof parsed === 'object') {
                    // دعم البنية الجديدة { byUser, default } والقديمة المسطّحة
                    if (parsed.default && typeof parsed.default === 'object') {
                        perms = { ...MISAR_GM_DEFAULT_PERMS, ...parsed.default };
                    } else {
                        perms = { ...MISAR_GM_DEFAULT_PERMS, ...parsed };
                    }
                }
            } catch (e) { console.warn('⚠️ صلاحيات المدير العام غير صالحة، استخدام الافتراضي'); }
        }

        // الصلاحيات المخصّصة لكل مدير
        let byUser = {};
        const rawByUser = map.general_manager_byuser;
        const embeddedByUser = (() => {
            try {
                const p = typeof map.general_manager_permissions === 'string'
                    ? JSON.parse(map.general_manager_permissions)
                    : map.general_manager_permissions;
                return (p && p.byUser) || null;
            } catch (e) { return null; }
        })();
        const src = rawByUser || embeddedByUser;
        if (src) {
            try {
                const parsed = typeof src === 'string' ? JSON.parse(src) : src;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) byUser = parsed;
            } catch (e) { console.warn('⚠️ صلاحيات المدراء المخصّصة غير صالحة'); }
        }

        let suspended = [];
        if (map.general_manager_suspended) {
            try {
                const parsed = typeof map.general_manager_suspended === 'string'
                    ? JSON.parse(map.general_manager_suspended)
                    : map.general_manager_suspended;
                if (Array.isArray(parsed)) suspended = parsed;
            } catch (e) { /* تجاهل */ }
        }

        window.misarGmState.permissions = perms;
        window.misarGmState.suspended = suspended;
        window.misarGmState.byUser = byUser;
    } catch (e) {
        // قد يفشل الطلب لزائر غير مسجّل (anon) فيمنع RLS قراءة المفاتيح
        // الإدارية — وهذا مقصود أمنياً، لذا نكتفي بالافتراضي بلا ضجيج.
        const code = e && (e.code || e.status);
        const isAuthIssue = code === '42501' || code === 401 || code === 403
            || /permission denied|jwt|not authorized/i.test(String(e && e.message || ''));
        if (isAuthIssue) {
            console.info('ℹ️ صلاحيات المدير العام غير متاحة في هذه الجلسة — استخدام الافتراضي.');
        } else {
            console.warn('⚠️ تعذر تحميل إعدادات المدير العام، استخدام الافتراضي:', e);
        }
        window.misarGmState.permissions = defaults.permissions;
        window.misarGmState.suspended = defaults.suspended;
        window.misarGmState.byUser = defaults.byUser;
    }
}

// ============================================================
// 4) حفظ إعدادات المدير العام (المؤسس فقط — والـ RLS تفرضها)
// ============================================================
async function misarSaveGmSetting(key, value) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط تسمح بهذا الإجراء.');
    const setting_value = typeof value === 'string' ? value : JSON.stringify(value);
    const { error } = await supabaseClient
        .from('app_settings')
        .upsert({ setting_key: key, setting_value, updated_at: new Date() }, { onConflict: 'setting_key' });
    if (error) throw error;
    if (key === 'general_manager_permissions'
        || key === 'general_manager_suspended'
        || key === 'general_manager_byuser') {
        window.misarGmState.permissions = null; // إبطال الكاش لإعادة القراءة
        await misarLoadGmSettings();
    }
}

// ============================================================
// حفظ صلاحيات مدير معيّن (تخصيص فردي)
// البنية المحفوظة:
//   general_manager_permissions = { "default": {...}, "byUser": { uuid: {...} } }
// ============================================================
async function misarSaveGmByUser() {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const payload = {
        default: window.misarGmState.permissions || MISAR_GM_DEFAULT_PERMS,
        byUser: window.misarGmState.byUser || {}
    };
    const setting_value = JSON.stringify(payload);
    const { error } = await supabaseClient
        .from('app_settings')
        .upsert({ setting_key: 'general_manager_permissions', setting_value, updated_at: new Date() },
                { onConflict: 'setting_key' });
    if (error) throw error;
    window.misarGmState.permissions = null;
    await misarLoadGmSettings();
}

// تعيين تسمية ودور و صلاحيات لمستخدم معيّن (المؤسس فقط)
async function misarSetGmProfileFor(userId, { label, role, perms } = {}) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const byUser = JSON.parse(JSON.stringify(window.misarGmState.byUser || {}));
    const cur = byUser[userId] || {};
    if (label !== undefined) cur.label = String(label || '').trim().slice(0, 40);
    if (role !== undefined) cur.role = role;
    if (perms !== undefined) cur.perms = perms;
    byUser[userId] = cur;
    window.misarGmState.byUser = byUser;
    await misarSaveGmByUser();
    await logActivity(appState.user.id, 'gm_profile_saved', {
        section: 'general_manager', target_user: userId,
        label: cur.label || '', role: cur.role || '', result: 'success'
    });
}

// تحديث صلاحية واحدة لمدير معيّن (تعديل فردي)
async function misarSetGmPermissionFor(userId, section, action, allowed) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const base = JSON.parse(JSON.stringify(misarGmEffectivePerms(userId)));
    if (!base[section]) base[section] = {};
    base[section][action] = !!allowed;
    await misarSetGmProfileFor(userId, { perms: base });
}

// تطبيق قالب صلاحيات جاهز على مدير
function misarGmTemplatePerms(kind) {
    const all = MISAR_GM_DEFAULT_PERMS;
    const full = {};
    MISAR_GM_SECTIONS.forEach(s => {
        full[s.key] = {};
        s.actions.forEach(a => { full[s.key][a] = true; });
    });
    const viewOnly = {};
    MISAR_GM_SECTIONS.forEach(s => {
        viewOnly[s.key] = {};
        s.actions.forEach(a => { viewOnly[s.key][a] = (a === 'view'); });
    });
    if (kind === 'full') return full;
    if (kind === 'view') return viewOnly;
    return JSON.parse(JSON.stringify(all));
}

// ============================================================
// 5) تحميل قائمة المدراء العامين (للوحة المؤسس)
// ============================================================
async function misarLoadGmList() {
    try {
        const { data, error } = await supabaseClient
            .from('user_data')
            .select('id, name, email, phone, account_type, status, image_url, created_at')
            .eq('account_type', 'general_manager')
            .order('created_at', { ascending: false });
        if (error) throw error;
        window.misarGmState.gmList = data || [];
        return data || [];
    } catch (e) {
        console.warn('تعذر تحميل قائمة المدراء العامين:', e);
        window.misarGmState.gmList = [];
        return [];
    }
}

// إرجاع الصف من القائمة المحلية بمعرّفه
function misarGmById(userId) {
    return (window.misarGmState.gmList || []).find(g => g.id === userId) || null;
}

// ============================================================
// 6) عمليات المؤسس على المدير العام
// ============================================================

// تعيين مستخدم موجود كمدير عام (المؤسس فقط)
async function misarPromoteToGeneralManager(userId) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    if (!userId) throw new Error('معرّف المستخدم مفقود.');

    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ account_type: 'general_manager', status: 'approved', updated_at: new Date() })
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('فشل التعيين — تأكد من صلاحيات المؤسس على user_data (RLS).');

    await logActivity(appState.user.id, 'gm_appointed', {
        section: 'general_manager', target_user: userId, result: 'success'
    });
    return data;
}

// تغيير دور المدير العام إلى دور آخر (المؤسس فقط)
async function misarChangeGmRole(userId, newRole) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const allowed = ['client', 'seller', 'delivery'];
    if (!allowed.includes(newRole)) throw new Error('الدور الجديد غير مسموح.');

    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ account_type: newRole, updated_at: new Date() })
        .eq('id', userId)
        .eq('account_type', 'general_manager')   // لا يغيّر إلا مدراء فعليين
        .select()
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('فشل تغيير الدور.');

    await logActivity(appState.user.id, 'gm_role_changed', {
        section: 'general_manager', target_user: userId, new_role: newRole, result: 'success'
    });
    return data;
}

// إلغاء تعيين المدير العام (يرجع عميل)
async function misarRevokeGeneralManager(userId) {
    return misarChangeGmRole(userId, 'client');
}

// إيقاف / إعادة تفعيل المدير العام
async function misarSuspendGm(userId) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const suspended = Array.from(new Set([...(window.misarGmState.suspended || []), userId]));
    await misarSaveGmSetting('general_manager_suspended', suspended);
    await logActivity(appState.user.id, 'gm_suspended', {
        section: 'general_manager', target_user: userId, result: 'success'
    });
}

async function misarReactivateGm(userId) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const suspended = (window.misarGmState.suspended || []).filter(id => id !== userId);
    await misarSaveGmSetting('general_manager_suspended', suspended);
    await logActivity(appState.user.id, 'gm_reactivated', {
        section: 'general_manager', target_user: userId, result: 'success'
    });
}

// تحديث صلاحية واحدة (قسم + إجراء)
async function misarSetGmPermission(section, action, allowed) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    const perms = JSON.parse(JSON.stringify(window.misarGmState.permissions || MISAR_GM_DEFAULT_PERMS));
    if (!perms[section]) perms[section] = {};
    perms[section][action] = !!allowed;
    await misarSaveGmSetting('general_manager_permissions', perms);
    await logActivity(appState.user.id, 'gm_permission_changed', {
        section: 'general_manager', permission: section + '.' + action,
        value: !!allowed, result: 'success'
    });
}

// حفظ كل الصلاحيات دفعة واحدة
async function misarSaveGmPermissions(perms) {
    if (!misarIsFounder()) throw new Error('صلاحية المؤسس فقط.');
    await misarSaveGmSetting('general_manager_permissions', perms);
    await logActivity(appState.user.id, 'gm_permissions_saved', {
        section: 'general_manager', result: 'success'
    });
}

// ============================================================
// 7) دوال عرض لوحة المؤسس — إدارة المدير العام
// ============================================================
async function misarRenderGmAdminPanel() {
    if (!misarIsFounder()) return;
    await misarLoadGmSettings();
    await misarLoadGmList();
    // لا نعرض الشبكة العامة إلا إذا كان المؤسس قد اختار مديراً بعينه
    misarRenderGmPermissionsGrid();
    misarRenderGmList();
    misarRenderGmRoleOptions();
}

// تعبئة قائمة أنواع الأدوار في نموذج التسمية
function misarRenderGmRoleOptions() {
    const sel = document.getElementById('gmProfileRole');
    if (!sel) return;
    sel.innerHTML = MISAR_GM_ROLE_TYPES
        .map(r => `<option value="${r.key}">${r.label}</option>`).join('');
}

// شبكة الصلاحيات — تعرض صلاحيات المدير المختار إن وُجد، وإلا الافتراضية
function misarRenderGmPermissionsGrid() {
    const container = document.getElementById('gmPermissionsGrid');
    if (!container) return;

    const selectedId = window.misarGmState.currentGmId;
    const perms = selectedId ? misarGmEffectivePerms(selectedId)
                             : (window.misarGmState.permissions || MISAR_GM_DEFAULT_PERMS);

    // شريط عنوان يوضّح على مَن نُعدّل
    const target = selectedId
        ? (window.misarGmState.gmList || []).find(g => g.id === selectedId)
        : null;
    const header = selectedId
        ? `<div class="gm-perm-target">
             <i class="fas fa-user-edit"></i>
             تعديل صلاحيات: <b>${escapeHTML((target && target.name) || 'مدير')}</b>
             <button class="founder-btn" style="width:auto;padding:4px 10px;margin-inline-start:10px;"
                     onclick="onGmClearSelection()"><i class="fas fa-times"></i> إلغاء التحديد</button>
           </div>`
        : `<div class="gm-perm-target gm-perm-target-default">
             <i class="fas fa-layer-group"></i> هذه الصلاحيات <b>الافتراضية</b> لكل مدير لم تُخصّص له صلاحيات.
             اضغط على مدير من القائمة أعلاه لتخصيص صلاحياته.
           </div>`;

    container.innerHTML = header + MISAR_GM_SECTIONS.map(sec => {
        const secPerms = perms[sec.key] || {};
        const checks = sec.actions.map(act => {
            const on = secPerms[act] === true;
            return `<label class="gm-perm-check">
                <input type="checkbox" data-section="${sec.key}" data-action="${act}" ${on ? 'checked' : ''}
                    onchange="onGmPermissionToggle(this)">
                <span>${MISAR_GM_ACTION_LABELS[act] || act}</span>
            </label>`;
        }).join('');
        return `<div class="gm-perm-card">
            <div class="gm-perm-title"><i class="${sec.icon}"></i> ${sec.label}</div>
            <div class="gm-perm-actions">${checks}</div>
        </div>`;
    }).join('');
}

// تبديل صلاحية واحدة (للمدير المختار إن وُجد، وإلا للافتراضي)
window.onGmPermissionToggle = async function (checkbox) {
    const section = checkbox.dataset.section;
    const action = checkbox.dataset.action;
    const allowed = checkbox.checked;
    const selectedId = window.misarGmState.currentGmId;
    try {
        if (selectedId) {
            await misarSetGmPermissionFor(selectedId, section, action, allowed);
            showToast(`تم ${allowed ? 'منح' : 'سحب'} صلاحية «${MISAR_GM_ACTION_LABELS[action] || action}» لهذا المدير`, 'success');
        } else {
            await misarSetGmPermission(section, action, allowed);
            showToast(`تم ${allowed ? 'منح' : 'سحب'} صلاحية «${MISAR_GM_ACTION_LABELS[action] || action}» افتراضياً`, 'success');
        }
    } catch (err) {
        checkbox.checked = !allowed; // رجوع عند الفشل
        showToast(err.message, 'error');
    }
};

// إلغاء تحديد المدير المختار (العودة للصلاحيات الافتراضية)
window.onGmClearSelection = function () {
    window.misarGmState.currentGmId = null;
    misarRenderGmPermissionsGrid();
    misarRenderGmList();
};

// اختيار مدير لتعديل صلاحياته (بالضغط على صفه)
window.onGmSelectForPerms = function (userId) {
    window.misarGmState.currentGmId = userId;
    misarRenderGmList();
    misarRenderGmPermissionsGrid();
    // التمرير إلى شبكة الصلاحيات ليراها المؤسس مباشرة
    const grid = document.getElementById('gmPermissionsGrid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// قائمة المدراء العامين
function misarRenderGmList() {
    const tbody = document.getElementById('gmListTableBody');
    if (!tbody) return;
    const list = window.misarGmState.gmList || [];
    const suspended = window.misarGmState.suspended || [];
    const selectedId = window.misarGmState.currentGmId;

    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px;">لا يوجد مدير عام معيّن حتى الآن</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(gm => {
        const isSusp = suspended.includes(gm.id);
        const statusText = isSusp ? 'موقوف' : (gm.status === 'approved' ? 'نشط' : (gm.status || 'غير معروف'));
        const statusClass = isSusp ? 'suspended' : (gm.status === 'approved' ? 'active' : '');
        const img = gm.image_url
            ? `<img src="${escapeHTML(gm.image_url)}" class="avatar-img" loading="lazy" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`
            : '<i class="fas fa-user-tie" style="font-size:1.2rem;"></i>';
        const profile = misarGmProfile(gm.id);
        const roleLabel = (MISAR_GM_ROLE_TYPES.find(r => r.key === profile.role) || {}).label || 'مدير عام';
        const labelText = profile.label ? `${escapeHTML(profile.label)}` : '<span style="color:#999;">بدون تسمية</span>';
        const isSelected = selectedId === gm.id;
        const hasCustom = !!(window.misarGmState.byUser || {})[gm.id]?.perms;
        return `<tr class="${isSelected ? 'gm-row-selected' : ''}">
            <td>${img} ${escapeHTML(gm.name || 'بدون اسم')}</td>
            <td>${labelText}<div style="font-size:0.75rem;color:#666;">${roleLabel}${hasCustom ? ' • مخصّص' : ' • افتراضي'}</div></td>
            <td>${escapeHTML(gm.email || '')}</td>
            <td><span class="gm-status ${statusClass}">${statusText}</span></td>
            <td>${gm.created_at ? new Date(gm.created_at).toLocaleDateString('ar-EG') : '—'}</td>
            <td>
                ${isSusp
                ? `<button class="founder-btn" style="width:auto;padding:6px 12px;" onclick="onGmReactivate('${gm.id}')"><i class="fas fa-play"></i> تفعيل</button>`
                : `<button class="remove-btn" style="width:auto;padding:6px 12px;" onclick="onGmSuspend('${gm.id}')"><i class="fas fa-pause"></i> إيقاف</button>`}
            </td>
            <td class="gm-actions-cell">
                <button class="founder-btn" style="width:auto;padding:6px 12px;" onclick="onGmSelectForPerms('${gm.id}')"><i class="fas fa-key"></i> الصلاحيات</button>
                <button class="google-btn" style="width:auto;padding:6px 12px;" onclick="onGmRename('${gm.id}')"><i class="fas fa-tag"></i> الاسم الظاهر</button>
                <button class="google-btn" style="width:auto;padding:6px 12px;" onclick="onGmViewActivity('${gm.id}')"><i class="fas fa-history"></i> النشاط</button>
                <button class="google-btn" style="width:auto;padding:6px 12px;" onclick="onGmChangeRole('${gm.id}')"><i class="fas fa-user-tag"></i> تغيير الدور</button>
                <button class="remove-btn" style="width:auto;padding:6px 12px;" onclick="onGmRevoke('${gm.id}')"><i class="fas fa-user-minus"></i> إلغاء التعيين</button>
            </td>
        </tr>`;
    }).join('');
}

// تعديل المسمى الذي يظهر بجانب اسم المدير في واجهة الحساب
window.onGmRename = async function (userId) {
    if (!misarIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
    const list = window.misarGmState.gmList || [];
    const gm = list.find(g => g.id === userId);
    const prof = misarGmProfile(userId);
    const current = prof.label || '';
    const newLabel = prompt('اكتب المسمى الذي سيظهر بجانب اسم المدير وبدلاً من «لوحة المدير العام» (مثال: مشرف، مدير إدارة، إدارة التشغيل). ستظهر عبارة «لوحة» قبله تلقائياً. اتركه فارغاً لإعادة الاسم الافتراضي:', current);
    if (newLabel === null) return;
    showLoading(true);
    try {
        await misarSetGmProfileFor(userId, { label: newLabel });
        showToast(`تم حفظ التسمية لـ ${(gm && gm.name) || 'المدير'}`, 'success');
        await misarRenderGmAdminPanel();
    } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

// تطبيق قالب صلاحيات جاهز على المدير المختار
window.onGmApplyTemplate = async function (kind) {
    const userId = window.misarGmState.currentGmId;
    if (!userId) return showToast('اختر مديراً أولاً من القائمة.', 'warning');
    showLoading(true);
    try {
        const perms = misarGmTemplatePerms(kind);
        await misarSetGmProfileFor(userId, { perms });
        showToast('تم تطبيق القالب على المدير المختار', 'success');
        misarRenderGmPermissionsGrid();
        misarRenderGmList();
    } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

// أحداث لوحة المؤسس
window.onGmSuspend = async function (userId) {
    if (!confirm('إيقاف هذا المدير العام مؤقتاً؟ لن يستطيع الدخول للوحة أو تنفيذ أي عملية.')) return;
    showLoading(true);
    try { await misarSuspendGm(userId); showToast('تم إيقاف المدير العام', 'success'); await misarRenderGmAdminPanel(); }
    catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

window.onGmReactivate = async function (userId) {
    showLoading(true);
    try { await misarReactivateGm(userId); showToast('تم إعادة تفعيل المدير العام', 'success'); await misarRenderGmAdminPanel(); }
    catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

window.onGmRevoke = async function (userId) {
    if (!confirm('إلغاء تعيين هذا المستخدم كمدير عام؟ سيصبح عميلاً عادياً.')) return;
    showLoading(true);
    try { await misarRevokeGeneralManager(userId); showToast('تم إلغاء تعيين المدير العام', 'success'); await misarRenderGmAdminPanel(); }
    catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

window.onGmChangeRole = async function (userId) {
    const role = prompt('اختر الدور الجديد: client أو seller أو delivery', 'client');
    if (!role) return;
    showLoading(true);
    try { await misarChangeGmRole(userId, role.trim()); showToast('تم تغيير الدور', 'success'); await misarRenderGmAdminPanel(); }
    catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

// ترقية مستخدم يدوياً بالبريد (شاشة المؤسس)
window.onGmPromoteByEmail = async function () {
    if (!misarIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
    const input = document.getElementById('gmPromoteEmail');
    const email = input ? input.value.trim().toLowerCase() : '';
    if (!email) return showToast('أدخل بريد المستخدم', 'warning');
    showLoading(true);
    try {
        // البحث بالبريد — البريد قد يتكرر في user_data، فلا نستخدم .maybeSingle()
        // (التي ترمي خطأ عند تكرار السجل) ولا limit(1) (التي تختار سجلًا عشوائيًا).
        // نجلب حتى سجلين ونعالج التكرار بوضوح.
        const { data: rows, error } = await supabaseClient
            .from('user_data').select('id, account_type, email').eq('email', email).limit(2);
        if (error) throw error;
        if (!rows || rows.length === 0) throw new Error('لا يوجد مستخدم بهذا البريد.');
        if (rows.length > 1) {
            throw new Error('يوجد أكثر من حساب مسجّل بهذا البريد (' + rows.length + '). عالج تكرار البريد في قاعدة البيانات قبل التعيين.');
        }
        const data = rows[0];
        if (data.account_type === 'founder') throw new Error('لا يمكن تعيين المؤسس كمدير عام.');
        if (data.account_type === 'general_manager') throw new Error('هذا المستخدم مدير عام بالفعل.');
        await misarPromoteToGeneralManager(data.id);
        if (input) input.value = '';
        showToast('تم تعيين المستخدم كمدير عام', 'success');
        await misarRenderGmAdminPanel();
    } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

// عرض نشاط مدير عام معيّن
window.onGmViewActivity = async function (userId) {
    showLoading(true);
    try {
        const { data, error } = await supabaseClient
            .from('activity_logs')
            .select('*')
            .eq('admin_id', userId)
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        const rows = (data || []).map(l => `
            <tr>
                <td>${escapeHTML(l.action_type || '')}</td>
                <td>${escapeHTML(l.details ? JSON.stringify(l.details) : '')}</td>
                <td>${l.created_at ? new Date(l.created_at).toLocaleString('ar-EG') : ''}</td>
            </tr>`).join('');
        const box = document.getElementById('gmActivityModalBody');
        if (box) {
            box.innerHTML = rows
                ? `<table class="founder-table"><thead><tr><th>العملية</th><th>التفاصيل</th><th>الوقت</th></tr></thead><tbody>${rows}</tbody></table>`
                : '<p style="text-align:center;padding:20px;">لا يوجد نشاط مسجّل لهذا المدير.</p>';
        }
        const modal = document.getElementById('gmActivityModal');
        if (modal) modal.classList.add('active');
    } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

window.closeGmActivityModal = function () {
    const modal = document.getElementById('gmActivityModal');
    if (modal) modal.classList.remove('active');
};

// ============================================================
// 8) لوحة المدير العام — العرض حسب الصلاحيات
// ============================================================
async function misarInitGeneralManagerDashboard() {
    if (!misarIsGeneralManager()) {
        showToast('هذه اللوحة مخصصة للمدير العام فقط', 'error');
        showScreen('homeScreen');
        return;
    }
    // تفعيل طبقة توجيه العناصر قبل أي عرض داخل اللوحة
    misarApplyGmIdRouting();
    if (!window.misarGmState.permissions) await misarLoadGmSettings();

    misarRenderGmTabs();
    const first = MISAR_GM_SECTIONS.find(s => misarGmCan(s.key, 'view'));
    await misarSwitchGmTab(first ? first.key : 'dashboard');
}

// بناء شريط تبويبات المدير العام حسب الصلاحيات
function misarRenderGmTabs() {
    const bar = document.getElementById('gmTabs');
    if (!bar) return;
    const visible = MISAR_GM_SECTIONS.filter(s => misarGmCan(s.key, 'view'));
    bar.innerHTML = visible.map((s, i) => `
        <button class="founder-tab${i === 0 ? ' active' : ''}" data-tab="${s.key}" onclick="misarSwitchGmTab('${s.key}')">
            <i class="${s.icon}"></i> ${s.label}
        </button>`).join('');
}

// التبديل بين تبويبات المدير العام (يعيد استخدام دوال المؤسس للعرض)
window.misarSwitchGmTab = async function (tabId) {
    if (!misarIsGeneralManager() && !misarIsFounder()) return;
    if (!misarGmCan(tabId, 'view')) {
        showToast('لا تملك صلاحية الوصول لهذا القسم', 'error');
        return;
    }
    document.querySelectorAll('#gmTabs .founder-tab').forEach(t => t.classList.remove('active'));
    const btn = document.querySelector(`#gmTabs .founder-tab[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.gm-tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`gm-tab-${tabId}`);
    if (panel) panel.classList.add('active');

    showLoading(true);
    try {
        switch (tabId) {
            case 'dashboard': await misarRenderGmStats(); break;
            case 'orders': if (typeof loadOrdersTableAdmin === 'function') await loadOrdersTableAdmin(); break;
            case 'misar_tech': if (typeof loadMisarTechRequests === 'function') await loadMisarTechRequests(); break;
            case 'founder_notes': if (typeof renderFounderNotesForGm === 'function') await renderFounderNotesForGm(); break;
            case 'products': if (typeof loadProductsTableAdmin === 'function') await loadProductsTableAdmin(); break;
            case 'services': if (typeof loadServicesTableAdmin === 'function') await loadServicesTableAdmin(); break;
            case 'users': if (typeof loadCustomersTable === 'function') await loadCustomersTable(); break;
            case 'sellers': if (typeof loadSellersTable === 'function') await loadSellersTable(); break;
            case 'delivery': if (typeof loadDeliveriesTable === 'function') await loadDeliveriesTable(); break;
            case 'returns': await misarDisplayGmReturns(); break;
            case 'banners': await misarRefreshGmBanners(); break;
            case 'ads': await misarRefreshGmBanners(); break;
            case 'locations': if (typeof misarInitGmLocations === 'function') await misarInitGmLocations(); break;
            case 'reports': await misarRenderGmStats(); break;
            case 'activity_logs': await misarRenderGmActivity(); break;
            case 'settings': await misarRenderGmSettings(); break;
        }
        await misarLoadGmSettings(); // إعادة قراءة الإيقاف الفوري
    } catch (err) {
        console.warn('خطأ في تبويب المدير العام:', err);
        showToast('تعذر تحميل القسم: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
};

// إحصائيات لوحة المدير العام (إعادة استخدام getFounderStats)
async function misarRenderGmStats() {
    const stats = (typeof getFounderStats === 'function') ? await getFounderStats() : {};
    const container = document.getElementById('gmStatsGrid');
    if (!container) return;
    // tab: تبويب لوحة المدير العام الذي يُفتح عند الضغط (تُصفّى حسب الصلاحيات).
    const items = [
        { icon: 'fas fa-users', label: 'إجمالي المستخدمين', value: stats.totalUsers || 0, tab: 'users' },
        { icon: 'fas fa-store', label: 'البائعين', value: stats.sellers || 0, tab: 'sellers' },
        { icon: 'fas fa-truck', label: 'المناديب', value: stats.deliveries || 0, tab: 'delivery' },
        { icon: 'fas fa-shopping-cart', label: 'إجمالي الطلبات', value: stats.totalOrders || 0, tab: 'orders' },
        { icon: 'fas fa-plus-circle', label: 'طلبات جديدة', value: stats.newOrders || 0, tab: 'orders' },
        { icon: 'fas fa-check-double', label: 'مكتملة', value: stats.completedOrders || 0, tab: 'orders' },
        { icon: 'fas fa-boxes', label: 'المنتجات', value: stats.totalProducts || 0, tab: 'products' },
        { icon: 'fas fa-concierge-bell', label: 'الخدمات', value: stats.totalServices || 0, tab: 'services' }
    ];
    container.innerHTML = items.map(i => {
        // لا نجعل البطاقة قابلة للنقر إلا إذا كان للمدير صلاحية عرض القسم
        const allowed = (i.tab === 'dashboard') || misarGmCan(i.tab, 'view');
        const clickable = !!i.tab && allowed;
        return `
        <div class="stat-card-founder${clickable ? ' stat-card-clickable' : ''}"
             ${clickable ? `data-gm-stat-tab="${i.tab}" title="اضغط للانتقال إلى القسم"` : ''}>
            <div class="stat-icon"><i class="${i.icon}"></i></div>
            <div class="stat-number">${i.value}</div>
            <div class="stat-label">${i.label}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.stat-card-clickable').forEach(card => {
        card.addEventListener('click', () => {
            const tab = card.dataset.gmStatTab;
            if (tab && typeof window.misarSwitchGmTab === 'function') {
                window.misarSwitchGmTab(tab);
            }
        });
    });
}

// نشاط المدير العام (سجله هو)
async function misarRenderGmActivity() {
    const tbody = document.getElementById('gmActivityTableBody');
    if (!tbody) return;
    try {
        const { data, error } = await supabaseClient
            .from('activity_logs')
            .select('*')
            .eq('admin_id', appState.user.id)
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;">لا يوجد نشاط مسجّل بعد</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(l => `<tr>
            <td>${escapeHTML(l.action_type || '')}</td>
            <td>${escapeHTML(l.details ? JSON.stringify(l.details) : '')}</td>
            <td>${l.created_at ? new Date(l.created_at).toLocaleString('ar-EG') : ''}</td>
        </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;">تعذر تحميل السجل</td></tr>';
    }
}

// إعدادات محدودة للمدير العام (عرض فقط — الحساسة للمؤسس)
async function misarRenderGmSettings() {
    const container = document.getElementById('gmSettingsForm');
    if (!container) return;
    const canEdit = misarGmCan('settings', 'edit');
    let settings = [];
    try { settings = await getAppSettings(); } catch (e) { /* تجاهل */ }
    const map = {};
    settings.forEach(s => { map[s.setting_key] = s.setting_value; });
    container.innerHTML = `
        <div class="input-group"><label class="input-label">اسم التطبيق</label>
            <input type="text" id="gm_setting_app_name" class="input-field" value="${escapeHTML(map.app_name || 'Misar Systems')}" ${canEdit ? '' : 'disabled'}></div>
        <p style="color:#666; font-size:0.85rem;">الإعدادات الحساسة (العمولات، المحافظات، صلاحيات المدير) محجوبة عن المدير العام وتخص المؤسس فقط.</p>
        ${canEdit ? '<button class="login-btn" onclick="misarSaveGmSettings()"><i class="fas fa-save"></i> حفظ</button>' : '<p style="color:#c62828;">لا تملك صلاحية التعديل.</p>'}
    `;
}

window.misarSaveGmSettings = async function () {
    if (!misarGmCan('settings', 'edit')) return showToast('لا تملك صلاحية التعديل', 'error');
    showLoading(true);
    try {
        const nameEl = document.getElementById('gm_setting_app_name');
        if (nameEl) await saveAppSettings([{ setting_key: 'app_name', setting_value: nameEl.value.trim() }]);
        await logActivity(appState.user.id, 'gm_update_settings', { section: 'settings', result: 'success' });
        showToast('تم حفظ الإعدادات', 'success');
    } catch (err) { showToast(err.message, 'error'); } finally { showLoading(false); }
};

// مواقع المدير العام (عرض فقط افتراضياً)
async function misarInitGmLocations() {
    const container = document.getElementById('gmLocationsContent');
    if (!container) return;
    if (misarGmCan('locations', 'edit') && typeof initFounderLocationsAdmin === 'function') {
        container.innerHTML = '<p style="color:#2e7d32;">لديك صلاحية التعديل على المواقع.</p>';
        await initFounderLocationsAdmin();
    } else {
        container.innerHTML = '<p style="text-align:center;padding:20px;color:#c62828;">إدارة المواقع متاحة للمؤسس فقط.</p>';
    }
}

// ============================================================
// عرض GM مستقل للمرتجعات — لا يكسر displayFounderReturns
// ------------------------------------------------------------
// الدالة الأصلية displayFounderReturns ترفض أي حساب غير المؤسس،
// لذلك نعرض هنا نسخة تعمل للمدير العام في عنصر #gm-founderReturnsList
// مع إعادة استخدام نفس دالة الجلب الآمنة loadAllReturnsForFounder،
// ولا نحبس المؤسس: لو كان مؤسسًا نستخدم دالته الأصلية.
// ============================================================
async function misarDisplayGmReturns() {
    const container = document.getElementById('gm-founderReturnsList');
    if (!container) return;

    // المؤسس داخل لوحة GM (أو أي حالة مؤسس) — نعتمد على سلوكه الأصلي
    if (typeof misarIsFounder === 'function' && misarIsFounder()
        && typeof displayFounderReturns === 'function') {
        return displayFounderReturns();
    }

    if (!misarGmCan('returns', 'view')) {
        container.innerHTML = '<p style="text-align:center;padding:20px;color:#c62828;">لا تملك صلاحية عرض المرتجعات.</p>';
        return;
    }

    showLoading(true);
    try {
        let returns = [];
        if (typeof loadAllReturnsForFounder === 'function') {
            returns = await loadAllReturnsForFounder();
        } else if (typeof supabaseClient !== 'undefined') {
            const { data, error } = await supabaseClient
                .from('returns').select('*').order('requested_at', { ascending: false });
            if (error) throw error;
            returns = data || [];
        }

        if (!returns || returns.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#999;">
                    <i class="fas fa-undo-alt" style="font-size:2.5rem; margin-bottom:10px;"></i>
                    <p>لا توجد طلبات استرجاع في النظام</p>
                </div>`;
            return;
        }

        const statusText = (typeof getReturnStatusText === 'function')
            ? getReturnStatusText : (s => s || '');

        container.innerHTML = '';
        returns.forEach(ret => {
            const card = document.createElement('div');
            card.className = 'return-card founder-return-card';
            const product = ret.product || {};
            const buyer = ret.buyer || {};
            const seller = ret.seller || {};
            const delivery = ret.delivery || {};
            const imagesHtml = ret.images && ret.images.length > 0
                ? `<div class="return-images-preview">${ret.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModal('${img}')">`).join('')}</div>`
                : '';
            card.innerHTML = `
                <div class="return-card-header">
                    <span class="return-id">#${String(ret.id).slice(0, 8)}</span>
                    <span class="return-status ${ret.status}">${statusText(ret.status)}</span>
                </div>
                <div class="return-card-body">
                    <div class="return-product-info">
                        <div class="return-product-image">
                            ${product.image_url ? `<img src="${product.image_url}" loading="lazy">` : '📦'}
                        </div>
                        <div>
                            <div><strong>المنتج:</strong> ${escapeHTML(product.name || 'غير معروف')}</div>
                            <div><strong>العميل:</strong> ${escapeHTML(buyer.name || 'غير معروف')}</div>
                            <div><strong>البائع:</strong> ${escapeHTML(seller.name || 'غير معروف')}</div>
                            <div><strong>المندوب:</strong> ${escapeHTML(delivery.name || 'غير معين')}</div>
                            <div><strong>الكمية:</strong> ${ret.quantity}</div>
                            <div><strong>السبب:</strong> ${escapeHTML(ret.return_reason || '')}</div>
                            ${ret.customer_notes ? `<div><strong>ملاحظات العميل:</strong> ${escapeHTML(ret.customer_notes)}</div>` : ''}
                            ${ret.rejection_reason ? `<div style="color:#f44336;"><strong>سبب الرفض:</strong> ${escapeHTML(ret.rejection_reason)}</div>` : ''}
                            <div><strong>تاريخ الطلب:</strong> ${ret.requested_at ? new Date(ret.requested_at).toLocaleString('ar-EG') : '—'}</div>
                        </div>
                    </div>
                    ${imagesHtml}
                </div>`;
            container.appendChild(card);
        });
    } catch (err) {
        console.warn('تعذر تحميل مرتجعات المدير العام:', err);
        container.innerHTML = '<p style="text-align:center;padding:20px;color:#c62828;">تعذر تحميل المرتجعات</p>';
    } finally {
        showLoading(false);
    }
}

// ============================================================
// عرض GM مستقل للإعلانات — يكتب في #gm-bannersTableBody
// (refreshBannersAdmin الأصلية تكتب في عنصر المؤسس دائمًا)
// ============================================================
async function misarRefreshGmBanners() {
    const body = document.getElementById('gm-bannersTableBody')
        || document.getElementById('gm-bannersTableBody2');
    if (!body) return;
    try {
        const { data, error } = await supabaseClient
            .from('banners').select('*').order('sort_order', { ascending: true });
        if (error) throw error;
        const banners = data || [];
        if (!banners.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">لا توجد إعلانات</td></tr>';
            return;
        }
        const canEdit = misarGmCan('banners', 'edit') || misarGmCan('ads', 'edit');
        body.innerHTML = banners.map(b => `
            <tr>
                <td><img src="${escapeHTML(b.image_url || '')}" alt="${escapeHTML(b.title || '')}" style="width:60px;height:40px;object-fit:cover;border-radius:6px;"></td>
                <td>${escapeHTML(b.title || '')}</td>
                <td style="direction:ltr;">${escapeHTML(b.link || '')}</td>
                <td>${escapeHTML(String(b.sort_order || 0))}</td>
                <td>${b.active ? 'نعم' : 'لا'}</td>
                <td>${canEdit ? '<span style="color:#2e7d32;font-size:0.85rem;">متاح للتعديل</span>' : '<span style="color:#999;font-size:0.85rem;">عرض فقط</span>'}</td>
            </tr>`).join('');
    } catch (err) {
        console.warn('تعذر تحميل إعلانات المدير العام:', err);
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">تعذر تحميل الإعلانات</td></tr>';
    }
}

// ============================================================
// 9) تصدير الدوال
// ============================================================
window.misarIsFounder = misarIsFounder;
window.misarIsGeneralManager = misarIsGeneralManager;
window.misarGmCan = misarGmCan;
window.misarLoadGmSettings = misarLoadGmSettings;
window.misarLoadGmList = misarLoadGmList;
window.misarInitGeneralManagerDashboard = misarInitGeneralManagerDashboard;
window.misarRenderGmAdminPanel = misarRenderGmAdminPanel;
window.misarRenderGmStats = misarRenderGmStats;
window.misarDisplayGmReturns = misarDisplayGmReturns;
window.misarRefreshGmBanners = misarRefreshGmBanners;
window.misarIsGmContext = misarIsGmContext;
window.misarViewEl = misarViewEl;
window.misarApplyGmIdRouting = misarApplyGmIdRouting;
window.MISAR_GM_SECTIONS = MISAR_GM_SECTIONS;
window.MISAR_GM_ROLE_TYPES = MISAR_GM_ROLE_TYPES;
// دوال عرض/إدارة المدراء (يستدعيها supabase.js عند الدخول أيضاً)
window.misarRenderGmList = misarRenderGmList;
window.misarRenderGmPermissionsGrid = misarRenderGmPermissionsGrid;
window.misarRenderGmRoleOptions = misarRenderGmRoleOptions;
window.misarGmEffectivePerms = misarGmEffectivePerms;
window.misarGmProfile = misarGmProfile;
