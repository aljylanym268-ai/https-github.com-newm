// ============================================================
// MISAR SYSTEMS — نظام المحادثة بين المؤسس والمدير العام
// js/gm-chat.js
// ------------------------------------------------------------
// • شات فوري (Realtime) عبر Supabase Broadcast Channel.
// • المؤسس: يفتح/يغلق المحادثة مع أي مدير من تبويب الملاحظات.
// • المدير العام: زر «محادثة المؤسس» في رأس لوحته.
// • سجل الرسائل يُحفظ محلياً (localStorage) لكل طرف.
// • المؤسس يقدر يقفل المحادثة → المدير يرى «المحادثة مغلقة».
// ============================================================

(function () {
    'use strict';

    let chatChannel = null;
    let activePeerId = null;   // uuid الطرف الآخر
    let chatSide = 'founder';  // founder | gm
    let chatClosedByFounder = false;

    function cEl(id) { return document.getElementById(id); }
    function cEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
            .replace(/"/g, '"').replace(/'/g, '&#39;');
    }
    function cFmt(iso) {
        try { return new Date(iso).toLocaleString('ar-EG', { hour12: true }); }
        catch (e) { return ''; }
    }
    function pairId(a, b) { return [a, b].sort().join(':'); }
    function storeKey(pid) { return 'misarChat_' + pid; }

    function myId() { return appState.user && appState.user.id; }

    // ---------- تخزين محلي ----------
    function loadHistory(pid) {
        try { return JSON.parse(localStorage.getItem(storeKey(pid)) || '[]'); }
        catch (e) { return []; }
    }
    function saveHistory(pid, list) {
        try {
            if (list.length > 200) list.splice(0, list.length - 200);
            localStorage.setItem(storeKey(pid), JSON.stringify(list));
        } catch (e) { /* تجاهل */ }
    }

    function closedFlagKey(pid) { return 'misarChatClosed_' + pid; }

    // ---------- القناة ----------
    function ensureChannel(pid) {
        if (chatChannel) { try { chatChannel.unsubscribe(); } catch (e) { } chatChannel = null; }
        if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
        chatChannel = supabaseClient.channel('misar-gm-chat-' + pid, {
            config: { broadcast: { self: false } }
        });
        chatChannel.on('broadcast', { event: 'msg' }, ({ payload }) => {
            if (!payload || !payload.text) return;
            const list = loadHistory(pid);
            list.push(payload);
            saveHistory(pid, list);
            renderMessages();
        });
        chatChannel.on('broadcast', { event: 'state' }, ({ payload }) => {
            if (payload && payload.type === 'closed_by_founder') {
                chatClosedByFounder = true;
                renderMessages();
            }
            if (payload && payload.type === 'opened_by_founder') {
                chatClosedByFounder = false;
                renderMessages();
            }
        });
        chatChannel.subscribe();
    }

    // ---------- عرض الرسائل ----------
    function renderMessages() {
        const box = cEl(chatSide === 'founder' ? 'fnChatMessages' : 'gmChatMessages');
        if (!box || !activePeerId) return;
        const pid = pairId(myId(), activePeerId);
        const list = loadHistory(pid);
        if (chatSide === 'gm' && chatClosedByFounder) {
            box.innerHTML = '<div style="text-align:center; padding:24px;"><div style="background:#ffebee; color:#c62828; display:inline-block; padding:12px 20px; border-radius:14px;"><i class="fas fa-lock"></i> المحادثة مغلقة من المؤسس حالياً</div></div>';
            const input = cEl('gmChatInput');
            const btn = cEl('gmChatSendBtn');
            if (input) input.disabled = true;
            if (btn) btn.disabled = true;
            return;
        }
        const input = cEl('gmChatInput');
        const btn = cEl('gmChatSendBtn');
        if (input) input.disabled = false;
        if (btn) btn.disabled = false;
        if (!list.length) {
            box.innerHTML = '<div style="text-align:center; padding:24px; color:#999;"><i class="fas fa-comments" style="font-size:2rem; opacity:.3;"></i><p>لا توجد رسائل بعد — اكتب أول رسالة</p></div>';
            return;
        }
        box.innerHTML = list.map(m => {
            const mine = m.from === myId();
            return `<div style="display:flex; margin:6px 0; ${mine ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}">
                <div style="max-width:85%; padding:9px 13px; border-radius:16px; line-height:1.6; word-break:break-word; white-space:pre-wrap; font-size:0.9rem;
                    ${mine ? 'background:#00897b; color:#fff; border-bottom-right-radius:4px;'
                           : 'background:#fff; color:#333; border:1px solid #e0e0e0; border-bottom-left-radius:4px;'}">
                    <div style="font-size:0.68rem; opacity:.7; margin-bottom:2px;">${cEscape(m.from_name || '')} • ${cFmt(m.at)}</div>
                    <div>${cEscape(m.text)}</div>
                </div>
            </div>`;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    // ---------- الإرسال ----------
    async function sendMsg() {
        const inputId = chatSide === 'founder' ? 'fnChatInput' : 'gmChatInput';
        const input = cEl(inputId);
        const text = (input ? input.value : '').trim();
        if (!text || !activePeerId) return;
        const pid = pairId(myId(), activePeerId);
        const msg = {
            id: (crypto.randomUUID ? crypto.randomUUID() : 'm' + Date.now()),
            from: myId(),
            from_name: (appState.userData && appState.userData.name) || (appState.user && appState.user.email) || '',
            to: activePeerId,
            text: text.slice(0, 2000),
            at: new Date().toISOString()
        };
        const list = loadHistory(pid);
        list.push(msg);
        saveHistory(pid, list);
        if (input) input.value = '';
        renderMessages();
        if (chatChannel) {
            try { await chatChannel.send({ type: 'broadcast', event: 'msg', payload: msg }); }
            catch (e) { console.warn('فشل إرسال رسالة الشات:', e); }
        }
    }

    // ============================================================
    // جهة المؤسس
    // ============================================================
    function renderFounderChatList() {
        const wrap = cEl('fnGmChatList');
        if (!wrap) return;
        const gmList = (window.misarGmState && window.misarGmState.gmList) || [];
        if (!gmList.length) {
            wrap.innerHTML = '<p style="color:#999; font-size:0.85rem;">لا يوجد مدراء بعد — عيّن مديراً من تبويب «المدير العام» أولاً.</p>';
            return;
        }
        wrap.innerHTML = gmList.map(g => {
            const active = activePeerId === g.id;
            return `<button class="${active ? 'login-btn' : 'filter-btn'}" style="width:auto; padding:6px 14px;"
                onclick="fnOpenGmChat('${g.id}')">
                <i class="fas fa-comments"></i> ${cEscape(g.name || g.email || 'مدير')}
            </button>`;
        }).join('');
    }

    window.fnOpenGmChat = function (gmId) {
        if (!myId() || !gmId) return;
        chatSide = 'founder';
        activePeerId = gmId;
        const pid = pairId(myId(), gmId);
        chatClosedByFounder = localStorage.getItem(closedFlagKey(pid)) === '1';
        const panel = cEl('fnChatPanel');
        if (panel) panel.style.display = 'block';
        const card = cEl('fnGmChatCard');
        if (card) card.style.display = 'block';
        ensureChannel(pid);
        renderFounderChatList();
        renderMessages();
        const gm = ((window.misarGmState && window.misarGmState.gmList) || []).find(g => g.id === gmId);
        const title = cEl('fnChatPeerName');
        if (title) title.textContent = (gm && (gm.name || gm.email)) || 'مدير';
        const input = cEl('fnChatInput');
        if (input) input.focus();
    };

    window.fnCloseGmChat = function () {
        // إغلاق المحادثة تماماً: المدير لن يستطيع الكتابة
        if (!activePeerId) { hideFounderChatPanel(); return; }
        const pid = pairId(myId(), activePeerId);
        chatClosedByFounder = true;
        try { localStorage.setItem(closedFlagKey(pid), '1'); } catch (e) { }
        if (chatChannel) chatChannel.send({ type: 'broadcast', event: 'state', payload: { type: 'closed_by_founder' } });
        renderMessages();
        renderFounderChatList();
        showToast('تم إغلاق المحادثة — المدير لا يستطيع الكتابة الآن', 'info');
    };

    window.fnOpenChatAgain = function () {
        if (!activePeerId) return;
        const pid = pairId(myId(), activePeerId);
        chatClosedByFounder = false;
        try { localStorage.removeItem(closedFlagKey(pid)); } catch (e) { }
        if (chatChannel) chatChannel.send({ type: 'broadcast', event: 'state', payload: { type: 'opened_by_founder' } });
        renderMessages();
        renderFounderChatList();
        showToast('تم فتح المحادثة من جديد', 'success');
    };

    window.fnMinimizeChat = function () {
        hideFounderChatPanel();
        showToast('تم تصغير المحادثة (ما زالت مفتوحة)', 'info');
    };

    function hideFounderChatPanel() {
        const panel = cEl('fnChatPanel');
        if (panel) panel.style.display = 'none';
    }

    // إظهار/إخفاء كارت المحادثة حسب اختيار الجمهور
    window.fnChatAudienceChanged = function () {
        const sel = cEl('fnAudience');
        const card = cEl('fnGmChatCard');
        if (!card) return;
        // الكارت يظهر دائماً مع وجود مدراء، ويتقدّم للأعلى عند اختيار مدير محدد
        if (typeof misarIsFounder === 'function' && misarIsFounder()) {
            renderFounderChatList();
        }
    };

    // ============================================================
    // جهة المدير العام
    // ============================================================
    window.gmOpenMyChat = async function () {
        chatSide = 'gm';
        // المؤسس: أول حساب founder من user_data (نجيبه من صلاحيات النظام)
        let founderId = null;
        try {
            const { data, error } = await supabaseClient
                .from('user_data')
                .select('id, name, email')
                .eq('account_type', 'founder')
                .limit(1);
            if (!error && data && data.length) founderId = data[0].id;
        } catch (e) { /* تجاهل */ }
        if (!founderId) return showToast('تعذر العثور على حساب المؤسس', 'error');
        activePeerId = founderId;
        const pid = pairId(myId(), founderId);
        chatClosedByFounder = localStorage.getItem(closedFlagKey(pid)) === '1';
        ensureChannel(pid);
        const modal = cEl('gmChatModal');
        if (modal) modal.classList.add('active');
        renderMessages();
        const input = cEl('gmChatInput');
        if (input) { input.disabled = false; input.focus(); }
    };

    window.gmCloseMyChat = function () {
        const modal = cEl('gmChatModal');
        if (modal) modal.classList.remove('active');
    };

    window.fnChatSend = sendMsg;

    // تصدير للتهيئة
    window.initFounderGmChat = function () {
        renderFounderChatList();
    };
})();
