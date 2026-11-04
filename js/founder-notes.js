// ============================================================
// MISAR SYSTEMS — نظام ملاحظات المؤسس (Founder Notes)
// ------------------------------------------------------------
// • المؤسس يكتب ملاحظات بتفاصيل كتيرة (عنوان / نص / أولوية / تثبيت).
// • المدير العام يراها للقراءة فقط داخل لوحته (نظرة عامة).
// • التخزين: app_settings بالمفتاح founder_notes_v1 (نص JSON).
// • الحماية: الكتابة للمؤسس فقط (تحقق في الكود + RLS على الخادم)،
//   والمفتاح مدرج في قائمة المفاتيح المحمية في FOUNDER_CONTROL_CENTER.sql.
// ============================================================

(function () {
    'use strict';

    const NOTES_KEY = 'founder_notes_v1';
    const MAX_NOTES = 200;          // حد أقصى لعدد الملاحظات
    const MAX_TITLE = 120;          // أقصى طول للعنوان
    const MAX_BODY = 8000;          // أقصى طول للنص (تفاصيل كتيرة مسموحة)

    const PRIORITY_LABELS = {
        low: { label: 'منخفضة', cls: 'fn-pri-low' },
        normal: { label: 'عادية', cls: 'fn-pri-normal' },
        high: { label: 'هامة', cls: 'fn-pri-high' },
        critical: { label: 'حرجة', cls: 'fn-pri-critical' }
    };

    // من يشوف الملاحظة: all = الكل، فقط_ليا = المؤسس فقط،
    // أو uuid مدير معيّن (مخزّن في target_user_ids)
    const AUDIENCE_LABELS = {
        all: 'كل المدراء',
        only_me: 'ليّا أنا فقط (بدون المدراء)'
    };
    void AUDIENCE_LABELS; // محجوز للاستخدام لاحقاً
    void AUDIENCE_LABELS; // محجوز للاستخدام لاحقاً

    let notesCache = null;          // كاش الملاحظات
    let editingNoteId = null;       // الملاحظة الجاري تعديلها (للمؤسس)

    // ---------- حالة الواجهة (فلترة/بحث/عرض) ----------
    const fnUi = { q: '', status: 'active', tag: '', manager: '', color: '', showArchived: false };

    const NOTE_COLORS = {
        yellow: { label: 'أصفر',   bg: '#fff9e6', border: '#f5c518' },
        blue:   { label: 'أزرق',   bg: '#e8f1ff', border: '#3b82f6' },
        green:  { label: 'أخضر',   bg: '#e9f9ef', border: '#22a06b' },
        red:    { label: 'أحمر',   bg: '#fdeaea', border: '#e35b5b' },
        purple: { label: 'بنفسجي', bg: '#f5edff', border: '#8e5cf6' },
        gray:   { label: 'رمادي',  bg: '#f4f5f7', border: '#94a3b8' }
    };

    const STATUS_LABELS = {
        new:         { label: 'جديدة',       cls: '#1565c0', bg: '#e3f2fd' },
        in_progress: { label: 'قيد التنفيذ', cls: '#e65100', bg: '#fff3e0' },
        completed:   { label: 'مكتملة',      cls: '#2e7d32', bg: '#e8f5e9' }
    };

    // أنماط موحّدة للبطاقات والمودال ولوحة المتابعة
    (function injectNoteStyles() {
        if (document.getElementById('fnNoteStyles')) return;
        const st = document.createElement('style');
        st.id = 'fnNoteStyles';
        st.textContent = `
            .fn-chip{display:inline-block;font-size:0.75rem;padding:2px 10px;border-radius:20px;margin-left:4px;}
            .fn-attach-link{display:inline-flex;align-items:center;gap:6px;background:#f0f2f5;border:1px solid #e0e0e0;border-radius:10px;padding:4px 10px;font-size:0.78rem;color:#1a237e;text-decoration:none;margin-left:6px;margin-top:4px;}
            .fn-attach-link:hover{background:#e8eaf6;}
            .fn-comment{background:#f8f9fa;border:1px solid #eee;border-radius:10px;padding:8px 10px;margin-top:6px;font-size:0.85rem;}
            .fn-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;}
            .fn-modal{background:#fff;border-radius:16px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;padding:20px;}
            @media(max-width:600px){.fn-modal{border-radius:14px;padding:16px;}}
            .fn-dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;}
            .fn-dash-card{background:#fff;border:1px solid #e8e8e8;border-radius:12px;padding:10px;text-align:center;cursor:pointer;transition:box-shadow .2s;}
            .fn-dash-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.08);}
            .fn-dash-num{font-size:1.3rem;font-weight:800;color:#1a237e;}
            .fn-dash-lbl{font-size:0.75rem;color:#666;}
        `;
        document.head.appendChild(st);
    })();

    // ---------- أدوات مساعدة ----------
    function fnEl(id) { return document.getElementById(id); }

    function fnEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
            .replace(/"/g, '"').replace(/'/g, '&#39;');
    }

    // نص إلى HTML مع الحفاظ على الأسطر (نص طويل بتفاصيل)
    function fnBodyToHtml(text) {
        return fnEscape(text).replace(/\n/g, '<br>');
    }

    function fnIsFounder() {
        return typeof misarIsFounder === 'function' && misarIsFounder();
    }

    function fnFmt(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleString('ar-EG', { hour12: true }); }
        catch (e) { return String(iso); }
    }

    // ---------- التحميل والحفظ ----------
    const sb = () => (window.supabaseClient || supabaseClient);
    async function loadFounderNotes(force) {
        if (notesCache && !force) return notesCache;
        try {
            const { data, error } = await sb()
                .from('app_settings')
                .select('setting_value')
                .eq('setting_key', NOTES_KEY)
                .maybeSingle();
            if (error) throw error;
            let val = data && data.setting_value ? data.setting_value : null;
            if (typeof val === 'string') {
                const s = val.trim();
                val = s ? JSON.parse(s) : [];
            }
            notesCache = Array.isArray(val) ? val : [];
        } catch (e) {
            console.warn('تعذر تحميل ملاحظات المؤسس:', e);
            notesCache = notesCache || [];
        }
        return notesCache;
    }

    async function persistNotes(list) {
        if (!fnIsFounder()) throw new Error('صلاحية المؤسس فقط تسمح بالكتابة في الملاحظات.');
        const { error } = await sb()
            .from('app_settings')
            .upsert({
                setting_key: NOTES_KEY,
                setting_value: JSON.stringify(list),
                updated_at: new Date().toISOString()
            }, { onConflict: 'setting_key' });
        if (error) throw error;
        notesCache = list;
        if (typeof logActivity === 'function' && appState.user) {
            await logActivity(appState.user.id, 'founder_notes_updated', {
                section: 'general_manager',
                count: list.length,
                result: 'success'
            });
        }
    }

    // هل يرى الملاحظة المستخدم الحالي؟ (المؤسس يرى كل شيء)
    function fnVisibleTo(n) {
        if (fnIsFounder()) return true;
        if (!appState.user) return false;
        const uid = appState.user.id;
        const aud = n.audience || 'all';
        if (aud === 'only_me') return false;          // ليّا أنا فقط — المدراء لا يرونها
        if (aud === 'all') return true;               // كل المدراء
        const targets = Array.isArray(n.target_user_ids) ? n.target_user_ids : [];
        return targets.includes(uid);                 // مدير محدد: هو فقط
    }

    function fnAudienceText(n) {
        const aud = n.audience || 'all';
        if (aud === 'only_me') return 'ليّا أنا فقط';
        if (aud === 'all') return 'كل المدراء';
        const targets = Array.isArray(n.target_user_ids) ? n.target_user_ids : [];
        const names = ((window.misarGmState && window.misarGmState.gmList) || [])
            .filter(g => targets.includes(g.id))
            .map(g => g.name || g.email || 'مدير');
        return names.length ? names.join('، ') : 'مدير محدد';
    }

    // ---------- لوحة متابعة الملاحظات ----------
    function fnRenderDash(all) {
        const el = fnEl('fnDash');
        if (!el) return;
        const today = new Date();
        const stats = { new: 0, in_progress: 0, completed: 0, overdue: 0, urgent: 0, byManager: {} };
        all.forEach(n => {
            const st = n.status || 'new';
            if (stats[st] !== undefined) stats[st]++;
            if (n.due_date && st !== 'completed' && new Date(n.due_date) < today) stats.overdue++;
            if (n.priority === 'critical' && st !== 'completed') stats.urgent++;
            const mgr = n.updated_by || n.created_by || 'غير محدد';
            stats.byManager[mgr] = (stats.byManager[mgr] || 0) + 1;
        });
        const cards = [
            { key: 'all', lbl: 'الإجمالي', num: all.length },
            { key: 'status=new', lbl: 'جديدة', num: stats.new },
            { key: 'status=in_progress', lbl: 'قيد التنفيذ', num: stats.in_progress },
            { key: 'status=completed', lbl: 'مكتملة', num: stats.completed },
            { key: 'overdue', lbl: 'متأخرة', num: stats.overdue },
            { key: 'urgent', lbl: 'عاجلة', num: stats.urgent }
        ];
        el.innerHTML = '<div class="fn-dash-grid">' + cards.map(c =>
            `<div class="fn-dash-card" onclick="fnDashFilter('${c.key}')"><div class="fn-dash-num">${c.num}</div><div class="fn-dash-lbl">${c.lbl}</div></div>`
        ).join('') + '</div>'
        + '<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:0.8rem;color:#666;">عرض حسب المدير</summary><div style="margin-top:6px;">'
        + Object.entries(stats.byManager).map(([m, c]) => `<span class="fn-chip" style="background:#f0f2f5;color:#444;">${fnEscape(m)}: ${c}</span>`).join('')
        + '</div></details>';
    }

    window.fnDashFilter = function (key) {
        if (key === 'all') { fnUi.status = 'active'; fnUi.tag = ''; fnUi.color = ''; }
        else if (key === 'overdue') { fnUi.status = 'overdue'; }
        else if (key === 'urgent') { fnUi.status = 'active'; fnUi.q = ''; }
        else if (key.startsWith('status=')) { fnUi.status = 'active'; }
        renderFounderNotes();
        const panel = fnEl('fnList'); if (panel) panel.scrollIntoView({ behavior: 'smooth' });
    };

    // ---------- شريط الأدوات (بحث + فلترة + أرشفة + تصدير) ----------
    function fnRenderToolbar() {
        const el = fnEl('fnToolbar');
        if (!el) return;
        const tagOptions = Array.from(new Set(
            (notesCache || []).flatMap(n => Array.isArray(n.tags) ? n.tags : [])
        )).map(t => `<option value="${fnEscape(t)}" ${fnUi.tag === t ? 'selected' : ''}>${fnEscape(t)}</option>`).join('');
        const managers = Array.from(new Set((notesCache || []).map(n => n.updated_by || 'غير محدد')));
        el.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:#f8f9fa;padding:10px;border-radius:14px;border:1px solid #eee;">
            <input id="fnSearch" class="input-field" style="flex:1;min-width:180px;padding:8px;" placeholder="🔍 بحث في العنوان والمحتوى والوسوم..." value="${fnEscape(fnUi.q)}" oninput="fnSearchChanged(this.value)">
            <select id="fnFilterStatus" class="input-field" style="width:auto;padding:8px;">
                <option value="active" ${fnUi.status === 'active' ? 'selected' : ''}>النشطة فقط</option>
                <option value="archived" ${fnUi.status === 'archived' ? 'selected' : ''}>المؤرشفة فقط</option>
                <option value="all" ${fnUi.status === 'all' ? 'selected' : ''}>الكل</option>
            </select>
            <select id="fnFilterTag" class="input-field" style="width:auto;padding:8px;">
                <option value="">كل الوسوم</option>${tagOptions}
            </select>
            <select id="fnFilterManager" class="input-field" style="width:auto;padding:8px;">
                <option value="">كل المدراء</option>
                ${managers.map(m => `<option value="${fnEscape(m)}" ${fnUi.manager === m ? 'selected' : ''}>${fnEscape(m)}</option>`).join('')}
            </select>
            <select id="fnFilterColor" class="input-field" style="width:auto;padding:8px;">
                <option value="">كل الألوان</option>
                ${Object.entries(NOTE_COLORS).map(([k, v]) => `<option value="${k}" ${fnUi.color === k ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
            <button class="refresh-stats-btn" style="width:auto;padding:8px 12px;" onclick="fnOpenStats()" title="الإحصائيات"><i class="fas fa-chart-pie"></i> الإحصائيات</button>
            <button class="refresh-stats-btn" style="width:auto;padding:8px 12px;" onclick="fnExportNotes('csv')" title="تصدير Excel/CSV"><i class="fas fa-file-excel"></i> Excel</button>
            <button class="refresh-stats-btn" style="width:auto;padding:8px 12px;" onclick="fnExportNotes('pdf')" title="تصدير PDF (طباعة)"><i class="fas fa-file-pdf"></i> PDF</button>
        </div>`;
        const s = fnEl('fnSearch');
        if (s && !s.dataset.fnBound) {
            s.dataset.fnBound = '1';
            s.addEventListener('input', () => { fnUi.q = s.value; renderFounderNotesListOnly(); });
        }
        const bind = (id, prop) => {
            const el2 = fnEl(id);
            if (el2 && !el2.dataset.fnBound) { el2.dataset.fnBound = '1'; el2.addEventListener('change', e => { fnUi[prop] = e.target.value; renderFounderNotesListOnly(); }); }
        };
        bind('fnFilterStatus', 'status'); bind('fnFilterTag', 'tag'); bind('fnFilterManager', 'manager'); bind('fnFilterColor', 'color');
    }

    // بحث عبر oninput (مضاعف للأمان مع إعادة بناء شريط الأدوات)
    window.fnSearchChanged = function (v) { fnUi.q = v; renderFounderNotesListOnly(); };

    function fnApplyFilters(notes) {
        let list = [...notes];
        // المحذوفة تظهر فقط في نافذة الإحصائيات ← مربع المحذوفة
        list = list.filter(n => !n.deleted);
        if (fnUi.status === 'active') list = list.filter(n => !n.archived);
        else if (fnUi.status === 'archived') list = list.filter(n => n.archived);
        if (fnUi.tag) list = list.filter(n => Array.isArray(n.tags) && n.tags.includes(fnUi.tag));
        if (fnUi.manager) list = list.filter(n => (n.updated_by || 'غير محدد') === fnUi.manager);
        if (fnUi.color) list = list.filter(n => (n.color || 'yellow') === fnUi.color);
        if (fnUi.q) {
            const q = fnUi.q.toLowerCase();
            list = list.filter(n =>
                (n.title || '').toLowerCase().includes(q) ||
                (n.body || '').toLowerCase().includes(q) ||
                (Array.isArray(n.tags) && n.tags.some(t => t.toLowerCase().includes(q))));
        }
        return list;
    }

    // ---------- تصدير Excel/CSV و PDF ----------
    window.fnExportNotes = function (fmt) {
        const notes = fnApplyFilters(notesCache || []);
        if (!notes.length) return showToast('لا توجد ملاحظات للتصدير', 'warning');
        if (fmt === 'csv') {
            const rows = [['العنوان', 'المحتوى', 'الأولوية', 'الحالة', 'الوسوم', 'مُحدّثة بواسطة', 'آخر تحديث', 'موعد التنفيذ']];
            notes.forEach(n => rows.push([
                n.title || '', (n.body || '').replace(/\n/g, ' '),
                (PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.normal).label,
                (STATUS_LABELS[n.status] || STATUS_LABELS.new).label,
                (n.tags || []).join(' | '), n.updated_by || '', n.updated_at || '', n.due_date || ''
            ]));
            const csv = '\\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            a.download = 'misar-notes-' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            showToast('تم تصدير الملاحظات (Excel/CSV)', 'success');
        } else {
            const w = window.open('', '_blank');
            if (!w) return showToast('الرجاء السماح بالنوافذ المنبثقة', 'warning');
            w.document.write('<html dir="rtl"><head><meta charset="utf-8"><title>ملاحظات MISAR</title><style>body{font-family:Tahoma;padding:24px;}h1{color:#1a237e;}.nc{border:1px solid #ddd;border-radius:10px;padding:12px;margin-bottom:10px;}h3{margin:0 0 6px;color:#1a237e;}small{color:#888;}</style></head><body>');
            w.document.write('<h1>📌 ملاحظات MISAR SYSTEMS (' + new Date().toLocaleDateString('ar-EG') + ')</h1>');
            notes.forEach(n => {
                w.document.write('<div class="nc"><h3>' + fnEscape(n.title || '(بدون عنوان)') + '</h3><div>' + fnBodyToHtml(n.body || '') + '</div><small>'
                    + 'الأولوية: ' + (PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.normal).label
                    + ' | الحالة: ' + (STATUS_LABELS[n.status] || STATUS_LABELS.new).label
                    + ' | بواسطة: ' + fnEscape(n.updated_by || '') + ' | ' + fnFmt(n.updated_at) + '</small></div>');
            });
            w.document.write('</body></html>');
            w.document.close();
            setTimeout(() => w.print(), 400);
        }
    };

    // ---------- واجهة المؤسس ----------
    async function renderFounderNotes() {
        const listEl = fnEl('fnList');
        if (!listEl) return;
        const notes = await loadFounderNotes();
        const countEl = fnEl('fnCount');
        if (countEl) countEl.textContent = String(notes.length);
        fnRenderDash(notes);
        fnRenderToolbar();
        renderFounderNotesListOnly();
    }

    // إعادة رسم القائمة فقط (دون إعادة بناء شريط الأدوات — للحفاظ على التركيز أثناء البحث)
    function renderFounderNotesListOnly() {
        const listEl = fnEl('fnList');
        if (!listEl) return;
        const filtered = fnApplyFilters(notesCache || []);
        const overdueCount = (notesCache || []).filter(n => n.due_date && (n.status || 'new') !== 'completed' && new Date(n.due_date) < new Date()).length;
        if (overdueCount) showToast('⏰ لديك ' + overdueCount + ' ملاحظة متأخرة عن موعد التنفيذ', 'warning');
        if (!filtered.length) {
            listEl.innerHTML = '<p style="text-align:center;color:#666;padding:24px;">لا توجد ملاحظات مطابقة.</p>';
            return;
        }
        const sorted = [...filtered].sort((a, b) => {
            if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
            return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
        });
        listEl.innerHTML = sorted.map(n => fnNoteCardHtml(n, fnIsFounder())).join('');
    }

    // بطاقة ملاحظة موحّدة (تُستخدم للمؤسس والمدير العام)
    function fnNoteCardHtml(n, isFounderView) {
        const pri = PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.normal;
        const st = STATUS_LABELS[n.status || 'new'];
        const color = NOTE_COLORS[n.color || 'yellow'] || NOTE_COLORS.yellow;
        const edited = n.updated_at && n.created_at && n.updated_at !== n.created_at;
        const overdue = n.due_date && (n.status || 'new') !== 'completed' && new Date(n.due_date) < new Date();
        const daysLeft = n.due_date ? Math.ceil((new Date(n.due_date) - new Date()) / 86400000) : null;
        const attachHtml = (Array.isArray(n.attachments) && n.attachments.length)
            ? '<div style="margin-top:6px;">' + n.attachments.map(a =>
                `<a class="fn-attach-link" href="${fnEscape(a.url)}" target="_blank" rel="noopener"><i class="fas ${a.type === 'image' ? 'fa-image' : 'fa-paperclip'}"></i> ${fnEscape(a.name || 'مرفق')}</a>`).join('') + '</div>' : '';
        const tagsHtml = (Array.isArray(n.tags) && n.tags.length)
            ? '<div style="margin-top:6px;">' + n.tags.map(t => `<span class="fn-chip" style="background:#ede7f6;color:#4527a0;"># ${fnEscape(t)}</span>`).join('') + '</div>' : '';
        const commentsCount = Array.isArray(n.comments) ? n.comments.length : 0;
        const deletedView = fnUi && fnUi._deletedView;
        const actionBtns = isFounderView ? (deletedView
            ? `<button class="founder-btn" style="width:auto;padding:5px 10px;" onclick="fnRestore('${n.id}')" title="استعادة"><i class="fas fa-undo"></i> استعادة</button>
               <button class="remove-btn" style="width:auto;padding:5px 10px;" onclick="fnPurge('${n.id}')" title="حذف نهائي"><i class="fas fa-trash"></i></button>`
            : `
            <button class="founder-btn" style="width:auto;padding:5px 10px;" onclick="fnOpenDetail('${n.id}')" title="تفاصيل وتعليقات"><i class="fas fa-comments"></i>${commentsCount ? ' ' + commentsCount : ''}</button>
            <button class="founder-btn" style="width:auto;padding:5px 10px;" onclick="fnStartEdit('${n.id}')" title="تعديل"><i class="fas fa-pen"></i></button>
            <button class="founder-btn" style="width:auto;padding:5px 10px;" onclick="fnTogglePin('${n.id}')" title="${n.pinned ? 'إلغاء التثبيت' : 'تثبيت'}"><i class="fas fa-thumbtack"></i></button>
            <button class="founder-btn" style="width:auto;padding:5px 10px; background:#2e7d32; color:#fff;" onclick="fnMarkCompleted('${n.id}')" title="إنجاز الملاحظة"><i class="fas fa-check-circle"></i> إنجاز</button>
            <button class="founder-btn" style="width:auto;padding:5px 10px;" onclick="fnToggleArchive('${n.id}')" title="${n.archived ? 'استعادة من الأرشيف' : 'أرشفة'}"><i class="fas ${n.archived ? 'fa-box-open' : 'fa-box-archive'}"></i></button>
            <button class="remove-btn" style="width:auto;padding:5px 10px;" onclick="fnDelete('${n.id}')" title="حذف (نقل للمحذوفات)"><i class="fas fa-trash"></i></button>`)
            : '';
        return `
        <div class="fn-card ${n.pinned ? 'fn-card-pinned' : ''}" style="border:1px solid ${n.pinned ? '#f5c518' : '#e0e0e0'}; border-right:5px solid ${color.border}; border-radius:14px; padding:14px; margin-bottom:12px; background:${n.archived ? '#fafafa' : color.bg}; ${n.archived ? 'opacity:.75;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                <div style="flex:1; min-width:180px;">
                    <div style="font-weight:800; color:#1a237e; font-size:1.05rem;">
                        ${n.pinned ? '<i class="fas fa-thumbtack" style="color:#b78103;"></i> ' : ''}
                        ${n.archived ? '<i class="fas fa-box-archive" style="color:#888;"></i> ' : ''}
                        ${fnEscape(n.title || '(بدون عنوان)')}
                    </div>
                    <div style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap;">
                        <span class="fn-chip" style="background:#f0f2f5;color:#444;">${pri.label}</span>
                        ${((n.status || 'new') === 'completed') ? '<span class="fn-chip" style="background:#e8f5e9;color:#2e7d32;"><i class="fas fa-check-double"></i> مُنجزة ✓</span>' : `<span class="fn-chip" style="background:${st.bg};color:${st.cls};">${st.label}</span>`}
                        ${isFounderView ? `<span class="fn-chip" style="background:#e3f2fd;color:#1565c0;"><i class="fas fa-eye"></i> ${fnEscape(fnAudienceText(n))}</span>` : ''}
                        ${overdue ? `<span class="fn-chip" style="background:#ffebee;color:#c62828;"><i class="fas fa-exclamation-triangle"></i> متأخرة</span>`
                            : (daysLeft !== null && daysLeft <= 3 && daysLeft >= 0 && (n.status || 'new') !== 'completed'
                                ? `<span class="fn-chip" style="background:#fff3e0;color:#e65100;"><i class="fas fa-bell"></i> باقي ${daysLeft} يوم</span>` : '')}
                    </div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">${actionBtns}</div>
            <div style="margin-top:10px; color:#333; line-height:1.8; word-break:break-word;">${fnBodyToHtml(n.body || '')}</div>
            ${attachHtml}${tagsHtml}
            ${n.due_date ? `<div style="margin-top:6px;font-size:0.8rem;color:#555;"><i class="fas fa-calendar-check"></i> موعد التنفيذ: <b>${fnFmt(n.due_date)}</b></div>` : ''}
            <div style="margin-top:10px; font-size:0.75rem; color:#888; border-top:1px dashed #ccc; padding-top:8px;">
                <span><i class="fas fa-plus-circle"></i> أُنشئت: ${fnFmt(n.created_at)}</span>
                ${edited ? ` &nbsp;|&nbsp; <span><i class="fas fa-edit"></i> آخر تعديل: ${fnFmt(n.updated_at)}</span>` : ''}
                ${n.updated_by ? ` &nbsp;|&nbsp; <span><i class="fas fa-user"></i> ${fnEscape(n.updated_by)}</span>` : ''}
            </div>
        </div>`;
    }

    // تعبئة قائمة المدراء في اختيار «مين يشوفها»
    async function populateAudienceSelect() {
        const sel = fnEl('fnAudience');
        if (!sel) return;
        const gmList = (typeof misarLoadGmList === 'function')
            ? await misarLoadGmList()
            : ((window.misarGmState && window.misarGmState.gmList) || []);
        window.misarGmState = window.misarGmState || {};
        window.misarGmState.gmList = gmList;
        const specificOpt = sel.querySelector('option[value="specific"]');
        const box = fnEl('fnSpecificUsers');
        if (!box) return;
        if (!gmList.length) {
            if (specificOpt) { specificOpt.disabled = true; specificOpt.textContent = 'مدير محدد (لا يوجد مدراء بعد)'; }
        } else {
            if (specificOpt) { specificOpt.disabled = false; specificOpt.textContent = 'مدير محدد…'; }
            box.innerHTML = gmList.map(g => `
                <label style="display:flex; align-items:center; gap:6px; background:#f0f2f5; padding:6px 10px; border-radius:20px; font-size:0.85rem; cursor:pointer;">
                    <input type="checkbox" class="fn-gm-target" value="${g.id}" style="width:16px; height:16px;">
                    ${fnEscape(g.name || g.email || 'مدير')}
                </label>`).join('');
        }
    }

    window.fnAudienceChanged = function () {
        const sel = fnEl('fnAudience');
        const wrap = fnEl('fnSpecificWrap');
        if (wrap) wrap.style.display = (sel && sel.value === 'specific') ? 'flex' : 'none';
    };

    function resetNoteForm() {
        editingNoteId = null;
        const t = fnEl('fnTitle'), b = fnEl('fnBody'), p = fnEl('fnPriority'), pin = fnEl('fnPinned'), a = fnEl('fnAudience');
        if (t) t.value = '';
        if (b) b.value = '';
        if (p) p.value = 'normal';
        if (pin) pin.checked = false;
        if (a) a.value = 'all';
        const c = fnEl('fnColor'); if (c) c.value = 'yellow';
        const d = fnEl('fnDue'); if (d) d.value = '';
        const tg = fnEl('fnTags'); if (tg) tg.value = '';
        const wrap = fnEl('fnSpecificWrap');
        if (wrap) wrap.style.display = 'none';
        document.querySelectorAll('.fn-gm-target').forEach(c => { c.checked = false; });
        const btn = fnEl('fnSaveBtn');
        if (btn) btn.innerHTML = '<i class="fas fa-save"></i> حفظ الملاحظة';
        const cancel = fnEl('fnCancelEdit');
        if (cancel) cancel.style.display = 'none';
    }

    function collectAudience() {
        const sel = fnEl('fnAudience');
        const aud = sel ? sel.value : 'all';
        if (aud === 'specific') {
            const targets = Array.from(document.querySelectorAll('.fn-gm-target:checked')).map(c => c.value);
            if (!targets.length) return { error: 'اختر مديراً واحداً على الأقل من القائمة.' };
            return { audience: 'specific', target_user_ids: targets };
        }
        return { audience: aud, target_user_ids: [] };
    }

    // توجيه إشعار @منشن لمدير عبر chat_messages
    async function fnNotifyMention(note, mentionedNames) {
        try {
            if (!Array.isArray(note.target_user_ids) || !note.target_user_ids.length) return;
            const rows = note.target_user_ids.map(uid => ({
                pair_key: [appState.user.id, uid].sort().join('_'),
                sender_id: appState.user.id,
                sender_name: appState.userData?.name || 'المؤسس',
                text: '📌 أشار إليك في ملاحظة: "' + (note.title || '(بدون عنوان)') + '"' + (mentionedNames ? ' — ' + mentionedNames : ''),
                created_at: new Date().toISOString()
            }));
            await sb().from('chat_messages').insert(rows);
        } catch (e) { console.warn('تعذر إرسال إشعار المنشن:', e); }
    }

    // استخراج أسماء المدراء المشار إليهم بـ @ من نص الملاحظة
    function fnExtractMentions(text) {
        const gmList = (window.misarGmState && window.misarGmState.gmList) || [];
        const found = [];
        (text || '').split(/@/).slice(1).forEach(part => {
            const word = part.trim().split(/\s/)[0] || '';
            const gm = gmList.find(g => (g.name || '').startsWith(word) && word.length > 1);
            if (gm) found.push(gm);
        });
        return found;
    }

    async function saveNote() {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const title = (fnEl('fnTitle')?.value || '').trim().slice(0, MAX_TITLE);
        const body = (fnEl('fnBody')?.value || '').trim().slice(0, MAX_BODY);
        const priority = fnEl('fnPriority')?.value || 'normal';
        const pinned = !!fnEl('fnPinned')?.checked;
        if (!title && !body) return showToast('اكتب عنواناً أو نص الملاحظة أولاً', 'warning');
        const aud = collectAudience();
        if (aud.error) return showToast(aud.error, 'warning');

        const notes = await loadFounderNotes();
        const now = new Date().toISOString();
        const author = appState.userData?.name || appState.user?.email || 'المؤسس';
        const tagsRaw = (fnEl('fnTags')?.value || '').split(/[,،]/).map(s => s.trim()).filter(Boolean).slice(0, 10);

        if (editingNoteId) {
            const idx = notes.findIndex(n => n.id === editingNoteId);
            if (idx === -1) return showToast('الملاحظة غير موجودة', 'error');
            // سجل تاريخي للتعديل
            const before = notes[idx];
            notes[idx].history = Array.isArray(before.history) ? before.history : [];
            notes[idx].history.push({ at: now, by: author, action: 'edit',
                changes: { title: before.title !== title, body: before.body !== body, priority: before.priority !== priority } });
            notes[idx] = { ...notes[idx], title, body, priority, pinned, audience: aud.audience, target_user_ids: aud.target_user_ids, updated_at: now, updated_by: author };
        } else {
            if (notes.length >= MAX_NOTES) return showToast('وصلت الحد الأقصى لعدد الملاحظات (' + MAX_NOTES + ')', 'warning');
            const mentioned = fnExtractMentions(title + ' ' + body);
            notes.unshift({
                id: (crypto.randomUUID ? crypto.randomUUID() : 'n' + Date.now() + Math.random().toString(16).slice(2)),
                title, body, priority, pinned,
                audience: aud.audience, target_user_ids: aud.target_user_ids,
                attachments: [], comments: [], tags: tagsRaw, history: [{ at: now, by: author, action: 'create' }],
                color: fnEl('fnColor')?.value || 'yellow',
                status: 'new', assignee: aud.audience === 'specific' && aud.target_user_ids?.length === 1 ? aud.target_user_ids[0] : null,
                due_date: fnEl('fnDue')?.value || null,
                created_at: now, updated_at: now, updated_by: author
            });
            const created = notes[0];
            if (mentioned.length && typeof fnNotifyMention === 'function') await fnNotifyMention(created, mentioned.map(m => m.name).join('، '));
        }

        showLoading(true);
        try {
            await persistNotes(notes);
            resetNoteForm();
            await renderFounderNotes();
            showToast(editingNoteId ? 'تم تحديث الملاحظة' : 'تم حفظ الملاحظة', 'success');
        } catch (err) {
            showToast(err.message || 'تعذر الحفظ', 'error');
        } finally {
            showLoading(false);
        }
    }

    window.fnSaveNote = saveNote;

    window.fnStartEdit = async function (id) {
        const notes = await loadFounderNotes();
        const n = notes.find(x => x.id === id);
        if (!n) return;
        await populateAudienceSelect();
        editingNoteId = id;
        const t = fnEl('fnTitle'), b = fnEl('fnBody'), p = fnEl('fnPriority'), pin = fnEl('fnPinned'), a = fnEl('fnAudience');
        if (t) t.value = n.title || '';
        if (b) b.value = n.body || '';
        if (p) p.value = n.priority || 'normal';
        if (pin) pin.checked = !!n.pinned;
        const targets = Array.isArray(n.target_user_ids) ? n.target_user_ids : [];
        if (a) a.value = (n.audience === 'specific' && targets.length) ? 'specific' : (n.audience || 'all');
        document.querySelectorAll('.fn-gm-target').forEach(c => { c.checked = targets.includes(c.value); });
        if (typeof fnAudienceChanged === 'function') fnAudienceChanged();
        const btn = fnEl('fnSaveBtn');
        if (btn) btn.innerHTML = '<i class="fas fa-sync-alt"></i> تحديث الملاحظة';
        const cancel = fnEl('fnCancelEdit');
        if (cancel) cancel.style.display = 'inline-block';
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.fnCancelEdit = function () {
        resetNoteForm();
        showToast('أُلغي التعديل', 'info');
    };

    // زر «إنجاز» — يعيّن الحالة مكتملة (أو يعيدها جديدة إن كانت مكتملة)
    window.fnMarkCompleted = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const notes = await loadFounderNotes();
        const n = notes.find(x => x.id === id);
        if (!n) return;
        const wasCompleted = (n.status || 'new') === 'completed';
        await fnUpdateNote(id, note => {
            note.status = wasCompleted ? 'new' : 'completed';
            note.history = Array.isArray(note.history) ? note.history : [];
            note.history.push({ at: new Date().toISOString(), by: appState.userData?.name || 'المؤسس', action: wasCompleted ? 'reopen' : 'complete' });
        }, wasCompleted ? 'تم إرجاع الملاحظة إلى جديدة' : 'تم إنجاز الملاحظة ✓');
    };

    window.fnTogglePin = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const notes = await loadFounderNotes();
        const n = notes.find(x => x.id === id);
        if (!n) return;
        n.pinned = !n.pinned;
        n.updated_at = new Date().toISOString();
        try {
            await persistNotes(notes);
            await renderFounderNotes();
            showToast(n.pinned ? 'تم تثبيت الملاحظة' : 'تم إلغاء التثبيت', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    };

    window.fnDelete = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        if (!confirm('نقل هذه الملاحظة إلى المحذوفات؟ يمكنك استعادتها لاحقاً من الإحصائيات.')) return;
        await fnUpdateNote(id, n => {
            n.deleted = true;
            n.deleted_at = new Date().toISOString();
            n.history = Array.isArray(n.history) ? n.history : [];
            n.history.push({ at: new Date().toISOString(), by: appState.userData?.name || 'المؤسس', action: 'delete' });
        }, 'تم نقل الملاحظة إلى المحذوفات');
    };

    // استعادة ملاحظة محذوفة (من نافذة الإحصائيات ← مربع المحذوفة)
    window.fnRestore = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        await fnUpdateNote(id, n => { n.deleted = false; n.deleted_at = null; }, 'تم استعادة الملاحظة');
        if (typeof fnOpenStats === 'function' && fnEl('fnModalWrap')?.style.display === 'block') fnOpenStats();
    };

    // حذف نهائي مع تأكيد (المؤسس فقط)
    window.fnPurge = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        if (!confirm('حذف هذه الملاحظة نهائياً؟ لا يمكن التراجع عن هذه العملية!')) return;
        if (!confirm('تأكيد أخير: سيتم الحذف النهائي نهائياً. هل أنت متأكد؟')) return;
        const notes = await loadFounderNotes();
        const next = notes.filter(x => x.id !== id);
        try {
            await persistNotes(next);
            if (typeof fnOpenStats === 'function' && fnEl('fnModalWrap')?.style.display === 'block') fnOpenStats();
            await renderFounderNotes();
            showToast('تم الحذف النهائي', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    };

    // ---------- أرشفة / استعادة ----------
    window.fnToggleArchive = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const notes = await loadFounderNotes();
        const n = notes.find(x => x.id === id);
        if (!n) return;
        n.archived = !n.archived;
        n.updated_at = new Date().toISOString();
        try {
            await persistNotes(notes);
            await renderFounderNotes();
            showToast(n.archived ? 'تم أرشفة الملاحظة' : 'تم استعادة الملاحظة', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    };

    // ---------- نافذة تفاصيل الملاحظة (تعليقات + حالة + مهام + مرفقات) ----------
    window.fnOpenDetail = async function (id) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const notes = await loadFounderNotes();
        const n = notes.find(x => x.id === id);
        if (!n) return;
        const wrap = fnEl('fnModalWrap');
        if (!wrap) return;
        const st = STATUS_LABELS[n.status || 'new'];
        const pri = PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.normal;
        wrap.innerHTML = `
        <div class="fn-modal-bg" onclick="if(event.target===this)this.parentNode.style.display='none'">
            <div class="fn-modal" dir="rtl">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="margin:0;color:#1a237e;"><i class="fas fa-sticky-note"></i> ${fnEscape(n.title || '(بدون عنوان)')}</h3>
                    <button class="remove-btn" style="width:auto;padding:6px 12px;" onclick="document.getElementById('fnModalWrap').style.display='none'"><i class="fas fa-times"></i></button>
                </div>
                <div style="background:${(NOTE_COLORS[n.color || 'yellow'] || NOTE_COLORS.yellow).bg};border-radius:10px;padding:10px;line-height:1.8;word-break:break-word;">${fnBodyToHtml(n.body || '')}</div>
                <div style="margin:10px 0;display:flex;gap:6px;flex-wrap:wrap;">
                    <span class="fn-chip" style="background:#f0f2f5;">${pri.label}</span>
                    <span class="fn-chip" style="background:${st.bg};color:${st.cls};">${st.label}</span>
                    ${fnEscape(fnAudienceText(n)) ? `<span class="fn-chip" style="background:#e3f2fd;color:#1565c0;"><i class="fas fa-eye"></i> ${fnEscape(fnAudienceText(n))}</span>` : ''}
                </div>

                <h4 style="margin:14px 0 6px;"><i class="fas fa-tasks"></i> الحالة والمسؤول وموعد التنفيذ</h4>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <select id="fnDetStatus" class="input-field" style="width:auto;padding:8px;">
                        ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(n.status || 'new') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
                    </select>
                    <input type="date" id="fnDetDue" class="input-field" style="width:auto;padding:8px;" value="${n.due_date ? String(n.due_date).slice(0, 10) : ''}">
                    <button class="refresh-stats-btn" style="width:auto;padding:8px 14px;" onclick="fnSaveDetail('${n.id}')"><i class="fas fa-save"></i> حفظ</button>
                </div>

                <h4 style="margin:14px 0 6px;"><i class="fas fa-tags"></i> الوسوم</h4>
                <div style="display:flex;gap:8px;">
                    <input type="text" id="fnDetTag" class="input-field" style="flex:1;padding:8px;" placeholder="أضف وسماً واضغط إضافة...">
                    <button class="refresh-stats-btn" style="width:auto;padding:8px 14px;" onclick="fnAddTag('${n.id}')"><i class="fas fa-plus"></i></button>
                </div>
                <div style="margin-top:6px;">
                    ${(Array.isArray(n.tags) && n.tags.length) ? n.tags.map((t, i) => `<span class="fn-chip" style="background:#ede7f6;color:#4527a0;"># ${fnEscape(t)} <i class="fas fa-times" style="cursor:pointer;" onclick="fnRemoveTag('${n.id}',${i})"></i></span>`).join('') : '<span style="color:#999;font-size:0.8rem;">لا توجد وسوم</span>'}
                </div>

                <h4 style="margin:14px 0 6px;"><i class="fas fa-paperclip"></i> المرفقات</h4>
                <input type="file" id="fnDetFile" multiple style="font-size:0.85rem;">
                <button class="refresh-stats-btn" style="width:auto;padding:8px 14px;margin-top:6px;" onclick="fnUploadAttachment('${n.id}')"><i class="fas fa-upload"></i> رفع مرفق</button>
                <div style="margin-top:6px;">
                    ${(Array.isArray(n.attachments) && n.attachments.length)
                        ? n.attachments.map((a, i) => `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;"><a class="fn-attach-link" href="${fnEscape(a.url)}" target="_blank" rel="noopener"><i class="fas ${a.type === 'image' ? 'fa-image' : 'fa-paperclip'}"></i> ${fnEscape(a.name)}</a><i class="fas fa-trash" style="cursor:pointer;color:#c62828;" onclick="fnRemoveAttachment('${n.id}',${i})"></i></div>`).join('')
                        : '<span style="color:#999;font-size:0.8rem;">لا توجد مرفقات</span>'}
                </div>

                <h4 style="margin:14px 0 6px;"><i class="fas fa-comments"></i> التعليقات (${Array.isArray(n.comments) ? n.comments.length : 0})</h4>
                <div style="max-height:220px;overflow-y:auto;">
                    ${(Array.isArray(n.comments) && n.comments.length)
                        ? n.comments.map(c => `<div class="fn-comment"><b>${fnEscape(c.by)}</b> <small style="color:#999;">${fnFmt(c.at)}</small><div>${fnEscape(c.text)}</div></div>`).join('')
                        : '<p style="color:#999;font-size:0.85rem;">لا توجد تعليقات بعد.</p>'}
                </div>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <input type="text" id="fnDetComment" class="input-field" style="flex:1;padding:8px;" placeholder="اكتب تعليقاً أو رداً... (@ للإشارة لمدير)">
                    <button class="login-btn" style="width:auto;padding:8px 16px;" onclick="fnAddComment('${n.id}')"><i class="fas fa-paper-plane"></i></button>
                </div>

                <details style="margin-top:14px;"><summary style="cursor:pointer;color:#1a237e;"><i class="fas fa-history"></i> السجل التاريخي (${Array.isArray(n.history) ? n.history.length : 0})</summary>
                    <div style="margin-top:6px;font-size:0.8rem;color:#555;">
                        ${(Array.isArray(n.history) && n.history.length)
                            ? n.history.map(h => `<div>• ${fnEscape(h.action)} — ${fnEscape(h.by || '')} — ${fnFmt(h.at)}</div>`).join('')
                            : '<span style="color:#999;">لا يوجد سجل</span>'}
                    </div>
                </details>
            </div>
        </div>`;
        wrap.style.display = 'block';
    };

    async function fnUpdateNote(id, mutator, successMsg) {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const notes = await loadFounderNotes();
        const n = notes.find(x => x.id === id);
        if (!n) return;
        mutator(n);
        n.updated_at = new Date().toISOString();
        try {
            await persistNotes(notes);
            await renderFounderNotes();
            if (successMsg) showToast(successMsg, 'success');
        } catch (err) { showToast(err.message, 'error'); }
    }

    window.fnSaveDetail = async function (id) {
        const status = fnEl('fnDetStatus')?.value || 'new';
        const due = fnEl('fnDetDue')?.value || null;
        await fnUpdateNote(id, n => { n.status = status; n.due_date = due; }, 'تم حفظ الحالة والموعد');
        window.fnOpenDetail(id); // تحديث النافذة
    };

    window.fnAddTag = async function (id) {
        const tag = (fnEl('fnDetTag')?.value || '').trim();
        if (!tag) return;
        await fnUpdateNote(id, n => { n.tags = Array.isArray(n.tags) ? n.tags : []; if (!n.tags.includes(tag)) n.tags.push(tag); }, 'تمت إضافة الوسم');
        window.fnOpenDetail(id);
    };

    window.fnRemoveTag = async function (id, idx) {
        await fnUpdateNote(id, n => { if (Array.isArray(n.tags)) n.tags.splice(idx, 1); });
        window.fnOpenDetail(id);
    };

    window.fnUploadAttachment = async function (id) {
        const input = fnEl('fnDetFile');
        if (!input || !input.files || !input.files.length) return showToast('اختر ملفاً أولاً', 'warning');
        showLoading(true);
        try {
            const notes = await loadFounderNotes();
            const n = notes.find(x => x.id === id);
            if (!n) return;
            n.attachments = Array.isArray(n.attachments) ? n.attachments : [];
            for (const f of input.files) {
                const path = 'notes/' + id + '/' + Date.now() + '_' + f.name.replace(/[^\w.\-؀-ۿ]/g, '_');
                const { error } = await sb().storage.from('attachments').upload(path, f, { upsert: true });
                if (error) throw error;
                const { data: pub } = sb().storage.from('attachments').getPublicUrl(path);
                n.attachments.push({ name: f.name, url: pub.publicUrl, type: f.type.startsWith('image/') ? 'image' : 'file', at: new Date().toISOString() });
            }
            n.updated_at = new Date().toISOString();
            await persistNotes(notes);
            await renderFounderNotes();
            window.fnOpenDetail(id);
            showToast('تم رفع المرفقات', 'success');
        } catch (err) {
            showToast('تعذر رفع المرفق: ' + (err.message || ''), 'error');
        } finally { showLoading(false); }
    };

    window.fnRemoveAttachment = async function (id, idx) {
        await fnUpdateNote(id, n => { if (Array.isArray(n.attachments)) n.attachments.splice(idx, 1); }, 'تم حذف المرفق');
        window.fnOpenDetail(id);
    };

    window.fnAddComment = async function (id) {
        const inp = fnEl('fnDetComment');
        const text = (inp?.value || '').trim();
        if (!text) return;
        const author = appState.userData?.name || appState.user?.email || 'المؤسس';
        const mentioned = fnExtractMentions(text);
        if (mentioned.length) {
            const notes0 = await loadFounderNotes();
            const n0 = notes0.find(x => x.id === id);
            if (n0 && Array.isArray(n0.target_user_ids) && n0.target_user_ids.length) {
                // منشن داخل تعليق: أبلغ المستهدفين المعروفين في الملاحظة فقط
                const ids = n0.target_user_ids.filter(uid => mentioned.some(m => m.id === uid));
                if (ids.length) await fnNotifyMention({ target_user_ids: ids, title: (n0.title || '') + ' (تعليق جديد)' }, mentioned.map(m => m.name).join('، '));
            }
        }
        await fnUpdateNote(id, n => {
            n.comments = Array.isArray(n.comments) ? n.comments : [];
            n.comments.push({ text, by: author, at: new Date().toISOString() });
        }, 'تمت إضافة التعليق');
        window.fnOpenDetail(id);
    };

    // تهيئة تبويب المؤسس
    window.initFounderNotes = async function () {
        resetNoteForm();
        await populateAudienceSelect();
        // التحميل المباشر من الخادم قبل أي رسم حتى لا تعتمد على كاش قديم
        await loadFounderNotes(true);
        await renderFounderNotes();
        renderFounderNotesListOnly();
        if (typeof initFounderGmChat === 'function') initFounderGmChat();
        // تنبيه ذكي عند اقتراب/تجاوز موعد التنفيذ
        setTimeout(() => {
            const today = new Date();
            const soon = (notesCache || []).filter(n => n.due_date && (n.status || 'new') !== 'completed');
            const overdue = soon.filter(n => new Date(n.due_date) < today);
            const near = soon.filter(n => { const d = (new Date(n.due_date) - today) / 86400000; return d >= 0 && d <= 2; });
            if (overdue.length) showToast('⏰ تنبيه: ' + overdue.length + ' ملاحظة متأخرة عن موعد التنفيذ!', 'error');
            else if (near.length) showToast('🔔 تذكير: ' + near.length + ' ملاحظة موعدها خلال يومين', 'warning');
        }, 1500);
    };

    // تحميل الملاحظات تلقائياً عند فتح التطبيق (بدون انتظار ضغطة على التبويب)
    window.initFounderNotesSilent = async function () {
        try {
            await loadFounderNotes(true);
            // لو تبويب الملاحظات ظاهر حالياً أعِد رسمه؛ وإلا الكاش جاهز لأي فتح لاحق
            const panel = fnEl('tab-founder-notes');
            if (panel && panel.classList.contains('active')) {
                renderFounderNotesListOnly();
            }
        } catch (e) { console.warn('تعذر التحميل المبكر للملاحظات:', e); }
    };

    // ---------- واجهة المدير العام (قراءة فقط) ----------
    async function renderFounderNotesForGm() {
        const container = fnEl('gmFounderNotesList');
        if (!container) return;
        // فلترة: المدير يرى فقط الملاحظات الموجهة له أو للكل — «ليّا أنا فقط» مخفية، والمحذوفة مخفية
        const all = await loadFounderNotes(true);
        const notes = all.filter(fnVisibleTo).filter(n => !n.deleted);
        const head = `
            <div class="founder-card" style="border-right:4px solid #D4AF37;">
                <h3><i class="fas fa-sticky-note"></i> ملاحظات من المؤسس</h3>
                <p style="color:#666; font-size:0.85rem;">تعليمات وتوجيهات موجّهة إليك (أو لكل المدراء) — للقراءة فقط. أي تحديث للصلاحيات أو المهام يُبنى على هذه الملاحظات.</p>
            </div>`;
        if (!notes.length) {
            container.innerHTML = head + '<p style="text-align:center;color:#666;padding:20px;">لا توجد ملاحظات موجّهة إليك حالياً.</p>';
            return;
        }
        const sorted = [...notes].sort((a, b) => {
            if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
            return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
        });
        // زر الإحصائيات للمدير (تظهر فيه ملاحظاته المصرح بها فقط)
        const statsBtn = `<div style="margin-top:10px;"><button class="refresh-stats-btn" style="width:auto;padding:8px 14px;" onclick="fnOpenStats()"><i class="fas fa-chart-pie"></i> الإحصائيات</button></div>`;
        container.innerHTML = head + statsBtn + sorted.map(n => fnNoteCardHtml(n, false)).join('');
    }

    // ============================================================
    // الإحصائيات — نافذة مستقلة بمربعات ورسوم بيانية
    // ============================================================
    window.fnOpenStats = async function () {
        if (!appState.user) return showToast('سجل دخولك أولاً', 'error');
        const all = await loadFounderNotes(true);
        notesCache = all;
        const wrap = fnEl('fnModalWrap');
        if (!wrap) return;
        const today = new Date();
        const visible = (fnIsFounder() ? all : all.filter(fnVisibleTo)).filter(n => !n.deleted);
        const deleted = fnIsFounder() ? all.filter(n => n.deleted) : [];
        const stats = {
            total: visible.length,
            new: visible.filter(n => (n.status || 'new') === 'new').length,
            in_progress: visible.filter(n => n.status === 'in_progress').length,
            completed: visible.filter(n => n.status === 'completed').length,
            urgent: visible.filter(n => n.priority === 'critical' && (n.status || 'new') !== 'completed').length,
            overdue: visible.filter(n => n.due_date && (n.status || 'new') !== 'completed' && new Date(n.due_date) < today).length,
            archived: visible.filter(n => n.archived).length,
            deleted: deleted.length,
            unanswered: visible.filter(n => (n.status || 'new') !== 'completed' && (!Array.isArray(n.comments) || !n.comments.length)).length,
            byManager: {}
        };
        visible.forEach(n => {
            const m = n.updated_by || 'غير محدد';
            stats.byManager[m] = (stats.byManager[m] || 0) + 1;
        });
        // معدل الإنجاز
        const doneRate = stats.total ? Math.round(stats.completed / stats.total * 100) : 0;

        const cards = [
            { key: 'all', lbl: 'الإجمالي', num: stats.total, color: '#1a237e', bg: '#e8eaf6' },
            { key: 'status=new', lbl: 'جديدة', num: stats.new, color: '#1565c0', bg: '#e3f2fd' },
            { key: 'status=in_progress', lbl: 'قيد التنفيذ', num: stats.in_progress, color: '#e65100', bg: '#fff3e0' },
            { key: 'status=completed', lbl: 'مكتملة', num: stats.completed, color: '#2e7d32', bg: '#e8f5e9' },
            { key: 'urgent', lbl: 'عاجلة', num: stats.urgent, color: '#b71c1c', bg: '#ffebee' },
            { key: 'overdue', lbl: 'متأخرة', num: stats.overdue, color: '#bf360c', bg: '#fbe9e7' },
            { key: 'archived', lbl: 'مؤرشفة', num: stats.archived, color: '#5d4037', bg: '#efebe9' },
            { key: 'deleted', lbl: 'المحذوفة', num: stats.deleted, color: '#37474f', bg: '#eceff1' },
            { key: 'unanswered', lbl: 'بدون رد', num: stats.unanswered, color: '#4a148c', bg: '#f3e5f5' }
        ];
        const managerCards = Object.entries(stats.byManager).map(([m, c], i) =>
            ({ key: 'manager=' + m, lbl: m, num: c, color: '#00695c', bg: '#e0f2f1' }));

        wrap.innerHTML = `
        <div class="fn-modal-bg" onclick="if(event.target===this)fnCloseStats()">
            <div class="fn-modal" dir="rtl" style="max-width:860px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap;">
                    <h3 style="margin:0;color:#1a237e;"><i class="fas fa-chart-pie"></i> الإحصائيات</h3>
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <input type="date" id="fnStatsFrom" class="input-field" style="width:auto;padding:7px;" title="من تاريخ" onchange="fnStatsApplyFilter()">
                        <input type="date" id="fnStatsTo" class="input-field" style="width:auto;padding:7px;" title="إلى تاريخ" onchange="fnStatsApplyFilter()">
                        <select id="fnStatsManager" class="input-field" style="width:auto;padding:7px;" onchange="fnStatsApplyFilter()">
                            <option value="">كل المدراء</option>
                            ${Object.keys(stats.byManager).map(m => `<option>${fnEscape(m)}</option>`).join('')}
                        </select>
                        <button class="refresh-stats-btn" style="width:auto;padding:7px 12px;" onclick="fnExportStats('csv')" title="تصدير Excel"><i class="fas fa-file-excel"></i></button>
                        <button class="refresh-stats-btn" style="width:auto;padding:7px 12px;" onclick="fnExportStats('pdf')" title="تصدير PDF"><i class="fas fa-file-pdf"></i></button>
                        <button class="refresh-stats-btn" style="width:auto;padding:7px 12px;" onclick="fnOpenStats()" title="تحديث"><i class="fas fa-sync-alt"></i></button>
                        <button class="remove-btn" style="width:auto;padding:7px 14px;" onclick="fnCloseStats()" title="رجوع"><i class="fas fa-arrow-right"></i></button>
                    </div>
                </div>

                <div id="fnStatsCards" class="fn-dash-grid" style="margin-bottom:16px;">
                    ${cards.concat(managerCards).map(c =>
                        `<div class="fn-dash-card" onclick="fnStatsShow('${fnEscape(c.key).replace(/'/g, "")}')" style="background:${c.bg};">
                            <div class="fn-dash-num" style="color:${c.color};font-size:1.6rem;">${c.num}</div>
                            <div class="fn-dash-lbl" style="color:${c.color};font-weight:700;">${fnEscape(c.lbl)}</div>
                        </div>`).join('')}
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">
                    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:12px;">
                        <h4 style="margin:0 0 8px;color:#1a237e;"><i class="fas fa-chart-line"></i> الملاحظات خلال الفترة</h4>
                        <canvas id="fnChartTimeline" height="180"></canvas>
                        <div style="display:flex;gap:6px;margin-top:8px;justify-content:center;">
                            <button class="filter-btn fn-range-btn" style="padding:4px 12px;border-radius:20px;font-size:0.8rem;background:#e3f2fd;color:#1565c0;border:1px solid #90caf9;" onclick="fnStatsRange('day')">يومي</button>
                            <button class="filter-btn fn-range-btn" style="padding:4px 12px;border-radius:20px;font-size:0.8rem;background:#f0f2f5;color:#444;border:1px solid #ddd;" onclick="fnStatsRange('week')">أسبوعي</button>
                            <button class="filter-btn fn-range-btn" style="padding:4px 12px;border-radius:20px;font-size:0.8rem;background:#f0f2f5;color:#444;border:1px solid #ddd;" onclick="fnStatsRange('month')">شهري</button>
                        </div>
                    </div>
                    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:12px;">
                        <h4 style="margin:0 0 8px;color:#1a237e;"><i class="fas fa-balance-scale"></i> جديدة مقابل مكتملة</h4>
                        <canvas id="fnChartCompare" height="180"></canvas>
                    </div>
                    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:12px;">
                        <h4 style="margin:0 0 8px;color:#1a237e;"><i class="fas fa-users"></i> التوزيع حسب المدير</h4>
                        <canvas id="fnChartManager" height="180"></canvas>
                    </div>
                    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:12px;">
                        <h4 style="margin:0 0 8px;color:#1a237e;"><i class="fas fa-tags"></i> حسب الأولوية والحالة</h4>
                        <canvas id="fnChartPriStatus" height="180"></canvas>
                    </div>
                    <div style="background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:12px;grid-column:1/-1;">
                        <h4 style="margin:0 0 8px;color:#1a237e;"><i class="fas fa-trophy"></i> معدل الإنجاز: <span style="color:#2e7d32;font-weight:800;">${doneRate}%</span></h4>
                        <div style="background:#eee;border-radius:20px;height:22px;overflow:hidden;"><div style="background:linear-gradient(90deg,#66bb6a,#2e7d32);height:100%;width:${doneRate}%;transition:width .4s;"></div></div>
                    </div>
                </div>

                <div id="fnStatsList" style="margin-top:14px;"></div>
            </div>
        </div>`;
        wrap.style.display = 'block';

        // حفظ نسخة للفلاتر والرسوم
        window.__fnStatsAll = all;
        fnStatsDrawCharts(visible);
    };

    window.fnCloseStats = function () {
        const wrap = fnEl('fnModalWrap');
        if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
        // تنظيف مخططات chart.js
        (window.__fnCharts || []).forEach(c => { try { c.destroy(); } catch (e) { } });
        window.__fnCharts = [];
    };

    // تطبيق فلتر التاريخ/المدير على الرسوم
    function fnStatsFiltered() {
        const from = fnEl('fnStatsFrom')?.value;
        const to = fnEl('fnStatsTo')?.value;
        const mgr = fnEl('fnStatsManager')?.value || '';
        let list = (fnIsFounder() ? (window.__fnStatsAll || []) : (window.__fnStatsAll || []).filter(fnVisibleTo)).filter(n => !n.deleted);
        if (from) list = list.filter(n => (n.created_at || '') >= from);
        if (to) list = list.filter(n => (n.created_at || '').slice(0, 10) <= to);
        if (mgr) list = list.filter(n => (n.updated_by || 'غير محدد') === mgr);
        return list;
    }

    window.fnStatsApplyFilter = function () {
        const list = fnStatsFiltered();
        fnStatsDrawCharts(list);
        // تحديث أرقام البطاقات أيضاً
        const today = new Date();
        const s = {
            total: list.length,
            new: list.filter(n => (n.status || 'new') === 'new').length,
            in_progress: list.filter(n => n.status === 'in_progress').length,
            completed: list.filter(n => n.status === 'completed').length,
            urgent: list.filter(n => n.priority === 'critical' && (n.status || 'new') !== 'completed').length,
            overdue: list.filter(n => n.due_date && (n.status || 'new') !== 'completed' && new Date(n.due_date) < today).length,
            archived: list.filter(n => n.archived).length,
            unanswered: list.filter(n => (n.status || 'new') !== 'completed' && (!Array.isArray(n.comments) || !n.comments.length)).length
        };
        const map = { 'all': s.total, 'status=new': s.new, 'status=in_progress': s.in_progress, 'status=completed': s.completed, 'urgent': s.urgent, 'overdue': s.overdue, 'archived': s.archived, 'unanswered': s.unanswered };
        document.querySelectorAll('#fnStatsCards .fn-dash-card').forEach(card => {
            const onclick = card.getAttribute('onclick') || '';
            const m = onclick.match(/fnStatsShow\('([^']+)'\)/);
            if (m && map[m[1]] !== undefined) {
                card.querySelector('.fn-dash-num').textContent = map[m[1]];
            }
        });
    };

    window.fnStatsRange = function (unit) {
        document.querySelectorAll('.fn-range-btn').forEach(b => {
            b.style.background = '#f0f2f5'; b.style.color = '#444';
        });
        const btns = document.querySelectorAll('.fn-range-btn');
        const idx = { day: 0, week: 1, month: 2 }[unit];
        if (btns[idx]) { btns[idx].style.background = '#e3f2fd'; btns[idx].style.color = '#1565c0'; }
        window.__fnStatsRange = unit;
        fnStatsDrawCharts(fnStatsFiltered());
    };

    function fnStatsDrawCharts(visible) {
        if (typeof Chart === 'undefined') return;
        (window.__fnCharts || []).forEach(c => { try { c.destroy(); } catch (e) { } });
        window.__fnCharts = [];
        const unit = window.__fnStatsRange || 'day';

        // 1. خط زمني
        const buckets = {};
        const fmtKey = d => {
            const dt = new Date(d);
            if (unit === 'day') return dt.toISOString().slice(0, 10);
            if (unit === 'week') { const w = new Date(dt); w.setDate(dt.getDate() - dt.getDay()); return w.toISOString().slice(0, 10); }
            return dt.toISOString().slice(0, 7);
        };
        visible.forEach(n => {
            const k = fmtKey(n.created_at || n.updated_at);
            buckets[k] = (buckets[k] || 0) + 1;
        });
        const tlLabels = Object.keys(buckets).sort();
        const c1 = new Chart(fnEl('fnChartTimeline'), {
            type: 'line',
            data: { labels: tlLabels, datasets: [{ label: 'عدد الملاحظات', data: tlLabels.map(k => buckets[k]), borderColor: '#1a237e', backgroundColor: 'rgba(26,35,126,.1)', fill: true, tension: .3 }] },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });

        // 2. جديدة مقابل مكتملة
        const nc = visible.filter(n => (n.status || 'new') === 'new').length;
        const cc = visible.filter(n => n.status === 'completed').length;
        const ipc = visible.filter(n => n.status === 'in_progress').length;
        const c2 = new Chart(fnEl('fnChartCompare'), {
            type: 'bar',
            data: { labels: ['جديدة', 'قيد التنفيذ', 'مكتملة'], datasets: [{ label: 'عدد', data: [nc, ipc, cc], backgroundColor: ['#1565c0', '#e65100', '#2e7d32'] }] },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });

        // 3. توزيع حسب المدير
        const byM = {};
        visible.forEach(n => { const m = n.updated_by || 'غير محدد'; byM[m] = (byM[m] || 0) + 1; });
        const palette = ['#1a237e', '#e65100', '#2e7d32', '#6a1b9a', '#00838f', '#c62828'];
        const c3 = new Chart(fnEl('fnChartManager'), {
            type: 'doughnut',
            data: { labels: Object.keys(byM), datasets: [{ data: Object.values(byM), backgroundColor: Object.keys(byM).map((_, i) => palette[i % palette.length]) }] },
            options: { responsive: true }
        });

        // 4. حسب الأولوية والحالة
        const priCount = { low: 0, normal: 0, high: 0, critical: 0 };
        visible.forEach(n => { const p = n.priority || 'normal'; if (priCount[p] !== undefined) priCount[p]++; });
        const c4 = new Chart(fnEl('fnChartPriStatus'), {
            type: 'bar',
            data: {
                labels: ['منخفضة', 'عادية', 'هامة', 'حرجة'],
                datasets: [
                    { label: 'الأولوية', data: [priCount.low, priCount.normal, priCount.high, priCount.critical], backgroundColor: ['#90a4ae', '#42a5f5', '#ffb74d', '#ef5350'] },
                    { label: 'مكتملة', data: [0, 0, 0, 0].map((_, i) => visible.filter(n => (n.priority || 'normal') === ['low', 'normal', 'high', 'critical'][i] && n.status === 'completed').length), backgroundColor: '#66bb6a' }
                ]
            },
            options: { responsive: true }
        });

        window.__fnCharts = [c1, c2, c3, c4];
    }

    // عند الضغط على مربع إحصائي: عرض الملاحظات المرتبطة
    window.fnStatsShow = async function (key) {
        const all = await loadFounderNotes(true);
        window.__fnStatsAll = all;
        const today = new Date();
        let list;
        const isDeletedView = key === 'deleted';
        if (key === 'all') list = all.filter(n => !n.deleted);
        else if (key === 'deleted') list = all.filter(n => n.deleted);
        else if (key === 'overdue') list = all.filter(n => !n.deleted && n.due_date && (n.status || 'new') !== 'completed' && new Date(n.due_date) < today);
        else if (key === 'urgent') list = all.filter(n => !n.deleted && n.priority === 'critical' && (n.status || 'new') !== 'completed');
        else if (key === 'archived') list = all.filter(n => !n.deleted && n.archived);
        else if (key === 'unanswered') list = all.filter(n => !n.deleted && (n.status || 'new') !== 'completed' && (!Array.isArray(n.comments) || !n.comments.length));
        else if (key.startsWith('status=')) list = all.filter(n => !n.deleted && (n.status || 'new') === key.split('=')[1]);
        else if (key.startsWith('manager=')) list = all.filter(n => !n.deleted && (n.updated_by || 'غير محدد') === key.slice(8));
        else list = [];
        // احترام صلاحية المدير: إخفاء الخاصة
        if (!fnIsFounder()) list = list.filter(fnVisibleTo);
        fnUi._deletedView = isDeletedView && fnIsFounder();
        const el = fnEl('fnStatsList');
        if (!el) return;
        if (!list.length) { el.innerHTML = '<p style="text-align:center;color:#999;padding:14px;">لا توجد ملاحظات في هذا التصنيف.</p>'; fnUi._deletedView = false; return; }
        const restoreBtn = isDeletedView && fnIsFounder()
            ? ' <button class="refresh-stats-btn" style="width:auto;padding:5px 10px;font-size:0.75rem;" onclick="fnRestoreAllDeleted()"><i class="fas fa-undo"></i> استعادة الكل</button>'
            : '';
        el.innerHTML = '<h4 style="color:#1a237e;"><i class="fas fa-list"></i> الملاحظات (' + list.length + ')'
            + restoreBtn
            + ' <button class="refresh-stats-btn" style="width:auto;padding:5px 10px;font-size:0.75rem;" onclick="document.getElementById(\'fnStatsList\').innerHTML=\'\'">إخفاء</button></h4>'
            + list.map(n => fnNoteCardHtml(n, fnIsFounder())).join('');
        fnUi._deletedView = false;
    };

    window.fnRestoreAllDeleted = async function () {
        if (!fnIsFounder()) return showToast('صلاحية المؤسس فقط', 'error');
        const notes = await loadFounderNotes(true);
        const now = new Date().toISOString();
        let count = 0;
        notes.forEach(n => { if (n.deleted) { n.deleted = false; n.deleted_at = null; count++; } });
        if (!count) return showToast('لا توجد ملاحظات محذوفة', 'info');
        try {
            await persistNotes(notes);
            await fnOpenStats();
            showToast('تم استعادة ' + count + ' ملاحظة', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    };

    // تصدير الإحصائيات
    window.fnExportStats = function (fmt) {
        const list = fnStatsFiltered();
        if (!list.length) return showToast('لا توجد بيانات للتصدير', 'warning');
        if (fmt === 'csv') {
            const rows = [['العنوان', 'الحالة', 'الأولوية', 'بواسطة', 'تاريخ الإنشاء', 'موعد التنفيذ', 'تعليقات']];
            list.forEach(n => rows.push([
                n.title || '', (STATUS_LABELS[n.status || 'new']).label,
                (PRIORITY_LABELS[n.priority || 'normal']).label,
                n.updated_by || '', n.created_at || '', n.due_date || '',
                Array.isArray(n.comments) ? n.comments.length : 0
            ]));
            const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            a.download = 'misar-notes-stats-' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            showToast('تم تصدير الإحصائيات', 'success');
        } else {
            const w = window.open('', '_blank');
            if (!w) return showToast('الرجاء السماح بالنوافذ المنبثقة', 'warning');
            const today = new Date();
            const s = {
                total: list.length,
                completed: list.filter(n => n.status === 'completed').length,
                overdue: list.filter(n => n.due_date && (n.status || 'new') !== 'completed' && new Date(n.due_date) < today).length
            };
            w.document.write('<html dir="rtl"><head><meta charset="utf-8"><title>إحصائيات الملاحظات</title><style>body{font-family:Tahoma;padding:24px}h1{color:#1a237e}.card{display:inline-block;border:1px solid #ddd;border-radius:10px;padding:14px 22px;margin:6px;text-align:center}.num{font-size:2rem;font-weight:800;color:#1a237e}</style></head><body>');
            w.document.write('<h1>📊 إحصائيات الملاحظات — ' + new Date().toLocaleDateString('ar-EG') + '</h1>');
            w.document.write('<div class="card"><div class="num">' + s.total + '</div>إجمالي</div>');
            w.document.write('<div class="card"><div class="num">' + s.completed + '</div>مكتملة</div>');
            w.document.write('<div class="card"><div class="num">' + s.overdue + '</div>متأخرة</div>');
            w.document.write('<h2>تفاصيل الملاحظات</h2>');
            list.forEach(n => w.document.write('<p><b>' + fnEscape(n.title || '') + '</b> — ' + (STATUS_LABELS[n.status || 'new']).label + ' — ' + fnEscape(n.updated_by || '') + '</p>'));
            w.document.write('</body></html>');
            w.document.close();
            setTimeout(() => w.print(), 400);
        }
    };

    // تصدير للاستخدام العام
    window.loadFounderNotes = loadFounderNotes;
    window.renderFounderNotesForGm = renderFounderNotesForGm;
})();
