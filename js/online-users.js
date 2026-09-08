// ============================================================
// نظام تتبع المتصلين أون لاين + عدّاد الزوار
// يعتمد على Supabase Realtime Presence (بدون جداول إضافية)
// ============================================================

const PRESENCE_CHANNEL = 'site-online-users';
let presenceChannel = null;
// إتاحته عالمياً لاستخدامه من admin-dashboard.js
Object.defineProperty(window, 'presenceChannel', {
    get: () => presenceChannel
});

// ---------- 1) تتبع الزائر الحالي (Presence) ----------
function initOnlineTracking() {
    if (!window.supabaseClient) return;

    const isAuthed = !!(appState.user && appState.user.id);
    const identity = {
        id: isAuthed ? appState.user.id : 'guest_' + getVisitorId(),
        name: isAuthed ? (appState.userData?.full_name || appState.user.email || 'مستخدم') : 'زائر',
        type: isAuthed ? (appState.userData?.account_type || 'client') : 'guest',
        page: location.pathname.split('/').pop() || 'index.html',
        since: Date.now()
    };

    presenceChannel = supabaseClient.channel(PRESENCE_CHANNEL, {
        config: { presence: { key: identity.id } }
    });

    presenceChannel
        .on('presence', { event: 'sync' }, () => renderOnlineUsers(presenceChannel.presenceState()))
        .on('presence', { event: 'join' }, () => updateOnlineBadge())
        .on('presence', { event: 'leave' }, () => updateOnlineBadge())
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track(identity);
            }
        });

    window.addEventListener('beforeunload', () => {
        if (presenceChannel) presenceChannel.untrack();
    });
}

// معرّف زائر ثابت لكل متصفح (للضيوف)
function getVisitorId() {
    let vid = localStorage.getItem('misar_visitor_id');
    if (!vid) {
        vid = crypto.randomUUID ? crypto.randomUUID() : 'v' + Math.random().toString(36).slice(2) + Date.now();
        localStorage.setItem('misar_visitor_id', vid);
    }
    return vid;
}

// ---------- 2) عرض المتصلين في لوحة المؤسس ----------
function renderOnlineUsers(presenceState) {
    const users = Object.values(presenceState).flat();

    const onlineCountEl = document.getElementById('onlineUsersCount');
    const guestsCountEl = document.getElementById('onlineGuestsCount');
    const membersCountEl = document.getElementById('onlineMembersCount');
    if (onlineCountEl) onlineCountEl.textContent = users.length;
    if (guestsCountEl) guestsCountEl.textContent = users.filter(u => u.type === 'guest').length;
    if (membersCountEl) membersCountEl.textContent = users.filter(u => u.type !== 'guest').length;

    const tbody = document.getElementById('onlineUsersTableBody');
    if (tbody) {
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">لا يوجد مستخدمون متصلون حالياً</td></tr>';
        } else {
            tbody.innerHTML = users.map(u => {
                const typeLabel = u.type === 'guest' ? '<span class="online-badge guest">ضيف</span>' :
                    u.type === 'founder' ? '<span class="online-badge founder">مؤسس</span>' :
                        u.type === 'seller' ? '<span class="online-badge seller">بائع</span>' :
                            u.type === 'delivery' ? '<span class="online-badge delivery">مندوب</span>' :
                                '<span class="online-badge client">عميل</span>';
                const mins = Math.floor((Date.now() - u.since) / 60000);
                const dur = mins < 1 ? 'الآن' : mins < 60 ? `${mins} دقيقة` : `${Math.floor(mins / 60)} ساعة`;
                return `<tr>
                    <td>${u.name || 'زائر'}</td>
                    <td>${typeLabel}</td>
                    <td>${u.page || '-'}</td>
                    <td>${dur}</td>
                </tr>`;
            }).join('');
        }
    }
}

function updateOnlineBadge() {
    if (!presenceChannel) return;
    renderOnlineUsers(presenceChannel.presenceState());
}

// ---------- 3) عدّاد الزوار الإجمالي (app_settings) ----------
async function trackSiteVisit() {
    try {
        if (sessionStorage.getItem('misar_counted')) return;
        sessionStorage.setItem('misar_counted', '1');

        const { data: cur } = await supabaseClient
            .from('app_settings')
            .select('setting_value')
            .eq('setting_key', 'total_visits')
            .maybeSingle();

        const next = ((cur && Number(cur.setting_value)) || 0) + 1;
        await supabaseClient.from('app_settings').upsert({
            setting_key: 'total_visits',
            setting_value: String(next),
            updated_at: new Date()
        });
    } catch (err) {
        console.warn('تعذر تسجيل الزيارة (قد يكون جدول app_settings غير متاح):', err.message);
    }
}

