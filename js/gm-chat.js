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
    let activeConversationRows = new Map();

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

    function syncChatSideWithAccount() {
        const accountType = appState.userData && appState.userData.account_type;
        if (accountType === 'general_manager'
            || (typeof misarIsGeneralManager === 'function' && misarIsGeneralManager())) {
            chatSide = 'gm';
        } else if (accountType === 'founder'
            || (typeof misarIsFounder === 'function' && misarIsFounder())) {
            chatSide = 'founder';
        }
    }

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
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'chat_conversations'
            }, (payload) => onConversationStateChanged(payload.new))
            .subscribe((status, error) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('تعذر الاتصال بمستمع رسائل المحادثة:', status, error);
                    showToast('تعذر الاتصال بتحديثات المحادثة المباشرة. أغلق المحادثة وافتحها مجدداً.', 'error');
                }
            });

        return chatChannel;
    }

    // الاتصال بمحادثة طرف معيّن (يجلب التاريخ ويحدّث حالة القفل)
    async function openConversation(peerId, incomingRow) {
        if (!myId() || !peerId) return;
        activePeerId = peerId;
        const side = chatSide;
        const conversationRows = new Map();
        if (incomingRow && incomingRow.id) conversationRows.set(incomingRow.id, incomingRow);
        activeConversationRows = conversationRows;
        const pid = pairId(myId(), peerId);
        chatClosedByFounder = false;

        const box = cEl(side === 'founder' ? 'fnChatMessages' : 'gmChatMessages');
        if (box) box.innerHTML = '<div data-chat-loading="true" style="text-align:center; padding:24px; color:#777;">جاري تحميل الرسائل...</div>';
        if (incomingRow) appendMessageToBox(incomingRow);
        ensureRealtimeChannel();
        try {
            const { data: conversation, error: conversationError } = await supabaseClient
                .from('chat_conversations')
                .select('is_closed')
                .eq('pair_key', pid)
                .maybeSingle();
            if (activePeerId !== peerId || chatSide !== side) return;
            if (conversationError) throw conversationError;
            chatClosedByFounder = !!(conversation && conversation.is_closed);

            const { data, error } = await supabaseClient
                .from('chat_messages')
                .select('id, pair_key, sender_id, sender_name, text, created_at')
                .eq('pair_key', pid)
                .order('created_at', { ascending: true })
                .limit(200);
            if (activePeerId !== peerId || chatSide !== side) return;
            if (error) {
                console.error('تعذر جلب سجل المحادثة:', error);
                renderConversationError(error);
                showToast('تعذر تحميل الرسائل: ' + error.message, 'error');
                return;
            }
            const mergedRows = new Map((data || []).map(row => [row.id, row]));
            for (const [id, row] of conversationRows) mergedRows.set(id, row);
            activeConversationRows = mergedRows;
            renderMessages(Array.from(mergedRows.values()).sort(
                (a, b) => new Date(a.created_at) - new Date(b.created_at)
            ));
        } catch (e) {
            console.warn('تعذر جلب سجل المحادثة:', e);
            if (activePeerId === peerId && chatSide === side) {
                renderConversationError(e);
                showToast('تعذر تحميل سجل المحادثة. تحقق من الاتصال ثم أعد فتح المحادثة.', 'error');
            }
        }
    }

    async function onConversationStateChanged(row) {
        if (!row || !activePeerId || row.pair_key !== pairId(myId(), activePeerId)) return;
        const wasClosed = chatClosedByFounder;
        chatClosedByFounder = !!row.is_closed;
        if (chatClosedByFounder) {
            renderMessages(Array.from(activeConversationRows.values()));
            if (!wasClosed && chatSide === 'gm') {
                showToast('أغلق المؤسس المحادثة. لا يمكنك إرسال رسائل الآن.', 'info');
            }
            return;
        }
        if (wasClosed) {
            showToast('أعاد المؤسس فتح المحادثة.', 'success');
            await openConversation(activePeerId);
        }
    }

    function renderConversationError(error) {
        const box = cEl(chatSide === 'founder' ? 'fnChatMessages' : 'gmChatMessages');
        if (!box) return;
        const loadingNotice = box.querySelector('[data-chat-loading]');
        if (loadingNotice) loadingNotice.remove();
        const notice = document.createElement('div');
        notice.style.cssText = 'text-align:center; padding:24px; color:#b71c1c;';
        notice.textContent = 'تعذر تحميل الرسائل: ' + ((error && error.message) || 'خطأ غير معروف');
        box.prepend(notice);
    }

    // معالجة صف جديد وارد (من Realtime أو من الجلب الأولي)
        async function onIncomingRow(row) {
            if (!row || !row.id || row.sender_id === myId()) return;
            // هل الرسالة خاصة بي؟ (أنا طرف في المحادثة)
            const pid = pairId(myId(), row.sender_id);
            const iAmParty = row.pair_key === pid;
            if (!iAmParty) return;

            // شاشة المدير العام: لو المؤسس قافل المحادثة نعرض «مغلقة» ولا نفتح
            if (chatSide === 'gm' && chatClosedByFounder) {
                showToast('💬 رسالة جديدة من المؤسس (المحادثة مغلقة حالياً)', 'info');
                return;
            }

            // هل الشات مفتوح على هذه المحادثة؟
            const isOpenHere = activePeerId === row.sender_id;
            if (isOpenHere) {
                activeConversationRows.set(row.id, row);
                appendMessageToBox(row);
                return;
            }

            // الشات مش فاتح على هذا الطرف → افتحه تلقائياً في وجهه فوراً
            if (chatSide === 'founder') {
                await window.fnOpenGmChat(row.sender_id, row);
            } else {
                await window.gmOpenMyChat(row);
            }
            showToast('💬 رسالة جديدة من ' + (row.sender_name || 'الطرف الآخر'), 'info');
        }

            // إضافة رسالة إلى صندوق الرسائل دون إعادة رسم كل شيء
            function appendMessageToBox(row) {
            const box = cEl(chatSide === 'founder' ? 'fnChatMessages' : 'gmChatMessages');
            if (!box) return;
            if (row.id && Array.from(box.children).some(child => child.dataset.chatMessageId === row.id)) return;
            const emptyNotice = box.querySelector('[data-chat-empty]');
            if (emptyNotice) emptyNotice.remove();
            const loadingNotice = box.querySelector('[data-chat-loading]');
            if (loadingNotice) loadingNotice.remove();
            const mine = row.sender_id === myId();
            const div = document.createElement('div');
            div.dataset.chatMessageId = row.id || '';
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
            if (chatClosedByFounder) {
                const message = chatSide === 'gm'
                    ? 'المحادثة مغلقة من المؤسس حالياً'
                    : 'المحادثة مغلقة. اضغط فتح المحادثة لاستئناف الرسائل.';
                box.innerHTML = `<div style="text-align:center; padding:24px;"><div style="background:#ffebee; color:#c62828; display:inline-block; padding:12px 20px; border-radius:14px;"><i class="fas fa-lock"></i> ${message}</div></div>`;
                const input = cEl(chatSide === 'founder' ? 'fnChatInput' : 'gmChatInput');
                const btn = chatSide === 'gm' ? cEl('gmChatSendBtn') : null;
                if (input) input.disabled = true;
                if (btn) btn.disabled = true;
                return;
            }
            const input = cEl(chatSide === 'founder' ? 'fnChatInput' : 'gmChatInput');
            const btn = chatSide === 'gm' ? cEl('gmChatSendBtn') : null;
            if (input) input.disabled = false;
            if (btn) btn.disabled = false;
            if (!list || !list.length) {
                box.innerHTML = '<div data-chat-empty="true" style="text-align:center; padding:24px; color:#999;"><i class="fas fa-comments" style="font-size:2rem; opacity:.3;"></i><p>لا توجد رسائل بعد — اكتب أول رسالة</p></div>';
                return;
            }
            box.innerHTML = list.map(m => {
                const mine = m.sender_id === myId();
                return `<div data-chat-message-id="${cEscape(m.id)}" style="display:flex; margin:6px 0; ${mine ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}">
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
            if (chatClosedByFounder) {
                showToast('المحادثة مغلقة. افتحها أولاً لإرسال رسالة.', 'error');
                return;
            }
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
            activeConversationRows.set(data.id, data);
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

        window.fnOpenGmChat = async function (gmId, incomingRow) {
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
            await openConversation(gmId, incomingRow);
            const input = cEl('fnChatInput');
            if (input) input.focus();
        };

        window.fnCloseGmChat = async function () {
            // إغلاق المحادثة تماماً: المدير لن يستطيع الكتابة
            if (!activePeerId) { hideFounderChatPanel(); return; }
            const pid = pairId(myId(), activePeerId);
            const { error } = await supabaseClient
                .from('chat_conversations')
                .upsert({
                    pair_key: pid,
                    founder_id: myId(),
                    manager_id: activePeerId,
                    is_closed: true
                }, { onConflict: 'pair_key' });
            if (error) {
                console.error('تعذر إغلاق المحادثة في قاعدة البيانات:', error);
                showToast('تعذر إغلاق المحادثة: ' + error.message, 'error');
                return;
            }
            chatClosedByFounder = true;
            renderMessages(Array.from(activeConversationRows.values()));
            renderFounderChatList();
            showToast('تم إغلاق المحادثة ومنع المدير من إرسال الرسائل', 'info');
        };

        window.fnOpenChatAgain = async function () {
            if (!activePeerId) return;
            const pid = pairId(myId(), activePeerId);
            const { error } = await supabaseClient
                .from('chat_conversations')
                .upsert({
                    pair_key: pid,
                    founder_id: myId(),
                    manager_id: activePeerId,
                    is_closed: false
                }, { onConflict: 'pair_key' });
            if (error) {
                console.error('تعذر إعادة فتح المحادثة في قاعدة البيانات:', error);
                showToast('تعذر فتح المحادثة: ' + error.message, 'error');
                return;
            }
            chatClosedByFounder = false;
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
        window.gmOpenMyChat = async function (incomingRow) {
            chatSide = 'gm';
            let founderId = null;
            try {
                const { data, error } = await supabaseClient.rpc('misar_get_chat_founder_id');
                if (error) {
                    console.error('تعذر العثور على حساب المؤسس للمحادثة:', error);
                    showToast('تعذر تحميل حساب المؤسس: ' + error.message, 'error');
                    return;
                }
                founderId = data;
            } catch (e) {
                console.error('تعذر العثور على حساب المؤسس للمحادثة:', e);
                showToast('تعذر الاتصال لتحميل حساب المؤسس.', 'error');
                return;
            }
            if (!founderId) return showToast('تعذر العثور على حساب المؤسس', 'error');

            const modal = cEl('gmChatModal');
            if (modal) modal.classList.add('active');
            await openConversation(founderId, incomingRow);
            const input = cEl('gmChatInput');
            if (input) { input.disabled = chatClosedByFounder; input.focus(); }
        };

        window.gmCloseMyChat = function () {
            const modal = cEl('gmChatModal');
            if (modal) modal.classList.remove('active');
        };

        window.fnChatSend = sendMsg;

        // تصدير للتهيئة: يُستدعى عند دخول المؤسس أو المدير العام
        window.initFounderGmChat = function () {
            syncChatSideWithAccount();
            if (chatSide === 'founder') renderFounderChatList();
            ensureRealtimeChannel();
        };
        window.initGmChatListener = function () {
            syncChatSideWithAccount();
            return ensureRealtimeChannel();
        };
    })();
