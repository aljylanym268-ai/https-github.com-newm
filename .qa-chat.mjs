async function getMisarAiResponse(msg) {
    // دعم إدخال مفتاح عبر الشات
    const keyMatch = String(msg).match(/(?:sk-[A-Za-z0-9_\-]{20,}|AQ\.[A-Za-z0-9_\-]{20,})/);
    if (keyMatch) {
        setMisarApiKey(keyMatch[0]);
        return '✅ تم حفظ المفتاح بنجاح!\nأنا الآن MISAR AI الذكي، اسألني عن أي شيء: المنتجات، طلباتك، الخدمات… 😊';
    }

    // سياق
    let context = '';
    try {
        context = await Promise.race([
            buildMisarContext(),
            new Promise(res => setTimeout(() => res(''), 4000))
        ]);
    } catch (e) { /* تجاهل */ }

    try {
        const messages = [
            { role: 'system', content: MISAR_SYSTEM_PROMPT + '\n\nبيانات النظام الحالية:\n' + context },
            ...misarChatHistory.slice(-10),
            { role: 'user', content: msg }
        ];
        let reply = null;

        // 1️⃣ المحاولة بالمفتاح المحلي (OpenRouter) أولاً
        if (getMisarApiKey()) {
            reply = await askMisarAIMessages(messages);
        }
        // 2️⃣ ثم Google Gemini
        if (!reply) reply = await askMisarGemini(messages);
        // 3️⃣ ثم Edge Function
        if (!reply) reply = await askMisarAIEdge(messages);

        if (reply) {
            misarChatHistory.push({ role: 'user', content: msg });
            misarChatHistory.push({ role: 'assistant', content: reply });
            if (misarChatHistory.length > 20) misarChatHistory.splice(0, misarChatHistory.length - 20);
            return reply;
        }
    } catch (e) {
        console.warn('⚠️ MISAR AI فشل المسار الذكي:', e);
    }

    // احتياطي البحث المحلي
    try {
        const localSearch = await tryLocalProductAnswer(msg);
        if (localSearch) return localSearch;
    } catch (e) {}

    // الردود الثابتة كحل أخير
    return getSmartLocalReply(String(msg).toLowerCase());
}