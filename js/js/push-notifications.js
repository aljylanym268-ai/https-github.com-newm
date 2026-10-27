// Push notifications for authenticated MISAR users.
const MISAR_PUSH_FUNCTION = 'misar-push-order';

function misarPushButton() {
    if (document.querySelector('#sellerDashboardScreen.active')) {
        return document.getElementById('sellerPushNotificationsButton');
    }
    if (document.querySelector('#deliveryDashboardScreen.active')) {
        return document.getElementById('deliveryPushNotificationsButton');
    }
    return document.getElementById('misarPushNotificationsButton') ||
        document.getElementById('sellerPushNotificationsButton');
}

function misarPushSupported() {
    return window.isSecureContext &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;
}

function misarPushSetButton(text, disabled = false) {
    const button = misarPushButton();
    if (!button) return;
    button.disabled = disabled;
    button.innerHTML = text;
}

async function updatePushNotificationButton() {
    const button = misarPushButton();
    if (!button) return;
    if (!appState.user) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-bell"></i> سجّل الدخول لتفعيل الإشعارات';
        return;
    }
    if (!misarPushSupported()) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-bell-slash"></i> الإشعارات غير مدعومة';
        return;
    }
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (Notification.permission === 'denied' && !subscription) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-bell-slash"></i> اسمح بالإشعارات من إعدادات المتصفح';
            return;
        }
        button.disabled = false;
        button.innerHTML = subscription
            ? '<i class="fas fa-bell-slash"></i> إيقاف إشعارات التطبيق'
            : '<i class="fas fa-bell"></i> تفعيل إشعارات التطبيق';
    } catch (error) {
        console.error('تعذر التحقق من اشتراك Push:', error);
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-bell"></i> تفعيل إشعارات التطبيق';
    }
}

function misarPushBase64ToBytes(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from(rawData, character => character.charCodeAt(0));
}

async function misarPushGetPublicKey() {
    const { data, error } = await supabaseClient.functions.invoke(MISAR_PUSH_FUNCTION, {
        body: { action: 'get_public_key' }
    });
    if (error) throw new Error('تعذر تجهيز إشعارات Push: ' + error.message);
    if (!data?.public_key) throw new Error('مفتاح Push العام غير مضبوط في إعدادات الخادم.');
    return data.public_key;
}

async function misarPushSaveSubscription(subscription) {
    if (!appState.user) throw new Error('سجّل الدخول أولاً لتفعيل الإشعارات.');
    const serialized = subscription.toJSON();
    const p256dh = serialized.keys?.p256dh;
    const auth = serialized.keys?.auth;
    if (!serialized.endpoint || !p256dh || !auth) {
        throw new Error('بيانات اشتراك Push غير مكتملة من المتصفح.');
    }

    // الصف القديم بنفس endpoint قد ينتمي لحساب آخر على نفس الجهاز.
    // upsert المباشر سيفشل على سياسة UPDATE، لذا نحذف الصف القديم أولاً ثم ندرج جديداً.
    const { error: cleanupError } = await supabaseClient.from('push_subscriptions')
        .delete()
        .eq('endpoint', serialized.endpoint)
        .neq('user_id', appState.user.id);
    if (cleanupError) console.warn('تعذر حذف اشتراك Push قديم:', cleanupError.message);

    const { error } = await supabaseClient.from('push_subscriptions').upsert({
        user_id: appState.user.id,
        endpoint: serialized.endpoint,
        p256dh,
        auth,
        updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) throw error;
}

async function misarPushSyncCurrentSubscription() {
    if (!appState.user || !misarPushSupported() || Notification.permission !== 'granted') return;
    try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await misarPushSaveSubscription(subscription);
    } catch (error) {
        console.error('تعذرت مزامنة اشتراك Push الحالي:', error);
    }
}

