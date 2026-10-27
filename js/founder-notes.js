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
    async function loadFounderNotes(force) {
        if (notesCache && !force) return notesCache;
        try {
            const { data, error } = await supabaseClient
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
        const { error } = await supabaseClient
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

    // ---------- واجهة المؤسس ----------
    async function renderFounderNotes() {
        const listEl = fnEl('fnList');
        if (!listEl) return;
        const notes = await loadFounderNotes();
        const countEl = fnEl('fnCount');
        if (countEl) countEl.textContent = String(notes.length);

        if (!notes.length) {
            listEl.innerHTML = '<p style="text-align:center;color:#666;padding:24px;">لا توجد ملاحظات بعد. اكتب أول ملاحظة من النموذج أعلاه.</p>';
            return;
        }

        // التثبيت أولاً ثم الأحدث تعديلاً
        const sorted = [...notes].sort((a, b) => {
            if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
            return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
        });

        listEl.innerHTML = sorted.map(n => {
            const pri = PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.normal;
            const edited = n.updated_at && n.created_at && n.updated_at !== n.created_at;
            return `
            <div class="fn-card ${n.pinned ? 'fn-card-pinned' : ''}" style="border:1px solid #e0e0e0; border-radius:14px; padding:14px; margin-bottom:12px; background:${n.pinned ? '#fff8e1' : '#fff'};">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:180px;">
                        <div style="font-weight:800; color:#1a237e; font-size:1.05rem;">
                            ${n.pinned ? '<i class="fas fa-thumbtack" style="color:#b78103;"></i> ' : ''}${fnEscape(n.title || '(بدون عنوان)')}
                        </div>
                        <div style="margin-top:4px; display:flex; gap:6px; flex-wrap:wrap;">
                            <span class="${pri.cls}" style="display:inline-block; font-size:0.75rem; padding:2px 10px; border-radius:20px; background:#f0f2f5; color:#444;">${pri.label}</span>
                            <span style="display:inline-block; font-size:0.75rem; padding:2px 10px; border-radius:20px; background:#e3f2fd; color:#1565c0;">
                                <i class="fas fa-eye"></i> ${fnEscape(fnAudienceText(n))}
                            </span>
                        </div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="founder-btn" style="width:auto; padding:5px 10px;" onclick="fnStartEdit('${n.id}')" title="تعديل"><i class="fas fa-pen"></i></button>
                        <button class="founder-btn" style="width:auto; padding:5px 10px;" onclick="fnTogglePin('${n.id}')" title="${n.pinned ? 'إلغاء التثبيت' : 'تثبيت'}"><i class="fas fa-thumbtack"></i></button>
                        <button class="remove-btn" style="width:auto; padding:5px 10px;" onclick="fnDelete('${n.id}')" title="حذف"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div style="margin-top:10px; color:#333; line-height:1.8; white-space:normal; word-break:break-word;">${fnBodyToHtml(n.body || '')}</div>
                <div style="margin-top:10px; font-size:0.75rem; color:#888; border-top:1px dashed #eee; padding-top:8px;">
                    <span><i class="fas fa-plus-circle"></i> أُنشئت: ${fnFmt(n.created_at)}</span>
                    ${edited ? ` &nbsp;|&nbsp; <span><i class="fas fa-edit"></i> آخر تعديل: ${fnFmt(n.updated_at)}</span>` : ''}
                    ${n.updated_by ? ` &nbsp;|&nbsp; <span><i class="fas fa-user"></i> ${fnEscape(n.updated_by)}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    // تعبئة قائمة المدراء في اختيار «مين يشوفها»
    async function populateAudienceSelect() {
        const sel = fnEl('fnAudience');
        if (!sel) return;
        const gmList = (typeof misarLoadGmList === 'function')
            ? await misarLoadGmList()
            : ((window.misarGmState && window.misarGmState.gmList) || []);
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

        if (editingNoteId) {
            const idx = notes.findIndex(n => n.id === editingNoteId);
            if (idx === -1) return showToast('الملاحظة غير موجودة', 'error');
            notes[idx] = { ...notes[idx], title, body, priority, pinned, audience: aud.audience, target_user_ids: aud.target_user_ids, updated_at: now, updated_by: author };
        } else {
            if (notes.length >= MAX_NOTES) return showToast('وصلت الحد الأقصى لعدد الملاحظات (' + MAX_NOTES + ')', 'warning');
            notes.unshift({
                id: (crypto.randomUUID ? crypto.randomUUID() : 'n' + Date.now() + Math.random().toString(16).slice(2)),
                title, body, priority, pinned,
                audience: aud.audience, target_user_ids: aud.target_user_ids,
                created_at: now, updated_at: now, updated_by: author
            });
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
        if (!confirm('حذف هذه الملاحظة نهائياً؟')) return;
        const notes = await loadFounderNotes();
        const next = notes.filter(x => x.id !== id);
        try {
            await persistNotes(next);
            if (editingNoteId === id) resetNoteForm();
            await renderFounderNotes();
            showToast('تم حذف الملاحظة', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    };

    // تهيئة تبويب المؤسس
    window.initFounderNotes = async function () {
        resetNoteForm();
        await populateAudienceSelect();
        await renderFounderNotes();
        if (typeof initNoteAiChat === 'function') initNoteAiChat();
        if (typeof initFounderGmChat === 'function') initFounderGmChat();
    };

    // ---------- واجهة المدير العام (قراءة فقط) ----------
    async function renderFounderNotesForGm() {
        const container = fnEl('gmFounderNotesList');
        if (!container) return;
        // فلترة: المدير يرى فقط الملاحظات الموجهة له أو للكل — «ليّا أنا فقط» مخفية
        const all = await loadFounderNotes();
        const notes = all.filter(fnVisibleTo);
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
        container.innerHTML = head + sorted.map(n => {
            const pri = PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.normal;
            const edited = n.updated_at && n.created_at && n.updated_at !== n.created_at;
            return `
            <div class="fn-card" style="border:1px solid #e0e0e0; border-radius:14px; padding:14px; margin-bottom:12px; background:${n.pinned ? '#fff8e1' : '#fff'};">
                <div style="font-weight:800; color:#1a237e; font-size:1.05rem;">
                    ${n.pinned ? '<i class="fas fa-thumbtack" style="color:#b78103;"></i> ' : ''}${fnEscape(n.title || '(بدون عنوان)')}
                </div>
                <div style="margin-top:4px;">
                    <span style="display:inline-block; font-size:0.75rem; padding:2px 10px; border-radius:20px; background:#f0f2f5; color:#444;">${pri.label}</span>
                </div>
                <div style="margin-top:10px; color:#333; line-height:1.8; word-break:break-word;">${fnBodyToHtml(n.body || '')}</div>
                <div style="margin-top:10px; font-size:0.75rem; color:#888; border-top:1px dashed #eee; padding-top:8px;">
                    <span><i class="fas fa-plus-circle"></i> أُنشئت: ${fnFmt(n.created_at)}</span>
                    ${edited ? ` &nbsp;|&nbsp; <span><i class="fas fa-edit"></i> آخر تعديل: ${fnFmt(n.updated_at)}</span>` : ''}
                    ${n.updated_by ? ` &nbsp;|&nbsp; <span><i class="fas fa-user"></i> ${fnEscape(n.updated_by)}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    // تُنادى من general-manager.js عند فتح لوحة/تبويب المدير العام
    window.renderFounderNotesForGm = renderFounderNotesForGm;

    // ============================================================
    // محادثة الذكاء الاصطناعي للمشورة (وضع المؤسس)
    // -------------------------------------------------------------
    // تستخدم نفس مسار MISAR AI (Edge Function أولاً ثم المفاتيح المحلية).
    // السياق: نص الملاحظة الجاري تحريرها + عنوانها — للمشورة قبل الحفظ.
    // ============================================================
    let noteAiBusy = false; // قفل منع الطلبات المتزامنة

    function noteAiContext() {
        const title = (fnEl('fnTitle')?.value || '').trim();
        const body = (fnEl('fnBody')?.value || '').trim();
        const pri = fnEl('fnPriority')?.value || 'normal';
        const aud = fnEl('fnAudience')?.value || 'all';
        const parts = [];
        if (title) parts.push('عنوان الملاحظة: ' + title);
        if (body) parts.push('نص الملاحظة:\n' + body);
        parts.push('الأولوية المختارة: ' + (PRIORITY_LABELS[pri] || pri).label);
        parts.push('الجمهور المختار: ' + (aud === 'only_me' ? 'ليّا أنا فقط' : aud === 'all' ? 'كل المدراء' : 'مدير محدد'));
        return parts.join('\n');
    }

    function noteAiAppend(role, text) {
        const box = fnEl('fnAiChatMessages');
        if (!box) return;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; margin:8px 0; ' + (role === 'user' ? 'justify-content:flex-end;' : 'justify-content:flex-start;');
        const div = document.createElement('div');
        div.style.cssText = 'max-width:88%; padding:10px 14px; border-radius:16px; white-space:pre-wrap; word-break:break-word; line-height:1.7; font-size:0.9rem; '
            + (role === 'user'
                ? 'background:#7c4dff; color:#fff; border-bottom-right-radius:4px;'
                : 'background:#fff; color:#333; border:1px solid #e1bee7; border-bottom-left-radius:4px; box-shadow:0 1px 3px rgba(124,77,255,.08);');
        div.textContent = text;
        wrap.appendChild(div);
        box.appendChild(wrap);
        box.scrollTop = box.scrollHeight;
    }

    async function noteAiSend() {
        const input = fnEl('fnAiChatInput');
        const msg = (input ? input.value : '').trim();
        if (!msg || noteAiBusy) return;
        if (typeof getMisarAiResponse !== 'function') {
            showToast('المساعد الذكي غير متاح حالياً', 'error');
            return;
        }
        noteAiBusy = true;
        input.value = '';
        noteAiAppend('user', msg);
        const thinking = document.createElement('div');
        thinking.style.cssText = 'display:flex; margin:8px 0; justify-content:flex-start;';
        thinking.innerHTML = '<div style="background:#fff; border:1px solid #e1bee7; padding:10px 14px; border-radius:16px 16px 16px 4px; color:#888; font-size:0.9rem;">جاري التفكير…</div>';
        const box = fnEl('fnAiChatMessages');
        if (box) { box.appendChild(thinking); box.scrollTop = box.scrollHeight; }
        try {
            // نجمع سياق المنصة الإداري كاملاً + نص الملاحظة الحالية
            let platformCtx = '';
            try {
                platformCtx = (typeof buildMisarFounderContext === 'function')
                    ? await buildMisarFounderContext() : '';
            } catch (e) { /* تجاهل */ }
            const noteCtx = noteAiContext();
            const question = 'نص الملاحظة الجاري كتابتها (للمشورة):\n' + noteCtx
                + (platformCtx ? '\n\nبيانات المنصة الحالية:\n' + platformCtx : '')
                + '\n\nسؤالي: ' + msg;
            const reply = await getMisarAiResponse(question, { misarTech: false });
            if (thinking && thinking.parentNode) thinking.remove();
            noteAiAppend('bot', reply || 'لم أستطع الوصول لرد الآن، جرّب تاني.');
        } catch (e) {
            if (thinking && thinking.parentNode) thinking.remove();
            noteAiAppend('bot', 'حدث خطأ: ' + ((e && e.message) || 'غير معروف'));
        } finally {
            noteAiBusy = false;
        }
    }

    window.noteAiSend = noteAiSend;

    // نقل نص الاقتراح إلى مربع الكتابة (بدون إرسال) — المؤسس يعدّله ثم يرسل
    window.fnChipToInput = function (text) {
        const input = fnEl('fnAiChatInput');
        if (!input) return;
        input.value = text;
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    function initNoteAiChat() {
        const box = fnEl('fnAiChatMessages');
        if (box && !box.dataset.init) {
            box.dataset.init = '1';
            box.innerHTML = '';
            noteAiAppend('bot', 'أهلاً! أنا MISAR AI بوضع المشورة. اسألني عن صياغة الملاحظة، ترتيب أولوياتك، أو أي قرار إداري — وأنا سألخّص لك سياق المنصة الحالي.');
        }
        const input = fnEl('fnAiChatInput');
        if (input && !input.dataset.init) {
            input.dataset.init = '1';
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); noteAiSend(); } });
        }
    }

    // تصدير للاستخدام العام
    window.loadFounderNotes = loadFounderNotes;
})();
