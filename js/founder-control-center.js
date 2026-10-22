// ============================================================
// MISAR SYSTEMS — مركز التحكم في إشعارات المؤسس
// js/founder-control-center.js
// ============================================================
// واجهة فقط. الحماية الفعلية على الخادم (Edge Function) وقاعدة البيانات (RLS).
// جميع الدوال تعتمد على getNotificationSettings / saveNotificationSettings
// في js/supabase.js.
// ============================================================

(function () {
    'use strict';

    // تصنيف أنواع الإشعارات كما طلب المؤسس
    const FCC_GROUPS = [
        {
            title: 'الحسابات',
            icon: 'fas fa-user-plus',
            items: [
                { key: 'new_client', label: 'عميل جديد' },
                { key: 'new_seller', label: 'بائع جديد' },
                { key: 'new_delivery', label: 'مندوب جديد' },
                { key: 'account_verification', label: 'طلب انضمام / توثيق حساب' }
            ]
        },
        {
            title: 'الطلبات والتوصيل',
            icon: 'fas fa-shopping-cart',
            items: [
                { key: 'order_created', label: 'طلب جديد' },
                { key: 'order_status_changed', label: 'تغيير حالة الطلب' },
                { key: 'order_accepted', label: 'قبول الطلب' },
                { key: 'order_rejected', label: 'رفض الطلب' },
                { key: 'order_cancelled', label: 'إلغاء طلب' },
                { key: 'return_requested', label: 'طلب استرجاع' },
                { key: 'delivery_delayed', label: 'تأخر التوصيل', needsSource: true },
                { key: 'delivery_problem', label: 'مشكلة في التوصيل', needsSource: true }
            ]
        },
        {
            title: 'الإدارة والصلاحيات',
            icon: 'fas fa-user-shield',
            items: [
                { key: 'gm_login', label: 'تسجيل دخول المدير العام', needsSource: true },
                { key: 'gm_permissions_changed', label: 'تغيير صلاحيات المدير العام' },
                { key: 'admin_suspended', label: 'إيقاف / تفعيل حساب إداري' },
                { key: 'platform_settings_changed', label: 'تغيير إعدادات المنصة' },
                { key: 'unauthorized_access', label: 'محاولة وصول مرفوضة', needsSource: true }
            ]
        },
        {
            title: 'الأمان والتشغيل',
            icon: 'fas fa-shield-alt',
            items: [
                { key: 'complaint_new', label: 'شكوى / بلاغ جديد' },
                { key: 'critical_error', label: 'خطأ تقني مهم', needsSource: true },
                { key: 'notification_failed', label: 'فشل إرسال إشعار' }
            ]
        }
    ];

    const STATUS_LABELS = {
        pending: 'قيد الإرسال',
        sent: 'تم الإرسال',
        failed: 'فشل',
        skipped_disabled: 'متوقف (معطّل)',
        skipped_no_recipient: 'تخطّي (لا رقم)',
        skipped_no_secret: 'تخطّي (لا سر)'
    };

    let fccSettings = null;

    function fccEl(id) { return document.getElementById(id); }

    function fccEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fccFmtDate(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString('ar-EG', { hour12: true });
        } catch (e) { return String(iso); }
    }

    // ============================================================
    // تحميل الإعدادات ورسم الواجهة
    // ============================================================
    async function fccLoad() {
        const wrap = fccEl('fccGroups');
        if (wrap) wrap.innerHTML = '<p style="color:#666;">جاري التحميل...</p>';
        try {
            fccSettings = await getNotificationSettings();
        } catch (e) {
            fccSettings = null;
        }
        if (!fccSettings) {
            if (wrap) wrap.innerHTML = '<p style="color:#c00;">تعذّر تحميل الإعدادات. تحقق من الاتصال.</p>';
            return;
        }
        fccRender();
        await fccLoadLog();
        await fccLoadStatus();
    }

    function fccRender() {
        if (!fccSettings) return;

        const master = fccEl('fccMasterEnabled');
        if (master) master.checked = fccSettings.master_enabled !== false;

        const num = fccEl('fccFounderNumber');
        if (num) num.value = fccSettings.founder_whatsapp_number || '';

        const channel = fccEl('fccChannel');
        if (channel) channel.value = fccSettings.channel || 'whatsapp';

        const wrap = fccEl('fccGroups');
        if (!wrap) return;

        wrap.innerHTML = FCC_GROUPS.map(group => `
            <div class="fcc-group">
                <h5 class="fcc-group-title"><i class="${group.icon}"></i> ${fccEscape(group.title)}</h5>
                <div class="fcc-items">
                    ${group.items.map(item => {
            const enabled = fccSettings.types[item.key] !== false;
            return `
                        <label class="fcc-item ${item.needsSource ? 'fcc-item-pending' : ''}">
                            <input type="checkbox" data-fcc-key="${fccEscape(item.key)}" ${enabled ? 'checked' : ''}>
                            <span class="fcc-item-label">${fccEscape(item.label)}</span>
                            ${item.needsSource ? '<span class="fcc-badge" title="لا يوجد مصدر حقيقي مرتبط بعد">بدون مصدر</span>' : ''}
                        </label>`;
        }).join('')}
                </div>
            </div>
        `).join('');

        wrap.querySelectorAll('input[data-fcc-key]').forEach(cb => {
            cb.addEventListener('change', fccOnToggle);
        });

        fccUpdateDisabledState();
    }

    function fccUpdateDisabledState() {
        const masterOn = fccSettings && fccSettings.master_enabled !== false;
        const wrap = fccEl('fccGroups');
        if (wrap) {
            wrap.querySelectorAll('input[data-fcc-key]').forEach(cb => {
                cb.disabled = !masterOn;
            });
        }
    }

    // تغيير مفتاح فرعي — يحفظ فوراً (يتطلب صلاحية المؤسس على الخادم)
    async function fccOnToggle(e) {
        if (!fccSettings) return;
        const key = e.target.getAttribute('data-fcc-key');
        const checked = e.target.checked;
        const prev = fccSettings.types[key];
        fccSettings.types[key] = checked;
        try {
            await saveNotificationSettings(fccSettings);
            showToast(checked ? 'تم تفعيل الإشعار' : 'تم إيقاف الإشعار', 'success');
        } catch (err) {
            fccSettings.types[key] = prev;
            e.target.checked = prev !== false;
            showToast('تعذّر الحفظ: ' + (err.message || 'خطأ'), 'error');
        }
    }

    window.fccToggleMaster = async function () {
        if (!fccSettings) return;
        const master = fccEl('fccMasterEnabled');
        fccSettings.master_enabled = master ? master.checked : true;
        try {
            await saveNotificationSettings(fccSettings);
            showToast(fccSettings.master_enabled ? 'تم تفعيل جميع الإشعارات' : 'تم إيقاف جميع الإشعارات', 'success');
            fccUpdateDisabledState();
        } catch (err) {
            fccSettings.master_enabled = !fccSettings.master_enabled;
            if (master) master.checked = fccSettings.master_enabled;
            showToast('تعذّر الحفظ: ' + (err.message || 'خطأ'), 'error');
        }
    };

    window.fccSaveNumber = async function () {
        if (!fccSettings) return;
        const num = fccEl('fccFounderNumber');
        const val = num ? num.value.trim() : '';
        fccSettings.founder_whatsapp_number = val;
        try {
            await saveNotificationSettings(fccSettings);
            showToast('تم حفظ رقم الإشعارات', 'success');
        } catch (err) {
            showToast('تعذّر الحفظ: ' + (err.message || 'خطأ'), 'error');
        }
    };

    window.fccSaveChannel = async function () {
        if (!fccSettings) return;
        const sel = fccEl('fccChannel');
        fccSettings.channel = sel ? sel.value : 'whatsapp';
        try {
            await saveNotificationSettings(fccSettings);
            showToast('تم حفظ قناة الإشعار', 'success');
        } catch (err) {
            showToast('تعذّر الحفظ: ' + (err.message || 'خطأ'), 'error');
        }
    };

    // اختبار الربط — يُرسل رسالة اختبار إلى رقم المؤسس
    window.fccTestLink = async function () {
        const btn = fccEl('fccTestBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاختبار...'; }
        try {
            const res = await testFounderNotificationLink();
            if (res && res.ok) {
                showToast('✅ تم إرسال رسالة اختبار إلى رقم المؤسس', 'success');
            } else {
                const reason = res && (res.skipped || res.detail) ? (res.skipped || res.detail) : 'غير معروف';
                showToast('⚠️ لم يتم الإرسال: ' + reason, 'error');
            }
        } catch (err) {
            const msg = String((err && err.message) || 'خطأ');
            // ترجمة أشهر أسباب الفشل إلى إرشاد واضح بدل رسالة تقنية مبهمة
            let hint = msg;
            if (/404|غير منشورة/i.test(msg)) {
                hint = msg;
            } else if (/شبكة|CORS|Failed to send a request/i.test(msg)) {
                hint = 'تعذّر الوصول إلى الخادم (شبكة/CORS) — الدالة قد تكون منشورة لكن المتصفح لم يصل إليها. ' +
                    'أعد المحاولة أو افتح Console لرؤية السبب. التفاصيل: ' + msg;
            } else if (/401|Unauthorized/i.test(msg)) {
                hint = 'الدالة رفضت الطلب (401). تحقق من صلاحية حسابك كمؤسس ومن ضبط NOTIFY_SHARED_SECRET على الخادم.';
            } else if (/skipped_no_recipient|invalid_owner_number/i.test(msg)) {
                hint = 'لا يوجد رقم واتساب مؤسس صالح. احفظ الرقم أولاً (مثال: 2010xxxxxxx).';
            } else if (/WHATSAPP_POST|WHATSAPP_PHONE|WHATSAPP_ACCESS|secrets/i.test(msg)) {
                hint = 'أسرار واتساب غير مضبوطة على الخادم (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).';
            }
            showToast('تعذّر اختبار الربط: ' + hint, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-vial"></i> اختبار الربط'; }
            await fccLoadLog();
            await fccLoadStatus();
        }
    };

    // ============================================================
    // حالة الربط: آخر إرسال ناجح / آخر فشل / عدد الفاشل
    // ============================================================
    async function fccLoadStatus() {
        let log = [];
        try {
            log = await getFounderNotificationLog(50);
        } catch (e) { log = []; }

        const lastSent = log.find(r => r.status === 'sent');
        const lastFailed = log.find(r => r.status === 'failed');
        const failedCount = log.filter(r => r.status === 'failed').length;

        const set = (id, val) => { const el = fccEl(id); if (el) el.textContent = val; };
        set('fccLastSent', lastSent ? fccFmtDate(lastSent.sent_at || lastSent.created_at) : 'لا يوجد');
        set('fccLastFailed', lastFailed ? fccFmtDate(lastFailed.created_at) : 'لا يوجد');
        set('fccFailedCount', String(failedCount));
    }

    // ============================================================
    // سجل الإرسال
    // ============================================================
    async function fccLoadLog() {
        const tbody = fccEl('fccLogTableBody');
        if (!tbody) return;
        let log = [];
        try {
            log = await getFounderNotificationLog(20);
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#c00;">تعذّر تحميل السجل</td></tr>';
            return;
        }
        if (!log.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#666;">لا توجد سجلات بعد</td></tr>';
            return;
        }
        tbody.innerHTML = log.map(r => {
            const st = STATUS_LABELS[r.status] || r.status;
            const cls = r.status === 'sent' ? 'fcc-st-ok'
                : r.status === 'failed' ? 'fcc-st-fail'
                    : 'fcc-st-skip';
            return `<tr>
                <td>${fccEscape(r.event_type)}</td>
                <td><span class="fcc-status ${cls}">${fccEscape(st)}</span></td>
                <td style="font-size:0.8rem;color:#666;">${fccEscape(r.error_detail || '—')}</td>
                <td style="font-size:0.8rem;">${fccEscape(fccFmtDate(r.created_at))}</td>
            </tr>`;
        }).join('');
    }

    window.fccRefresh = async function () {
        await fccLoad();
        showToast('تم تحديث مركز التحكم', 'success');
    };

    // تهيئة عند فتح التبويب
    window.initFounderControlCenter = async function () {
        await fccLoad();
    };

    // تصدير للاستخدام العام
    window.FCC_GROUPS = FCC_GROUPS;
})();