async function toggleSellerPushNotifications() {
    if (!appState.user) {
        showToast('سجّل الدخول أولاً لتفعيل الإشعارات.', 'error');
        return;
    }
    if (!misarPushSupported()) {
        showToast('إشعارات Push تحتاج متصفحاً يدعمها واتصالاً آمناً عبر HTTPS.', 'error');
        return;
    }

    misarPushSetButton('<i class="fas fa-spinner fa-spin"></i> جاري تجهيز الإشعارات...', true);
    try {
        let permission = Notification.permission;
        if (permission === 'default') permission = await Notification.requestPermission();
        const registration = await navigator.serviceWorker.register('./sw.js');
        const readyRegistration = await navigator.serviceWorker.ready;
        const existing = await readyRegistration.pushManager.getSubscription();

        if (existing) {
            const { data: ownedSubscription, error: ownershipError } = await supabaseClient
                .from('push_subscriptions')
                .select('endpoint')
                .eq('user_id', appState.user.id)
                .eq('endpoint', existing.endpoint)
                .maybeSingle();
            if (ownershipError) throw ownershipError;
            if (!ownedSubscription) await misarPushSaveSubscription(existing);

            const { error } = await supabaseClient.from('push_subscriptions')
                .delete()
                .eq('user_id', appState.user.id)
                .eq('endpoint', existing.endpoint);
            if (error) throw error;
            const unsubscribed = await existing.unsubscribe();
            if (!unsubscribed) throw new Error('لم يؤكد المتصفح إيقاف الاشتراك.');
            showToast('تم إيقاف إشعارات التطبيق على هذا الجهاز.', 'success');
        } else {
            if (permission !== 'granted') {
                throw new Error('لم يتم السماح بالإشعارات. فعّلها من إعدادات المتصفح ثم حاول مجدداً.');
            }
            const publicKey = await misarPushGetPublicKey();
            const subscription = await (readyRegistration.pushManager.getSubscription())
                || await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: misarPushBase64ToBytes(publicKey)
                });
            await misarPushSaveSubscription(subscription);
            showToast('تم تفعيل إشعارات التطبيق على هذا الجهاز.', 'success');
        }
    } catch (error) {
        console.error('فشل إعداد إشعارات Push:', error);
        showToast(error.message || 'تعذر إعداد إشعارات Push.', 'error');
    } finally {
        await updatePushNotificationButton();
    }
}

async function notifyOrderPushEvent(orderId, event) {
    if (!orderId || !event) return;
    try {
        const { data, error } = await supabaseClient.functions.invoke(MISAR_PUSH_FUNCTION, {
            body: { action: 'notify_order_event', order_id: orderId, event }
        });
        if (error) console.warn('تعذر إرسال إشعار Push للطلب:', error.message);
        else if (data?.error) console.warn('تعذر إرسال إشعار Push للطلب:', data.error);
    } catch (error) {
        console.warn('فشل استدعاء إشعار Push للطلب:', error);
    }
}

async function notifySellerPushOrder(orderId) {
    return notifyOrderPushEvent(orderId, 'new_order');
}

async function misarPushPersistChangedSubscription(subscriptionJson) {
    if (!appState.user || !subscriptionJson?.endpoint) return;
    const { error: cleanupError } = await supabaseClient.from('push_subscriptions')
        .delete()
        .eq('endpoint', subscriptionJson.endpoint)
        .neq('user_id', appState.user.id);
    if (cleanupError) console.warn('تعذر حذف اشتراك Push قديم:', cleanupError.message);
    const { error } = await supabaseClient.from('push_subscriptions').upsert({
        user_id: appState.user.id,
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys?.p256dh,
        auth: subscriptionJson.keys?.auth,
        updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) console.error('تعذر تحديث اشتراك Push:', error);
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
            if (event.data.subscription) {
                misarPushPersistChangedSubscription(event.data.subscription);
            } else {
                misarPushSyncCurrentSubscription();
            }
        }
    });
}

window.addEventListener('pageshow', misarPushSyncCurrentSubscription);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') misarPushSyncCurrentSubscription();
});

window.updatePushNotificationButton = updatePushNotificationButton;
window.toggleSellerPushNotifications = toggleSellerPushNotifications;
window.notifySellerPushOrder = notifySellerPushOrder;
window.notifyOrderPushEvent = notifyOrderPushEvent;
window.misarPushSyncCurrentSubscription = misarPushSyncCurrentSubscription;