async function loadTotalVisits() {
    try {
        const { data } = await supabaseClient
            .from('app_settings')
            .select('setting_value')
            .eq('setting_key', 'total_visits')
            .maybeSingle();
        ['totalVisitsCount', 'totalVisitsCount2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = (data && Number(data.setting_value)) || 0;
        });
    } catch (err) { /* تجاهل */ }
}

// ---------- 4) عدّاد زيارات اليوم ----------
function todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function trackDailyVisit() {
    try {
        const { data: cur } = await supabaseClient
            .from('app_settings')
            .select('setting_value')
            .eq('setting_key', 'daily_visits')
            .maybeSingle();

        let info = {};
        try { info = JSON.parse(cur?.setting_value || '{}'); } catch (e) { info = {}; }
        if (info.date !== todayKey()) info = { date: todayKey(), count: 0 };
        info.count = (info.count || 0) + 1;

        await supabaseClient.from('app_settings').upsert({
            setting_key: 'daily_visits',
            setting_value: JSON.stringify(info),
            updated_at: new Date()
        });
    } catch (err) {
        console.warn('تعذر تسجيل زيارة اليوم:', err.message);
    }
}

// تحميل العدّادات (الإجمالي + اليومي) وتحديثها في الواجهة
async function loadVisitsCounters() {
    try {
        const { data } = await supabaseClient
            .from('app_settings')
            .select('setting_key, setting_value')
            .in('setting_key', ['total_visits', 'daily_visits']);

        let total = 0, daily = 0;
        (data || []).forEach(row => {
            if (row.setting_key === 'total_visits') total = Number(row.setting_value) || 0;
            if (row.setting_key === 'daily_visits') {
                try {
                    const info = JSON.parse(row.setting_value || '{}');
                    daily = info.date === todayKey() ? (info.count || 0) : 0;
                } catch (e) { daily = 0; }
            }
        });

        ['totalVisitsCount', 'totalVisitsCount2'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = total;
        });
        const dailyEl = document.getElementById('dailyVisitsCount');
        if (dailyEl) dailyEl.textContent = daily;
    } catch (err) { /* تجاهل */ }
}

// زر التحديث اللحظي
function refreshOnlineVisits() {
    loadVisitsCounters();
    updateOnlineBadge();
}

// زر حذف / تصفير العدّادات
async function resetVisitsCounters() {
    if (!confirm('هل تريد فعلاً تصفير عدّادات الزيارات (الإجمالي + اليومي)؟')) return;
    try {
        await supabaseClient.from('app_settings').upsert([
            { setting_key: 'total_visits', setting_value: '0', updated_at: new Date() },
            { setting_key: 'daily_visits', setting_value: JSON.stringify({ date: todayKey(), count: 0 }), updated_at: new Date() }
        ]);
        await loadVisitsCounters();
        alert('تم تصفير العدّادات بنجاح');
    } catch (err) {
        console.error('خطأ في تصفير العدّادات:', err);
        alert('تعذر تصفير العدّادات: ' + err.message);
    }
}

async function loadTotalVisits() {
    await loadVisitsCounters();
}

// ---------- 5) تهيئة لوحة المؤسس (تحديث لحظي) ----------
function initFounderOnlineTab() {
    if (!appState.user || appState.userData?.account_type !== 'founder') return;
    loadVisitsCounters();
    if (window.__onlineTimer) clearInterval(window.__onlineTimer);
    if (window.__visitsTimer) clearInterval(window.__visitsTimer);
    window.__onlineTimer = setInterval(updateOnlineBadge, 60000);
    // تحديث لحظي للعدّادات + قائمة المتصلين كل 10 ثوانٍ
    window.__visitsTimer = setInterval(() => {
        loadVisitsCounters();
        updateOnlineBadge();
    }, 10000);
}

window.initOnlineTracking = initOnlineTracking;
window.initFounderOnlineTab = initFounderOnlineTab;
window.loadTotalVisits = loadTotalVisits;
window.loadVisitsCounters = loadVisitsCounters;
window.refreshOnlineVisits = refreshOnlineVisits;
window.resetVisitsCounters = resetVisitsCounters;
window.trackDailyVisit = trackDailyVisit;
