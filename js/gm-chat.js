// ============================================================
// MISAR SYSTEMS — نظام المحادثة بين المؤسس والمدير العام
// js/gm-chat.js
// ------------------------------------------------------------
// • الرسائل تُحفظ في جدول chat_messages بقاعدة البيانات (دائم).
// • استقبال فوري عبر Supabase Realtime (postgres_changes).
// • أول ما تصل رسالة جديدة للطرف الآخر يفتح الشات تلقائياً في وجهه
//   حتى لو كان مقفلاً/مش فاتحه (وجرس + Toast).
// • المؤسس يقدر يقفل المحادثة → المدير يرى «المحادثة مغلقة».
// ============================================================

(function () {
    'use strict';

    let chatChannel = null;      // قناة Realtime على جدول chat_messages
    let activePeerId = null;     // uuid الطرف الآخر
    let chatSide = 'founder';    // founder | gm
    let chatClosedByFounder = false;

    function cEl(id) { return document.getElementById(id); }
    function cEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function cFmt(iso) {
        try { return new Date(iso).toLocaleString('ar-EG', { hour12: true }); }
        catch (e) { return ''; }
    }
    function pairId(a, b) { return [a, b].sort().join(':'); }

    function myId() { return appState.user && appState.user.id; }
    function myName() {
        return (appState.userData && appState.userData.name)
            || (appState.user && appState.user.email) || '';
    }

    function closedFlagKey(pid) { return 'misarChatClosed_' + pid; }

    // ============================================================
    // قناة Realtime على جدول chat_messages — تعمل طوال الجلسة
    // ============================================================
    function ensureRealtimeChannel() {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) return null;
        if (chatChannel) return chatChannel;

        chatChannel = supabaseClient
            .channel('misar-gm-chat-live', { config: { broadcast: { self: false } } })
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'chat_messages'
            }, (payload) => onIncomingRow(payload.new))
            .subscribe();

        return chatChannel;
    }

    // الاتصال بمحادثة طرف معيّن (يجلب التاريخ ويحدّث حالة القفل)
    async function openConversation(peerId) {
        if (!myId() || !peerId) return;
        activePeerId = peerId;
        const pid = pairId(myId(), peerId);
        chatClosedByFounder = localStorage.getItem(closedFlagKey(pid)) === '1';

        ensureRealtimeChannel();
        try {
            const { data, error } = await supabaseClient
                .from('chat_messages')
                .select('id, pair_key, sender_id, sender_name, text, created_at')
                .eq('pair_key', pid)
                .order('created_at', { ascending: true })
                .limit(200);
            if (!error && data) renderMessages(data);
        } catch (e) {
            console.warn('تعذر جلب سجل المحادثة:', e);
            renderMessages([]);
        }
    }

    // معالجة صف جديد وارد (من Realtime أو من الجلب الأولي)
        function onIncomingRow(row) {
            if (!row || !row.id || row.sender_id === myId()) return;
            // هل الرسالة خاصة بي؟ (أنا طرف في المحادثة)
            const pid = pairId(myId(), row.sender_id);
            const iAmParty = row.pair_key === pid;
            if (!iAmParty) return;

            // شاشة المدير العام: لو المؤسس قافل المحادثة نعرض «مغلقة» ولا نفتح
            if (chatSide === 'gm' && localStorage.getItem(closedFlagKey(pid)) === '1') {
                showToast('💬 رسالة جديدة من المؤسس (المحادثة مغلقة حالياً)', 'info');
                return;
            }

            // هل الشات مفتوح على هذه المحادثة؟
            const isOpenHere = activePeerId === row.sender_id;
            if (isOpenHere) {
                appendMessageToBox(row);
                return;
            }

            // الشات مش فاتح على هذا الطرف → افتحه تلقائياً في وجهه فوراً
            if (chatSide === 'founder' || (typeof misarIsGeneralManager === 'function' && misarIsGeneralManager())) {
                if (chatSide === 'founder') {
                    window.fnOpenGmChat(row.sender_id);
                } else {
                    window.gmOpenMyChat();
                }
                showToast('💬 رسالة جديدة من ' + (row.sender_name || 'الطرف الآخر'), 'info');
                try { appendMessageToBox(row); } catch (e) { /* تجاهل */ }
            }
        }

            // إضافة رسالة إلى صندوق الرسائل دون إعادة رسم كل شيء
            function appendMessageToBox(row) {
            const box = cEl(chatSide === 'founder' ? 'fnChatMessages' : 'gmChatMessages');
            if (!box) return;
            const mine = row.sender_id === myId();
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; margin:6px 0; ' + (mine ? 'justify-content:flex-end;' : 'justify-content:flex-start;');
            div.innerHTML = `<div style="max-width:85%; padding:9px 13px; border-radius:16px; line-height:1.6; word-break:break-word; white-space:pre-wrap; font-size:0.9rem;
            ${mine ? 'background:#00897b; color:#fff; border-bottom-right-radius:4px;'
                    : 'background:#fff; color:#333; border:1px solid #e0e0e0; border-bottom-left-radius:4px;'}">
            <div style="font-size:0.68rem; opacity:.7; margin-bottom:2px;">${cEscape(row.sender_name || '')} • ${cFmt(row.created_at)}</div>
            <div>${cEscape(row.text)}</div>
        </div>`;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        }

        // رسم كل الرسائل (استبدال المحتوى)
        function renderMessages(list) {
            const box = cEl(chatSide === 'founder' ? 'fnChatMessages' : 'gmChatMessages');
            if (!box || !activePeerId) return;
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
            if (!list || !list.length) {
                box.innerHTML = '<div style="text-align:center; padding:24px; color:#999;"><i class="fas fa-comments" style="font-size:2rem; opacity:.3;"></i><p>لا توجد رسائل بعد — اكتب أول رسالة</p></div>';
                return;
            }
            box.innerHTML = list.map(m => {
                const mine = m.sender_id === myId();
                return `<div style="display:flex; margin:6px 0; ${mine ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}">
                <div style="max-width:85%; padding:9px 13px; border-radius:16px; line-height:1.6; word-break:break-word; white-space:pre-wrap; font-size:0.9rem;
                    ${mine ? 'background:#00897b; color:#fff; border-bottom-right-radius:4px;'
                        : 'background:#fff; color:#333; border:1px solid #e0e0e0; border-bottom-left-radius:4px;'}">
                    <div style="font-size:0.68rem; opacity:.7; margin-bottom:2px;">${cEscape(m.sender_name || '')} • ${cFmt(m.created_at)}</div>
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
            const { data: authData, error: authError } = await supabaseClient.auth.getUser();
            const senderId = authData && authData.user && authData.user.id;
            if (authError || !senderId) {
                console.warn('تعذر التحقق من جلسة مستخدم الشات:', authError);
                showToast('انتهت جلسة الدخول أو تعذر التحقق منها. سجّل الدخول مجدداً ثم أعد المحاولة.', 'error');
                return;
            }
            if (appState.user && appState.user.id !== senderId) {
                console.warn('معرّف مستخدم التطبيق لا يطابق جلسة Supabase؛ سيُستخدم معرّف الجلسة لإرسال الشات.');
            }
            const pid = pairId(senderId, activePeerId);

            const { data, error } = await supabaseClient
                .from('chat_messages')
                .insert({
                    pair_key: pid,
                    sender_id: senderId,
                    sender_name: myName(),
                    text: text.slice(0, 2000)
                })
                .select('id, pair_key, sender_id, sender_name, text, created_at')
                .single();

            if (error) {
                console.warn('فشل إرسال رسالة الشات:', error);
                showToast('تعذر إرسال الرسالة: ' + error.message, 'error');
                return;
            }

            if (input) input.value = '';
            appendMessageToBox(data);
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
            const panel = cEl('fnChatPanel');
            if (panel) panel.style.display = 'block';
            const card = cEl('fnGmChatCard');
            if (card) card.style.display = 'block';
            renderFounderChatList();
            const gm = ((window.misarGmState && window.misarGmState.gmList) || []).find(g => g.id === gmId);
            const title = cEl('fnChatPeerName');
            if (title) title.textContent = (gm && (gm.name || gm.email)) || 'مدير';
            openConversation(gmId);
            const input = cEl('fnChatInput');
            if (input) input.focus();
        };

        window.fnCloseGmChat = function () {
            // إغلاق المحادثة تماماً: المدير لن يستطيع الكتابة
            if (!activePeerId) { hideFounderChatPanel(); return; }
            const pid = pairId(myId(), activePeerId);
            chatClosedByFounder = true;
            try { localStorage.setItem(closedFlagKey(pid), '1'); } catch (e) { }
            renderMessages([]);
            renderFounderChatList();
            showToast('تم إغلاق المحادثة — المدير لا يستطيع الكتابة الآن', 'info');
        };

        window.fnOpenChatAgain = function () {
            if (!activePeerId) return;
            const pid = pairId(myId(), activePeerId);
            chatClosedByFounder = false;
            try { localStorage.removeItem(closedFlagKey(pid)); } catch (e) { }
            renderMessages([]);
            showToast('تم فتح المحادثة من جديد', 'success');
            openConversation(activePeerId);
        };

        window.fnMinimizeChat = function () {
            hideFounderChatPanel();
            showToast('تم تصغير المحادثة (ما زالت مفتوحة)', 'info');
        };

        function hideFounderChatPanel() {
            const panel = cEl('fnChatPanel');
            if (panel) panel.style.display = 'none';
        }

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

            const modal = cEl('gmChatModal');
            if (modal) modal.classList.add('active');
            openConversation(founderId);
            const input = cEl('gmChatInput');
            if (input) { input.disabled = false; input.focus(); }
        };

        window.gmCloseMyChat = function () {
            const modal = cEl('gmChatModal');
            if (modal) modal.classList.remove('active');
        };

        window.fnChatSend = sendMsg;

        // تصدير للتهيئة: يُستدعى عند دخول المؤسس أو المدير العام
        window.initFounderGmChat = function () {
            renderFounderChatList();
            ensureRealtimeChannel();
        };
        window.initGmChatListener = ensureRealtimeChannel;
    })();
