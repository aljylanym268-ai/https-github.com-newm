// ========== قاعدة البيانات ==========
const SUPABASE_URL = 'https://wwojtkxwmgkrudtevbcb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Rqi9qMZgIrslWSDc61gG-A_QGQxcvNr';
const { createClient } = supabase;

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== الحالة العامة ==========
const appState = {
    user: null,
    userData: {},
    location: null,
    products: [],
    currentProduct: null,
    services: [
        { id:1, name:"خدمات الصيانة", description:"صيانة منزلية، تصليح أجهزة كهربائية، سباكة", price:"150 ج.م", icon:"fas fa-tools" },
        { id:2, name:"خدمات التوصيل", description:"توصيل طلبات، نقل عفش، توصيل وثائق", price:"50 ج.م", icon:"fas fa-shipping-fast" },
        { id:3, name:"خدمات تعليمية", description:"دروس خصوصية، دورات تدريبية، استشارات تعليمية", price:"100 ج.م/ساعة", icon:"fas fa-graduation-cap" }
    ],
    villagesByCenter: {
        'قنا': ['قنا البلد','الشرق','الغرب','الكويت','الساحل'],
        'نقادة': ['نقادة','الركاب','الكلاحين','الزوايدة'],
        'قوص': ['قوص','العيايشة','الأشراف','المخادمة'],
        'دشنا': ['دشنا','أبو دياب','السمطا','العويضات'],
        'فرشوط': ['فرشوط','الكوم الأحمر','النجوع','الرواتب'],
        'أبو تشت': ['أبو تشت','البلابيش','النجوع','الرئيسية'],
        'نجع حمادي': ['نجع حمادي','الطود','الحلفاية','الغربية'],
        'قفط': ['قفط','القلعة','الرفش','الصباب']
    },
    seller: { products: [], orders: [], currentTab: 'products', filterCategory: 'all', filterOrderStatus: 'all', chart: null },
    delivery: { availableOrders: [], myOrders: [], currentTab: 'available' },
    tempImages: [],
    founderPageVisible: true,
    founderViews: 0,
    founderShares: { whatsapp:0, facebook:0, twitter:0, copy:0 },
    previousScreen: 'homeScreen',
    currentScreen: 'homeScreen',
ordersSubscription: null,
    notificationsSubscription: null,
    notificationsEnabled: localStorage.getItem('misarNotificationsEnabled') !== 'false'
};

// ========== دوال مساعدة ==========
function getBearElement() { return document.querySelector('.bear-avatar'); }
function setBearExpression(expression) {
    const bear = getBearElement();
    if (!bear) return;
    bear.classList.remove('sad', 'happy', 'covering-eyes', 'blink');
    if (expression === 'sad') bear.classList.add('sad');
    else if (expression === 'happy') bear.classList.add('happy');
    else if (expression === 'covering') bear.classList.add('covering-eyes');
    else if (expression === 'blink') { bear.classList.add('blink'); setTimeout(() => bear.classList.remove('blink'), 300); }
}
function showBearReaction(success) { setBearExpression(success ? 'happy' : 'sad'); setTimeout(() => setBearExpression(''), 1500); }
function showLoading(show = true) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.toggle('active', show);
}
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-exclamation-triangle'}"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
function escapeHTML(str) { return String(str).replace(/[&<>"]/g, function(m) { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; if (m === '"') return '&quot;'; return m; }); }

// ========== توليد رمز OTP ==========
function generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * 10)];
    }
    console.log('🟡 [generateOTP] تم إنشاء رمز:', otp);
    return otp;
}

// ========== ضغط الصور ==========
async function compressImage(file, maxWidth = 1024, maxHeight = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                let width = img.width, height = img.height;
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round(width * (maxHeight / height));
                        height = maxHeight;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (!blob) reject(new Error('فشل ضغط الصورة'));
                    else resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }));
                }, file.type, quality);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// ========== رفع صور المنتجات ==========
async function uploadProductImages(files) {
    if (!files || files.length === 0) return [];
    const urls = [];
    for (const file of files) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) throw new Error(`نوع الملف ${file.name} غير مدعوم`);
        if (file.size > 10 * 1024 * 1024) throw new Error(`الملف ${file.name} كبير جداً (الحد 10 ميجابايت)`);
        const compressed = await compressImage(file, 1024, 1024, 0.8);
        const uniqueName = `product-${Date.now()}-${Math.random().toString(36).substring(2)}.${file.name.split('.').pop()}`;
        const filePath = `products/${uniqueName}`;
        const { error } = await supabaseClient.storage.from('product-images').upload(filePath, compressed, { cacheControl: '3600', upsert: false });
        if (error) throw new Error(`فشل رفع ${file.name}: ${error.message}`);
        const { data: { publicUrl } } = supabaseClient.storage.from('product-images').getPublicUrl(filePath);
        urls.push(publicUrl);
    }
    return urls;
}

// ========== رفع صور التقييمات ==========
async function uploadReviewImages(files, reviewId) {
    if (!files || files.length === 0) return [];
    const urls = [];
    for (const file of files) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(file.type)) throw new Error(`نوع الملف ${file.name} غير مدعوم`);
        if (file.size > 10 * 1024 * 1024) throw new Error(`الملف ${file.name} كبير جداً (الحد 10 ميجابايت)`);
        const compressed = await compressImage(file, 1024, 1024, 0.8);
        const uniqueName = `review-${reviewId}-${Date.now()}-${Math.random().toString(36).substring(2)}.${file.name.split('.').pop()}`;
        const filePath = `reviews/${uniqueName}`;
        const { error } = await supabaseClient.storage.from('review-media').upload(filePath, compressed, { cacheControl: '3600', upsert: false });
        if (error) throw new Error(`فشل رفع ${file.name}: ${error.message}`);
        const { data: { publicUrl } } = supabaseClient.storage.from('review-media').getPublicUrl(filePath);
        urls.push(publicUrl);
    }
    return urls;
}

// ========== رفع فيديو التقييم ==========
async function uploadReviewVideo(file, reviewId) {
    if (!file) return null;
    const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    if (!allowedTypes.includes(file.type)) throw new Error(`نوع الفيديو ${file.name} غير مدعوم`);
    if (file.size > 50 * 1024 * 1024) throw new Error(`الملف ${file.name} كبير جداً (الحد 50 ميجابايت)`);
    const uniqueName = `review-${reviewId}-${Date.now()}-${Math.random().toString(36).substring(2)}.${file.name.split('.').pop()}`;
    const filePath = `reviews/videos/${uniqueName}`;
    const { error } = await supabaseClient.storage.from('review-media').upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw new Error(`فشل رفع الفيديو: ${error.message}`);
    const { data: { publicUrl } } = supabaseClient.storage.from('review-media').getPublicUrl(filePath);
    return publicUrl;
}

// ============================================================
// دوال نظام التقييمات والمراجعات
// ============================================================

async function canReviewProduct(productId, userId) {
    if (!userId) return false;
    const { data, error } = await supabaseClient
        .from('orders')
        .select('id')
        .eq('product_id', productId)
        .eq('buyer_id', userId)
        .eq('status', 'delivered')
        .maybeSingle();
    if (error) { console.error('خطأ في التحقق من الشراء:', error); return false; }
    return !!data;
}

async function hasUserReviewed(productId, userId) {
    if (!userId) return false;
    const { data, error } = await supabaseClient
        .from('reviews')
        .select('id')
        .eq('product_id', productId)
        .eq('user_id', userId)
        .maybeSingle();
    if (error) { console.error('خطأ في التحقق من التقييم:', error); return false; }
    return !!data;
}

async function getUserReview(productId, userId) {
    if (!userId) return null;
    const { data, error } = await supabaseClient
        .from('reviews')
        .select('*')
        .eq('product_id', productId)
        .eq('user_id', userId)
        .maybeSingle();
    if (error) { console.error('خطأ في جلب تقييم المستخدم:', error); return null; }
    return data;
}

async function upsertReview(reviewData) {
    const { product_id, user_id, order_id, rating, title, comment, images, video, is_verified_purchase } = reviewData;
    const existing = await getUserReview(product_id, user_id);
    let result;
    if (existing) {
        const { data, error } = await supabaseClient
            .from('reviews')
            .update({
                rating,
                title,
                comment,
                images: images || [],
                video: video || null,
                updated_at: new Date()
            })
            .eq('id', existing.id)
            .select()
            .single();
        if (error) throw error;
        result = data;
    } else {
        const { data, error } = await supabaseClient
            .from('reviews')
            .insert({
                product_id,
                user_id,
                order_id,
                rating,
                title,
                comment,
                images: images || [],
                video: video || null,
                is_verified_purchase: is_verified_purchase || false,
                created_at: new Date(),
                updated_at: new Date()
            })
            .select()
            .single();
        if (error) throw error;
        result = data;
    }
    await updateProductRatingStats(product_id);
    return result;
}

async function updateProductRatingStats(productId) {
    const { data, error } = await supabaseClient
        .from('reviews')
        .select('rating')
        .eq('product_id', productId);
    if (error) { console.error('خطأ في جلب تقييمات المنتج:', error); return; }
    const total = data.length;
    const avg = total > 0 ? data.reduce((sum, r) => sum + r.rating, 0) / total : 0;
    await supabaseClient
        .from('products')
        .update({
            avg_rating: Math.round(avg * 10) / 10,
            review_count: total
        })
        .eq('id', productId);
}

async function loadProductReviews(productId) {
    try {
        const { data, error } = await supabaseClient
            .from('reviews')
            .select(`
                *,
                users:user_id (id, name, image_url)
            `)
            .eq('product_id', productId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    } catch (e) { console.error('فشل جلب التقييمات:', e); return []; }
}

async function getReviewStats(productId) {
    const reviews = await loadProductReviews(productId);
    const total = reviews.length;
    if (total === 0) return { total, average: 0, distribution: { 1:0, 2:0, 3:0, 4:0, 5:0 } };
    const sum = reviews.reduce((s, r) => s + r.rating, 0);
    const average = sum / total;
    const distribution = { 1:0, 2:0, 3:0, 4:0, 5:0 };
    reviews.forEach(r => { distribution[r.rating] = (distribution[r.rating] || 0) + 1; });
    return { total, average, distribution };
}

async function markReviewHelpful(reviewId, userId) {
    if (!userId) throw new Error('يجب تسجيل الدخول');

    // تسجيل الإعجاب في جدول review_helpful (إن وُجد الجدول وسمح RLS)
    // لا نمنع زيادة العدد إذا كان هذا الجدول غير متاح، بل نكمل برفع العدد فقط.
    try {
        const { data: existing, error: checkError } = await supabaseClient
            .from('review_helpful')
            .select('id')
            .eq('review_id', reviewId)
            .eq('user_id', userId)
            .maybeSingle();
        if (checkError) throw checkError;
        if (existing) throw new Error('لقد قمت بتحديد هذا التقييم كمفيد سابقاً');

        const { error: insertError } = await supabaseClient
            .from('review_helpful')
            .insert({ review_id: reviewId, user_id: userId, created_at: new Date() });
        if (insertError) throw insertError;
    } catch (e) {
        // إذا كان الخطأ هو "قيّمت سابقاً" نعيده للمستخدم، وإلا نتجاهله ونكمل بزيادة العدد
        if (e && e.message === 'لقد قمت بتحديد هذا التقييم كمفيد سابقاً') throw e;
        console.warn('لم يتم تسجيل الإعجاب في review_helpful (سيتم زيادة العدد فقط):', e);
    }

    // زيادة عدد الإعجابات "مفيد" في جدول reviews
    try {
        // أولاً: محاولة استخدام دالة RPC (زيادة ذرّية)
        const { error: rpcError } = await supabaseClient
            .rpc('increment_helpful_count', { review_id: reviewId });
        if (rpcError) throw rpcError;
    } catch (rpcErr) {
        // إذا لم توجد دالة RPC، نقرأ العدد الحالي ثم نزيده يدوياً
        try {
            const { data: review, error: fetchError } = await supabaseClient
                .from('reviews')
                .select('helpful_count')
                .eq('id', reviewId)
                .single();
            if (!fetchError && review) {
                const { error: updateError } = await supabaseClient
                    .from('reviews')
                    .update({ helpful_count: (review.helpful_count || 0) + 1 })
                    .eq('id', reviewId);
                if (updateError) throw updateError;
            }
        } catch (e2) {
            console.warn('فشل زيادة عدد "مفيد" في قاعدة البيانات:', e2);
        }
    }
}

async function getHelpfulCount(reviewId) {
    const { data, error } = await supabaseClient
        .from('review_helpful')
        .select('id', { count: 'exact' })
        .eq('review_id', reviewId);
    if (error) throw error;
    return data.length;
}

// ============================================================
// المصادقة
// ============================================================

async function signInWithGoogle() {
    // تحديد نوع الحساب من الشاشة النشطة (تسجيل الدخول أو التسجيل)
    const loginAccountType = document.getElementById('loginAccountType');
    const registerAccountType = document.getElementById('registerAccountType');
    const activeScreen = document.querySelector('.screen.active');
    let accountTypeEl = loginAccountType;
    if (activeScreen && activeScreen.id === 'registerScreen' && registerAccountType) {
        accountTypeEl = registerAccountType;
    }
    if (!accountTypeEl) { showToast('خطأ في النموذج', 'error'); return; }
    sessionStorage.setItem('pendingAccountType', accountTypeEl.value);
    showLoading(true);
    try {
        // استخدام الرابط الحالي الكامل كوجهة عودة ليعمل OAuth بشكل صحيح بعد إعادة التوجيه
        const currentUrl = window.location.origin + window.location.pathname;
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: currentUrl }
        });
        if (error) {
            console.error('❌ خطأ في تسجيل الدخول عبر Google:', error);
            showToast(error.message || 'فشل تسجيل الدخول عبر Google', 'error');
            showBearReaction(false);
        }
        // عند النجاح سيتم توجيه المستخدم إلى صفحة Google ثم العودة تلقائياً
    } catch (err) {
        console.error('❌ استثناء غير متوقع في Google login:', err);
        showToast(err.message || 'حدث خطأ غير متوقع أثناء تسجيل الدخول عبر Google', 'error');
        showBearReaction(false);
    } finally {
        showLoading(false);
    }
}

// ============================================================
// تطبيق نوع الحساب المختار قبل تسجيل الدخول عبر Google
// ============================================================
async function applyPendingAccountType() {
    const pendingType = sessionStorage.getItem('pendingAccountType');
    if (!pendingType) return false;
    if (!appState.user) {
        // لا يوجد مستخدم بعد (قد تكون أول زيارة بعد إعادة التوجيه) - ننتظر حتى اكتمال الجلسة
        return false;
    }
    try {
        const accountType = pendingType;
        const existing = appState.userData && Object.keys(appState.userData).length > 0
            ? appState.userData
            : null;

        const updates = {
            id: appState.user.id,
            account_type: accountType,
            status: accountType === 'delivery' ? 'pending' : 'approved'
        };
        if (!existing || !existing.name) {
            updates.name = appState.user.user_metadata?.full_name || appState.user.email?.split('@')[0] || '';
        }
        if (!existing || !existing.governorate) {
            updates.governorate = appState.user.user_metadata?.governorate || 'قنا';
        }

        const { error: upsertError } = await supabaseClient
            .from('user_data')
            .upsert(updates, { onConflict: 'id' });
        if (upsertError) {
            console.warn('⚠️ فشل حفظ نوع الحساب في user_data:', upsertError);
            return false;
        }

        // تحديث user_metadata في حساب Supabase حتى يبقى النوع مثالياً بعد تسجيلات الدخول اللاحقة
        try {
            const { error: metaError } = await supabaseClient.auth.updateUser({
                data: { account_type: accountType }
            });
            if (metaError) console.warn('⚠️ فشل تحديث user_metadata:', metaError);
        } catch (metaErr) {
            console.warn('⚠️ استثناء أثناء تحديث user_metadata:', metaErr);
        }

        // تحديث الحالة المحلية
        appState.userData.account_type = accountType;
        appState.userData.status = accountType === 'delivery' ? 'pending' : 'approved';
        sessionStorage.removeItem('pendingAccountType');
        console.log('✅ تم تطبيق نوع الحساب عبر Google:', accountType);
        return true;
    } catch (err) {
        console.error('❌ خطأ في applyPendingAccountType:', err);
        sessionStorage.removeItem('pendingAccountType');
        return false;
    }
}

async function signInWithEmail() {
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    if (!emailInput || !passwordInput) { showToast('النموذج غير متوفر', 'error'); return; }
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) { showToast('يرجى إدخال البريد وكلمة المرور', 'warning'); return; }
    showLoading(true);
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showBearReaction(true);
        showToast('تم تسجيل الدخول بنجاح', 'success');
        emailInput.value = '';
        passwordInput.value = '';
    } catch (error) {
        showToast(error.message, 'error');
        showBearReaction(false);
    } finally { showLoading(false); }
}

function extractErrorMessage(error) {
    if (!error) return 'حدث خطأ غير معروف (الخطأ فارغ).';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error_description) return error.error_description;
    if (error.details) return error.details;
    if (error.code) {
        const codeMap = {
            'user_already_exists': 'هذا البريد الإلكتروني مسجل بالفعل.',
            'weak_password': 'كلمة المرور ضعيفة جداً. استخدم 8 أحرف على الأقل مع أرقام ورموز.',
            'invalid_email': 'البريد الإلكتروني غير صحيح.',
            'email_not_confirmed': 'يجب تأكيد البريد الإلكتروني أولاً.',
            'signup_disabled': 'التسجيل معطل حالياً، حاول لاحقاً.'
        };
        return codeMap[error.code] || `خطأ برمز: ${error.code}`;
    }
    try {
        const str = JSON.stringify(error);
        if (str && str !== '{}') return str;
    } catch (e) {}
    const props = Object.getOwnPropertyNames(error).filter(p => p !== 'stack').map(p => `${p}: ${error[p]}`).join(', ');
    if (props) return `خطأ (${error.constructor?.name || 'Unknown'}): ${props}`;
    return 'حدث خطأ غير معروف (لم نتمكن من استخراج رسالة).';
}

async function signUpWithEmail() {
    const nameInput = document.getElementById('registerName');
    const emailInput = document.getElementById('registerEmail');
    const passwordInput = document.getElementById('registerPassword');
    const confirmInput = document.getElementById('registerConfirmPassword');
    const accountTypeSelect = document.getElementById('registerAccountType');
    const governorateSelect = document.getElementById('registerGovernorate');

    if (!emailInput || !passwordInput || !confirmInput || !accountTypeSelect) {
        showToast('النموذج غير مكتمل، أعد تحميل الصفحة', 'error');
        return;
    }

    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirm = confirmInput.value;
    let accountType = accountTypeSelect.value;
    let deliveryCenter = '';
    let governorate = governorateSelect ? governorateSelect.value : 'قنا';

    if (accountType === 'delivery') {
        const centerSelect = document.getElementById('deliveryCenterSelect');
        if (!centerSelect) { showToast('النموذج غير مكتمل', 'error'); return; }
        deliveryCenter = centerSelect.value;
        if (!deliveryCenter) { showToast('يرجى اختيار المركز للمندوب', 'warning'); return; }
    }

    if (!email || !password || !confirm) { showToast('يرجى ملء جميع الحقول المطلوبة', 'warning'); return; }
    if (password !== confirm) { showToast('كلمة المرور غير متطابقة', 'error'); return; }
    if (password.length < 6) { showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'warning'); return; }

    if (email === 'sa3dgelany@gmail.com') {
        accountType = 'founder';
        if (password !== '123456') {
            showToast('كلمة المرور الخاصة بحساب المؤسس غير صحيحة (يجب أن تكون 123456)', 'error');
            return;
        }
    }

    const metadata = {
        account_type: accountType,
        full_name: name || undefined,
        governorate: governorate
    };
    if (accountType === 'delivery') {
        metadata.center = deliveryCenter;
        metadata.status = 'pending';
    }

    showLoading(true);

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: metadata,
                emailRedirectTo: window.location.origin
            }
        });

        if (error) {
            console.group('❌ خطأ Supabase أثناء التسجيل');
            console.error('نوع الخطأ:', typeof error);
            console.error('منشئ الخطأ:', error.constructor?.name);
            console.dir(error, { depth: null, colors: true });
            console.groupEnd();
            const userMessage = extractErrorMessage(error);
            showToast(userMessage, 'error');
            showBearReaction(false);
            showLoading(false);
            return;
        }

        if (!data?.user) {
            showToast('فشل إنشاء الحساب، يرجى المحاولة مرة أخرى', 'error');
            showLoading(false);
            return;
        }

        if (data.user.identities?.length === 0) {
            showToast('هذا البريد مسجل بالفعل، يرجى تسجيل الدخول', 'warning');
            showScreen('loginScreen');
            showLoading(false);
            return;
        }

        try {
            const userDataToInsert = {
                id: data.user.id,
                name: name || data.user.email?.split('@')[0] || '',
                account_type: accountType,
                governorate: governorate || 'قنا',
                center: deliveryCenter || '',
                status: accountType === 'delivery' ? 'pending' : 'approved',
            };
            const { error: insertError } = await supabaseClient
                .from('user_data')
                .upsert(userDataToInsert, { onConflict: 'id' });
            if (insertError) {
                console.warn('⚠️ فشل إدراج بيانات المستخدم في user_data:', insertError);
                showToast('تم إنشاء الحساب ولكن فشل حفظ البيانات الشخصية، يمكنك تحديثها لاحقاً من الملف الشخصي.', 'warning');
            } else {
                console.log('✅ تم حفظ بيانات المستخدم في user_data بنجاح.');
            }
        } catch (insertErr) {
            console.warn('⚠️ خطأ غير متوقع أثناء إدراج user_data:', insertErr);
        }

        try {
            const { error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (signInError) {
                showToast('تم إنشاء الحساب ولكن فشل تسجيل الدخول التلقائي. سجل دخول يدوياً.', 'info');
                showScreen('loginScreen');
            } else {
                showToast('تم إنشاء الحساب وتسجيل الدخول بنجاح!', 'success');
                showBearReaction(true);
            }
        } catch (autoLoginErr) {
            console.warn('فشل تسجيل الدخول التلقائي:', autoLoginErr);
            showToast('تم التسجيل، يرجى تسجيل الدخول', 'info');
            showScreen('loginScreen');
        }

        if (accountType === 'founder') {
            setTimeout(() => initFounderSettings(), 2000);
        }

    } catch (unexpectedError) {
        console.error('❌ خطأ غير متوقع أثناء التسجيل:', unexpectedError);
        let msg = 'حدث خطأ غير متوقع. حاول مرة أخرى.';
        if (unexpectedError.message) msg = unexpectedError.message;
        else if (typeof unexpectedError === 'string') msg = unexpectedError;
        showToast(msg, 'error');
        showBearReaction(false);
    } finally {
        showLoading(false);
    }
}

async function logout(showConfirm = true) {
    if (showConfirm && !confirm('هل أنت متأكد من تسجيل الخروج؟')) return;
    showLoading(true);
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        sessionStorage.removeItem('pendingAccountType');
        appState.user = null;
        appState.userData = {};
        toggleLoginMenu(false);
        toggleSellerMenuItem(false);
        toggleDeliveryMenuItem(false);
        toggleFounderMenuItem(false);
        updateUserInfo(true);
        await loadCart();
        await updateCartBadgeFromDB();
        showScreen('homeScreen');
        showToast('تم تسجيل الخروج', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally { showLoading(false); }
}

async function switchAccount() { if (appState.user) await logout(false); showScreen('loginScreen'); }
function confirmLogout() { logout(true); }

function toggleLoginMenu(isLoggedIn) {
    const loginItem = document.getElementById('loginMenuItem');
    const logoutItem = document.getElementById('logoutMenuItem');
    if (loginItem) loginItem.style.display = isLoggedIn ? 'none' : 'flex';
    if (logoutItem) logoutItem.style.display = isLoggedIn ? 'flex' : 'none';
}
function toggleSellerMenuItem(isSeller) {
    const sellerItem = document.getElementById('sellerDashboardMenuItem');
    if (sellerItem) sellerItem.style.display = isSeller ? 'flex' : 'none';
    const sellerExtra = document.getElementById('sellerExtraFields');
    if (sellerExtra) sellerExtra.style.display = isSeller ? 'block' : 'none';
}
function toggleDeliveryMenuItem(isDelivery) {
    const deliveryItem = document.getElementById('deliveryDashboardMenuItem');
    if (deliveryItem) deliveryItem.style.display = isDelivery ? 'flex' : 'none';
}
function toggleFounderMenuItem(isFounder) {
    const founderItem = document.getElementById('founderDashboardMenuItem');
    if (founderItem) founderItem.style.display = isFounder ? 'flex' : 'none';
}

// ============================================================
// تحميل بيانات المستخدم
// ============================================================
async function loadUserData() {
    if (!appState.user) return;
    try {
        const { data, error } = await supabaseClient
            .from('user_data')
            .select('*')
            .eq('id', appState.user.id)
            .maybeSingle();

        const defaultData = {
            id: appState.user.id,
            name: appState.user.user_metadata?.full_name || appState.user.email?.split('@')[0] || '',
            phone: '',
            governorate: appState.user.user_metadata?.governorate || 'قنا',
            center: appState.user.user_metadata?.center || '',
            village: '',
            image_url: appState.user.user_metadata?.avatar_url || '',
            account_type: appState.user.user_metadata?.account_type || 'client',
            status: appState.user.user_metadata?.status || 'approved'
        };

        if (error) {
            console.error('خطأ في جلب بيانات المستخدم:', error);
            const { error: upsertError } = await supabaseClient.from('user_data').upsert(defaultData);
            if (upsertError) {
                console.error('فشل إنشاء سجل المستخدم:', upsertError);
                appState.userData = defaultData;
            } else {
                appState.userData = defaultData;
            }
        } else if (data) {
            appState.userData = data;
        } else {
            await supabaseClient.from('user_data').upsert(defaultData);
            appState.userData = defaultData;
        }

        if (!appState.userData || Object.keys(appState.userData).length === 0) {
            appState.userData = defaultData;
        }

        if (appState.userData) {
            appState.location = {
                governorate: appState.userData.governorate || 'قنا',
                center: appState.userData.center || '',
                village: appState.userData.village || ''
            };
        }

        updateUserInfo();
        updateWelcomeLocation();
        updateProfileLocation();

        const isSeller = appState.userData.account_type === 'seller';
        const isDelivery = appState.userData.account_type === 'delivery';
        const isFounder = appState.userData.account_type === 'founder';

        toggleSellerMenuItem(isSeller);
        toggleDeliveryMenuItem(isDelivery);
        toggleFounderMenuItem(isFounder);

        if (isSeller) {
            if (typeof addSellerStoreTools === 'function') {
                setTimeout(() => addSellerStoreTools(), 500);
            }
        }
        if (isFounder) {
            await initFounderSettings();
            await loadFounderStats();
            await loadPendingDeliveries();
        }

        await updateCartBadgeFromDB();
        await loadUnreadNotificationsCount();
        setupRealtimeSubscriptions();

    } catch (error) {
        console.error('loadUserData error:', error);
        showToast('حدث خطأ في تحميل بيانات المستخدم', 'error');
        if (!appState.userData || Object.keys(appState.userData).length === 0) {
            appState.userData = {
                id: appState.user.id,
                name: appState.user.email?.split('@')[0] || 'مستخدم',
                account_type: 'client'
            };
            updateUserInfo();
        }
    }
}

// ============================================================
// تحديث معلومات المستخدم في الواجهة
// ============================================================
function updateUserInfo(isGuest = false) {
    const welcomeName = document.getElementById('welcomeName');
    const welcomeAvatar = document.getElementById('welcomeAvatar');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileAvatar = document.getElementById('profileAvatar');
    const editAvatarImg = document.getElementById('editAvatarImg');
    const editAvatarIcon = document.getElementById('editAvatarIcon');

    if (isGuest || !appState.user) {
        if (welcomeName) welcomeName.textContent = 'مرحباً، زائر';
        if (welcomeAvatar) welcomeAvatar.innerHTML = '<i class="fas fa-user"></i>';
        if (profileName) profileName.textContent = 'زائر';
        if (profileEmail) profileEmail.textContent = 'غير مسجل';
        if (profileAvatar) profileAvatar.innerHTML = '<i class="fas fa-user"></i>';
        if (editAvatarImg) { editAvatarImg.style.display = 'none'; if (editAvatarIcon) editAvatarIcon.style.display = 'block'; }
    } else {
        const name = appState.userData.name || appState.user.user_metadata?.full_name || appState.user.email?.split('@')[0] || 'مستخدم';
        const email = appState.user.email;
        const avatar = appState.userData.image_url || appState.user.user_metadata?.avatar_url;

        if (welcomeName) welcomeName.textContent = `مرحباً، ${name}`;
        if (profileName) profileName.textContent = name;
        if (profileEmail) profileEmail.textContent = email;

        if (avatar) {
            const imgHtml = `<img src="${avatar}" alt="صورة المستخدم" onerror="this.onerror=null; this.parentElement.innerHTML='<i class=\"fas fa-user\"></i>';">`;
            if (welcomeAvatar) welcomeAvatar.innerHTML = imgHtml;
            if (profileAvatar) profileAvatar.innerHTML = imgHtml;
            if (editAvatarImg) {
                editAvatarImg.src = avatar;
                editAvatarImg.style.display = 'block';
                if (editAvatarIcon) editAvatarIcon.style.display = 'none';
                editAvatarImg.onerror = function() {
                    this.style.display = 'none';
                    if (editAvatarIcon) editAvatarIcon.style.display = 'block';
                };
            }
        } else {
            if (welcomeAvatar) welcomeAvatar.innerHTML = '<i class="fas fa-user"></i>';
            if (profileAvatar) profileAvatar.innerHTML = '<i class="fas fa-user"></i>';
            if (editAvatarImg) { editAvatarImg.style.display = 'none'; if (editAvatarIcon) editAvatarIcon.style.display = 'block'; }
        }

        const editName = document.getElementById('editName');
        if (editName) editName.value = appState.userData.name || '';
        const editPhone = document.getElementById('editPhone');
        if (editPhone) editPhone.value = appState.userData.phone || '';
        const editCenter = document.getElementById('editCenter');
        if (editCenter) editCenter.value = appState.userData.center || '';
        const editVillage = document.getElementById('editVillage');
        if (editVillage) editVillage.value = appState.userData.village || '';
        const editUsername = document.getElementById('editUsername');
        if (editUsername) editUsername.value = appState.userData.username || '';
        const editBio = document.getElementById('editBio');
        if (editBio) editBio.value = appState.userData.bio || '';
    }
}

// ============================================================
// الموقع
// ============================================================
function loadVillagesForCenter(center, selectedVillage = '') {
    const villageSelect = document.getElementById('villageSelect');
    if (!villageSelect) { console.warn('⚠️ عنصر villageSelect غير موجود في الصفحة'); return; }
    villageSelect.innerHTML = '<option value="">اختر القرية</option>';
    if (center && appState.villagesByCenter[center]) {
        const villages = appState.villagesByCenter[center];
        villages.forEach(village => {
            const option = document.createElement('option');
            option.value = village;
            option.textContent = village;
            villageSelect.appendChild(option);
        });
    } else {
        console.log(`لا توجد قرى مسجلة للمركز: ${center}`);
    }
    if (selectedVillage && villageSelect.querySelector(`option[value="${selectedVillage}"]`)) {
        villageSelect.value = selectedVillage;
    }
}

async function saveLocation() {
    const governorateSelect = document.getElementById('governorateSelect');
    const centerSelect = document.getElementById('centerSelect');
    const villageSelect = document.getElementById('villageSelect');
    
    if (!centerSelect || !villageSelect) { showToast('النموذج غير متوفر', 'error'); return; }
    
    const governorate = governorateSelect ? governorateSelect.value : 'قنا';
    const center = centerSelect.value;
    const village = villageSelect.value;
    
    if (!center || !village) { showToast('يرجى اختيار المركز والقرية', 'warning'); return; }
    
    appState.location = { governorate, center, village };
    
    if (appState.user) {
        try {
            const { error } = await supabaseClient
                .from('user_data')
                .upsert({ id: appState.user.id, governorate, center, village });
            if (error) throw error;
            appState.userData.governorate = governorate;
            appState.userData.center = center;
            appState.userData.village = village;
        } catch (error) {
            showToast('فشل حفظ الموقع في قاعدة البيانات', 'error');
            console.error(error);
            return;
        }
    } else {
        localStorage.setItem('misarUserLocation', JSON.stringify(appState.location));
    }
    
    updateWelcomeLocation();
    updateProfileLocation();
    showToast('تم حفظ موقعك بنجاح', 'success');
    
    if (appState.previousScreen === 'profileScreen') {
        showScreen('profileScreen');
    } else {
        showScreen('homeScreen');
    }
}

function openLocationSettings() {
    showScreen('locationScreen');
    setTimeout(() => {
        const loc = appState.user ? appState.userData : appState.location;
        if (!loc) return;
        const center = loc.center || '';
        const village = loc.village || '';
        const centerSelect = document.getElementById('centerSelect');
        if (centerSelect) centerSelect.value = center;
        loadVillagesForCenter(center, village);
    }, 150);
}

function updateWelcomeLocation() {
    const el = document.getElementById('welcomeLocation');
    if (!el) return;
    const loc = appState.user ? appState.userData : appState.location;
    if (loc && loc.center) {
        const parts = [loc.governorate || 'قنا', loc.center, loc.village || ''].filter(Boolean);
        el.textContent = `📍 ${parts.join(' - ')}`;
    } else {
        el.textContent = '📍 موقعك: غير محدد';
    }
}

function updateProfileLocation() {
    const el = document.getElementById('profileLocation');
    if (!el) return;
    const loc = appState.user ? appState.userData : appState.location;
    if (loc && loc.center) {
        const parts = [loc.governorate || 'قنا', loc.center, loc.village || ''].filter(Boolean);
        el.textContent = `المنطقة: ${parts.join(' - ')}`;
    } else {
        el.textContent = 'المنطقة: غير محددة';
    }
}

// ============================================================
// حفظ الملف الشخصي
// ============================================================
async function saveProfile() {
    if (!appState.user) return showToast('يجب تسجيل الدخول أولاً', 'warning');
    const editName = document.getElementById('editName');
    const editPhone = document.getElementById('editPhone');
    if (!editName || !editPhone) { showToast('النموذج غير مكتمل', 'error'); return; }
    const name = editName.value.trim();
    const phone = editPhone.value.trim();
    const editUsername = document.getElementById('editUsername');
    const editBio = document.getElementById('editBio');
    const username = editUsername ? editUsername.value.trim() : null;
    const bio = editBio ? editBio.value.trim() : null;
    const updates = { id: appState.user.id };
    if (name) updates.name = name;
    if (phone) updates.phone = phone;
    if (appState.userData.account_type === 'seller') {
        if (username) {
            const { data: existing } = await supabaseClient.from('user_data').select('id').eq('username', username).neq('id', appState.user.id).maybeSingle();
            if (existing) { showToast('اسم المستخدم مستخدم بالفعل', 'error'); return; }
            updates.username = username;
        }
        if (bio) updates.bio = bio;
    }
    if (Object.keys(updates).length === 1) return showToast('لا توجد تغييرات', 'info');
    showLoading(true);
    try {
        const { error } = await supabaseClient.from('user_data').upsert(updates);
        if (error) throw error;
        await loadUserData();
        showToast('تم حفظ التغييرات', 'success');
        goBack();
        if (appState.userData.account_type === 'seller') {
            if (typeof addSellerStoreTools === 'function') {
                addSellerStoreTools();
                if (typeof updateStoreTools === 'function') updateStoreTools();
            }
        }
    } catch (error) {
        showToast(error.message, 'error');
    } finally { showLoading(false); }
}

// ============================================================
// رفع الصورة الشخصية
// ============================================================
document.getElementById('avatarUpload')?.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file || !appState.user) return;
    if (!file.type.startsWith('image/')) return showToast('يرجى اختيار صورة', 'warning');
    if (file.size > 5 * 1024 * 1024) return showToast('الحد الأقصى 5 ميجابايت', 'warning');

    const reader = new FileReader();
    reader.onload = function(ev) {
        const preview = document.getElementById('editAvatarImg');
        if (preview) {
            preview.src = ev.target.result;
            preview.style.display = 'block';
            document.getElementById('editAvatarIcon').style.display = 'none';
        }
    };
    reader.readAsDataURL(file);

    showLoading(true);
    try {
        const compressed = await compressImage(file, 512, 512, 0.8);
        const ext = file.name.split('.').pop();
        const path = `avatars/${appState.user.id}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabaseClient.storage.from('user-images').upload(path, compressed);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabaseClient.storage.from('user-images').getPublicUrl(path);

        const { error: updateError } = await supabaseClient
            .from('user_data')
            .upsert({ id: appState.user.id, image_url: publicUrl });
        if (updateError) throw updateError;

        appState.userData.image_url = publicUrl;
        updateUserInfo();
        showToast('تم رفع الصورة الشخصية بنجاح', 'success');
    } catch (err) {
        showToast(err.message, 'error');
        console.error(err);
    } finally { showLoading(false); }
});

// ============================================================
// إعدادات المؤسس (رؤية الصفحة)
// ============================================================
async function loadGlobalFounderVisibility() {
    try {
        const { data, error } = await supabaseClient
            .from('founder_settings')
            .select('page_visible')
            .eq('id', 1)
            .maybeSingle();

        if (error) throw error;

        if (data && data.page_visible !== undefined) {
            appState.founderPageVisible = data.page_visible;
            localStorage.setItem('founder_page_visible', String(data.page_visible));
            console.log('✅ تم تحميل رؤية المؤسس من DB:', appState.founderPageVisible);
        } else {
            const saved = localStorage.getItem('founder_page_visible');
            appState.founderPageVisible = saved !== null ? saved === 'true' : true;
        }
    } catch (error) {
        console.warn('⚠️ فشل تحميل إعدادات المؤسس من DB، استخدام localStorage:', error);
        const saved = localStorage.getItem('founder_page_visible');
        appState.founderPageVisible = saved !== null ? saved === 'true' : true;
    }

    const toggleSwitch = document.getElementById('toggleFounderPage');
    if (toggleSwitch && appState.user && appState.userData.account_type === 'founder') {
        toggleSwitch.checked = appState.founderPageVisible;
    }
}

async function handleToggleChange(e) {
    const newValue = e.target.checked;
    appState.founderPageVisible = newValue;
    localStorage.setItem('founder_page_visible', String(newValue));

    try {
        const { error } = await supabaseClient
            .from('founder_settings')
            .upsert({ id: 1, page_visible: newValue, updated_at: new Date() });

        if (error) throw error;
        showToast(newValue ? '✅ تم إظهار صفحة المؤسس للجميع' : '✅ تم إخفاء صفحة المؤسس عن الجميع', 'success');
    } catch (error) {
        appState.founderPageVisible = !newValue;
        localStorage.setItem('founder_page_visible', String(!newValue));
        const toggleSwitch = document.getElementById('toggleFounderPage');
        if (toggleSwitch) toggleSwitch.checked = !newValue;
        showToast('❌ فشل حفظ الإعداد في قاعدة البيانات: ' + error.message, 'error');
        console.error('❌ فشل upsert founder_settings:', error);
    }
}

async function initFounderSettings() {
    await loadGlobalFounderVisibility();
    const toggleSwitch = document.getElementById('toggleFounderPage');
    if (toggleSwitch && appState.user && appState.userData.account_type === 'founder') {
        toggleSwitch.removeEventListener('change', handleToggleChange);
        toggleSwitch.addEventListener('change', handleToggleChange);
    }
}

// ============================================================
// دوال المؤسس (إحصائيات المشاركات والمشاهدات)
// ============================================================
async function loadFounderStats() {
    try {
        const { data, error } = await supabaseClient.from('founder_views').select('count').eq('id',1).single();
        if (!error && data) appState.founderViews = data.count || 0;
        else appState.founderViews = parseInt(localStorage.getItem('founder_views') || '0');
    } catch(e) { appState.founderViews = parseInt(localStorage.getItem('founder_views') || '0'); }
    const viewsEl = document.getElementById('founderViewsCount');
    if (viewsEl) viewsEl.textContent = appState.founderViews;
    try {
        const { data, error } = await supabaseClient.from('founder_shares').select('count');
        if (!error && data) {
            const total = data.reduce((sum, s) => sum + (s.count || 0), 0);
            const sharesEl = document.getElementById('founderSharesTotal');
            if (sharesEl) sharesEl.textContent = total;
        } else {
            let total = 0;
            ['whatsapp','facebook','twitter','copy'].forEach(t => {
                total += parseInt(localStorage.getItem(`share_${t}`) || '0');
            });
            const sharesEl = document.getElementById('founderSharesTotal');
            if (sharesEl) sharesEl.textContent = total;
        }
    } catch(e) {
        let total = 0;
        ['whatsapp','facebook','twitter','copy'].forEach(t => {
            total += parseInt(localStorage.getItem(`share_${t}`) || '0');
        });
        const sharesEl = document.getElementById('founderSharesTotal');
        if (sharesEl) sharesEl.textContent = total;
    }
}
async function refreshFounderStats() { await loadFounderStats(); showToast('تم تحديث الإحصائيات', 'success'); }
async function trackFounderView() {
    try { await supabaseClient.rpc('increment_founder_view'); } catch(e) {
        let current = parseInt(localStorage.getItem('founder_views') || '0');
        current++;
        localStorage.setItem('founder_views', current);
        appState.founderViews = current;
    }
    const viewsEl = document.getElementById('founderViewsCount');
    if (viewsEl) viewsEl.textContent = appState.founderViews;
}
async function trackShare(shareType) {
    try {
        const { data, error } = await supabaseClient.from('founder_shares').select('count').eq('share_type', shareType).maybeSingle();
        if (error) throw error;
        let newCount = 1;
        if (data && data.count !== undefined) {
            newCount = data.count + 1;
            await supabaseClient.from('founder_shares').update({ count: newCount, updated_at: new Date() }).eq('share_type', shareType);
        } else {
            await supabaseClient.from('founder_shares').insert({ share_type: shareType, count: 1 });
        }
        const span = document.getElementById(`shareCount_${shareType}`);
        if (span) span.textContent = newCount;
        const { data: allShares } = await supabaseClient.from('founder_shares').select('count');
        if (allShares) {
            const total = allShares.reduce((sum, s) => sum + (s.count || 0), 0);
            const sharesEl = document.getElementById('founderSharesTotal');
            if (sharesEl) sharesEl.textContent = total;
        }
    } catch (err) {
        console.warn('فشل تحديث قاعدة بيانات المشاركات، استخدام localStorage', err);
        let localCount = parseInt(localStorage.getItem(`share_${shareType}`) || '0');
        localCount++;
        localStorage.setItem(`share_${shareType}`, localCount);
        const span = document.getElementById(`shareCount_${shareType}`);
        if (span) span.textContent = localCount;
        let total = 0;
        ['whatsapp','facebook','twitter','copy'].forEach(t => {
            total += parseInt(localStorage.getItem(`share_${t}`) || '0');
        });
        const sharesEl = document.getElementById('founderSharesTotal');
        if (sharesEl) sharesEl.textContent = total;
    }
}
async function loadShareCounts() {
    try {
        const { data, error } = await supabaseClient.from('founder_shares').select('share_type, count');
        if (error) throw error;
        if (data && data.length) {
            data.forEach(item => {
                const span = document.getElementById(`shareCount_${item.share_type}`);
                if (span) span.textContent = item.count;
            });
            const total = data.reduce((sum, s) => sum + (s.count || 0), 0);
            const sharesEl = document.getElementById('founderSharesTotal');
            if (sharesEl) sharesEl.textContent = total;
        } else {
            ['whatsapp', 'facebook', 'twitter', 'copy'].forEach(type => {
                const count = localStorage.getItem(`share_${type}`) || 0;
                const span = document.getElementById(`shareCount_${type}`);
                if (span) span.textContent = count;
            });
            let total = 0;
            ['whatsapp','facebook','twitter','copy'].forEach(t => {
                total += parseInt(localStorage.getItem(`share_${t}`) || '0');
            });
            const sharesEl = document.getElementById('founderSharesTotal');
            if (sharesEl) sharesEl.textContent = total;
        }
    } catch (err) { console.warn(err); }
}
function getFounderShareLink() {
    const founderUsername = 'mohamed_saad';
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?founder=${founderUsername}`;
}
async function shareFounderPage(method) {
    await loadGlobalFounderVisibility();
    if (!appState.founderPageVisible) {
        showToast('صفحة المؤسس مخفية حالياً من قبل الإدارة، لا يمكن مشاركتها', 'warning');
        return;
    }
    const link = getFounderShareLink();
    const text = `تعرف على مؤسس شركة Misar Systems المهندس محمد سعد وقصة نجاحه من خلال هذا الرابط:`;
    let shareUrl = '';
    switch(method) {
        case 'whatsapp': shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + link)}`; window.open(shareUrl, '_blank'); break;
        case 'facebook': shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(text)}`; window.open(shareUrl, '_blank'); break;
        case 'twitter': shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`; window.open(shareUrl, '_blank'); break;
        case 'copy': navigator.clipboard.writeText(link).then(() => showToast('تم نسخ رابط صفحة المؤسس بنجاح!', 'success')).catch(() => showToast('فشل نسخ الرابط، حاول يدوياً', 'error')); break;
    }
    trackShare(method);
}

function openFounderProfile() {
    if (!appState.founderPageVisible) {
        showToast('⛔ صفحة المؤسس غير متاحة حالياً', 'warning');
        return;
    }
    closeChatbot();
    const founderScreen = document.getElementById('founderProfileScreen');
    if (founderScreen) founderScreen.classList.add('active');
    loadShareCounts();
    const shareLinkSpan = document.getElementById('founderShareLink');
    if (shareLinkSpan) shareLinkSpan.textContent = getFounderShareLink();
    trackFounderView();
}

function closeFounderProfile() {
    const founderScreen = document.getElementById('founderProfileScreen');
    if (founderScreen) founderScreen.classList.remove('active');
    openChatbot();
}
function openImageModal() {
    const img = document.querySelector('.founder-avatar img');
    if (!img) return;
    const modalImage = document.getElementById('modalImage');
    const imageModal = document.getElementById('imageModal');
    if (modalImage) modalImage.src = img.src;
    if (imageModal) imageModal.classList.add('active');
}
function closeImageModal(event) {
    if (event.target === document.getElementById('imageModal') || event.target.classList.contains('close-modal')) {
        document.getElementById('imageModal').classList.remove('active');
    }
}
function contactDeveloper() {
    window.open('https://app.fastbots.ai/embed/cmillclid07mep81pmwkjqyq6', '_blank');
}

// ============================================================
// طلبات انضمام المناديب
// ============================================================
async function loadPendingDeliveries() {
    if (!appState.user || appState.userData.account_type !== 'founder') return;
    try {
        const { data, error } = await supabaseClient.from('user_data').select('id, name, email, phone, center, created_at').eq('account_type', 'delivery').eq('status', 'pending');
        if (error) throw error;
        const container = document.getElementById('pendingDeliveriesList');
        if (!container) return;
        if (!data || data.length === 0) { container.innerHTML = '<p>لا توجد طلبات انضمام حالياً</p>'; return; }
        container.innerHTML = '';
        data.forEach(del => {
            const div = document.createElement('div');
            div.className = 'pending-delivery-item';
            div.innerHTML = `<div class="pending-info"><div class="pending-name">${escapeHTML(del.name || del.email)}</div><div class="pending-email">${del.email} | ${del.phone || 'لا يوجد هاتف'} | المركز: ${del.center || 'غير محدد'}</div></div><div class="pending-actions"><button class="approve-btn" onclick="approveDeliveryPerson('${del.id}')">قبول</button><button class="reject-btn" onclick="rejectDeliveryPerson('${del.id}')">رفض</button></div>`;
            container.appendChild(div);
        });
    } catch(err) {
        console.error(err);
        const container = document.getElementById('pendingDeliveriesList');
        if (container) container.innerHTML = '<p>حدث خطأ في تحميل الطلبات</p>';
    }
}

async function approveDeliveryPerson(userId) {
    if (!userId) { showToast('معرف المندوب غير صحيح', 'error'); return; }
    showLoading(true);
    try {
        const { data: deliveryData, error: fetchError } = await supabaseClient
            .from('user_data')
            .select('id, name, email, center')
            .eq('id', userId)
            .maybeSingle();
        if (fetchError) throw fetchError;
        if (!deliveryData) { showToast('المندوب غير موجود', 'error'); return; }

        const updates = { status: 'approved', updated_at: new Date().toISOString() };
        const { data, error: updateError } = await supabaseClient
            .from('user_data')
            .update(updates)
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (updateError) throw updateError;
        if (!data) { showToast('فشل تحديث بيانات المندوب', 'error'); return; }

        await sendNotification(
            userId,
            '🎉 تم قبول طلب الانضمام كمندوب',
            `مبروك! تم قبول طلبك للعمل كمندوب في مركز ${deliveryData.center || 'غير محدد'}. يمكنك الآن استلام الطلبات المتاحة.`
        );

        showToast(`تم قبول المندوب ${deliveryData.name || ''} بنجاح`, 'success');
        
        await loadPendingDeliveries();
        if (typeof displayAllDeliveryPersons === 'function') {
            await displayAllDeliveryPersons();
        }
        
        if (appState.user && appState.user.id === userId) {
            appState.userData.status = 'approved';
            if (appState.currentScreen === 'deliveryDashboardScreen') {
                if (typeof refreshDeliveryDashboard === 'function') {
                    await refreshDeliveryDashboard();
                }
            }
        }

    } catch(err) {
        console.error('❌ خطأ في قبول المندوب:', err);
        showToast(err.message || 'حدث خطأ أثناء قبول المندوب', 'error');
    } finally { showLoading(false); }
}

async function rejectDeliveryPerson(userId) {
    if (!confirm('هل أنت متأكد من رفض هذا المندوب؟ سيتم حذف حسابه.')) return;
    showLoading(true);
    try {
        await supabaseClient.from('user_data').delete().eq('id', userId);
        showToast('تم رفض المندوب وحذف الحساب', 'success');
        await loadPendingDeliveries();
        if (typeof displayAllDeliveryPersons === 'function') await displayAllDeliveryPersons();
    } catch(err) {
        showToast(err.message, 'error');
    } finally { showLoading(false); }
}

// ============================================================
// إشعارات واشتراكات
// ============================================================

// ========== إشعارات النظام (تظهر على الهاتف حتى لو كان التطبيق مغلقاً) ==========
const APP_ICON_URL = 'https://i.ibb.co/XktM4crn/1767120438295.png';

// طلب إذن عرض الإشعارات من المتصفح
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn('إشعارات النظام غير مدعومة في هذا المتصفح');
        return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
        console.warn('تم رفض إذن الإشعارات من قبل المستخدم');
        return false;
    }
    try {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    } catch (err) {
        console.warn('فشل طلب إذن الإشعارات:', err);
        return false;
    }
}

// عرض إشعار نظام على الجهاز الحالي
function showSystemNotification(title = 'Misar Systems', message = 'لديك إشعار جديد', data = {}) {
    try {
        if (!appState.notificationsEnabled) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        const url = data.url || (window.location.origin + window.location.pathname);
        const notification = new Notification(title, {
            body: message,
            icon: data.icon || APP_ICON_URL,
            badge: APP_ICON_URL,
            tag: data.tag || 'misar-notification',
            vibrate: [200, 100, 200],
            data: { url }
        });

        notification.onclick = function() {
            try {
                window.focus();
                notification.close();
                if (data.url) window.location.href = data.url;
            } catch (e) { window.open(url, '_blank'); }
        };

        // إغلاق تلقائي بعد 10 ثوانٍ
        setTimeout(() => notification.close(), 10000);
    } catch (err) {
        console.warn('تعذّر عرض إشعار النظام:', err);
    }
}

// تسجيل خدمة الإشعارات (طلب الإذن + تثبيت Service Worker)
async function setupSystemNotifications() {
    if (!('Notification' in window)) return false;
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    // التأكد من تسجيل Service Worker ليدعم الإشعارات حتى مع إغلاق التطبيق
if ('serviceWorker' in navigator && !appState.swRegistration) {
        try {
            const reg = await navigator.serviceWorker.ready;
            appState.swRegistration = reg;
        } catch (e) {
            console.warn('لا يمكن الوصول إلى Service Worker:', e);
        }
    }
    return true;
}

// ============================================================
// إعدادات الإشعارات (تفعيل/تعطيل إشعارات النظام)
// ============================================================
function showNotificationSettingsModal() {
    const modal = document.getElementById('notificationSettingsModal');
    if (modal) modal.classList.add('active');
    const toggle = document.getElementById('notificationsToggle');
    if (toggle) toggle.checked = !!appState.notificationsEnabled;
    updateNotificationSettingsStatus();
}

function updateNotificationSettingsStatus() {
    const statusEl = document.getElementById('notificationSettingsStatus');
    if (!statusEl) return;
    const supported = 'Notification' in window;
    if (!supported) {
        statusEl.textContent = 'إشعارات النظام غير مدعومة في هذا المتصفح';
        statusEl.style.color = '#e53935';
        return;
    }
    if (!appState.notificationsEnabled) {
        statusEl.textContent = 'إشعارات النظام معطلة';
        statusEl.style.color = '#e53935';
        return;
    }
    if (Notification.permission === 'granted') {
        statusEl.textContent = 'مفعلة — ستظهر الإشعارات على جهازك';
        statusEl.style.color = '#2e7d32';
    } else if (Notification.permission === 'denied') {
        statusEl.textContent = 'تم رفض الإذن من المتصفح. فعّل الإذن من إعدادات المتصفح.';
        statusEl.style.color = '#e53935';
    } else {
        statusEl.textContent = 'لم يتم طلب إذن الإشعارات بعد';
        statusEl.style.color = '#f57f17';
    }
}

async function toggleSystemNotifications(enabled) {
    if (enabled) {
        if (!('Notification' in window)) {
            showToast('إشعارات النظام غير مدعومة في هذا المتصفح', 'error');
            return;
        }
        const granted = await setupSystemNotifications();
        if (!granted) {
            appState.notificationsEnabled = false;
            localStorage.setItem('misarNotificationsEnabled', 'false');
            const toggle = document.getElementById('notificationsToggle');
            if (toggle) toggle.checked = false;
            updateNotificationSettingsStatus();
            showToast('تم رفض إذن الإشعارات', 'error');
            return;
        }
        appState.notificationsEnabled = true;
        localStorage.setItem('misarNotificationsEnabled', 'true');
        showToast('تم تفعيل إشعارات النظام', 'success');
    } else {
        appState.notificationsEnabled = false;
        localStorage.setItem('misarNotificationsEnabled', 'false');
        showToast('تم تعطيل إشعارات النظام', 'info');
    }
    updateNotificationSettingsStatus();
}

function sendTestNotification() {
    if (!appState.notificationsEnabled) {
        showToast('يرجى تفعيل الإشعارات أولاً', 'warning');
        return;
    }
    if (!('Notification' in window)) {
        showToast('إشعارات النظام غير مدعومة', 'error');
        return;
    }
    if (Notification.permission !== 'granted') {
        showToast('لم يتم منح إذن الإشعارات', 'error');
        return;
    }
    showSystemNotification(
        'Misar Systems',
        '🎉 هذا إشعار تجريبي! الإشعارات تعمل بنجاح.',
        { tag: 'misar-test-notification' }
    );
    showToast('تم إرسال إشعار تجريبي', 'success');
}

async function sendNotification(userId, title, message, data = {}) {
    try {
        await supabaseClient.from('notifications').insert({
            user_id: userId, title, message, data, created_at: new Date(), is_read: false
        });
        // إذا كان هذا الإشعار موجهاً للمستخدم الحالي، نعرضه كإشعار نظام فوراً
        if (appState.user && appState.user.id === userId) {
            showSystemNotification(title, message, data);
        }
    } catch (error) { console.warn('فشل إرسال الإشعار', error); }
}
async function loadUnreadNotificationsCount() {
    if (!appState.user) return;
    try {
        const { count, error } = await supabaseClient.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', appState.user.id).eq('is_read', false);
        if (!error) {
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.textContent = count || 0;
                badge.style.display = count > 0 ? 'flex' : 'none';
            }
        }
    } catch(e) { console.warn('فشل تحميل عدد الإشعارات', e); }
}
function setupRealtimeSubscriptions() {
    if (!appState.user) return;
    if (appState.ordersSubscription) appState.ordersSubscription.unsubscribe();
    appState.ordersSubscription = supabaseClient.channel('orders-channel')
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'orders'
        }, (payload) => {
            console.log('Order change:', payload);
            if (appState.currentScreen === 'sellerDashboardScreen' && appState.userData.account_type === 'seller') {
                if (typeof refreshSellerDashboard === 'function') refreshSellerDashboard();
            } else if (appState.currentScreen === 'deliveryDashboardScreen') {
                if (typeof refreshDeliveryDashboard === 'function') refreshDeliveryDashboard();
            } else if (appState.currentScreen === 'ordersScreen') {
                if (typeof loadBuyerOrdersWithTimeline === 'function') loadBuyerOrdersWithTimeline();
            }
            loadUnreadNotificationsCount();
        }).subscribe();
    if (appState.notificationsSubscription) appState.notificationsSubscription.unsubscribe();
    appState.notificationsSubscription = supabaseClient.channel('notifications-channel')
        .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${appState.user.id}`
}, (payload) => {
            showToast(payload.new.title, 'info');
            // عرض إشعار النظام أيضاً (يظهر حتى عند تصغير التطبيق أو إغلاقه)
            showSystemNotification(payload.new.title, payload.new.message, payload.new.data || {});
            loadUnreadNotificationsCount();
        }).subscribe();
}

// ============================================================
// التنقل بين الشاشات
// ============================================================
function showScreen(screenId) {
    if (screenId === 'sellerDashboardScreen') {
        if (!appState.user || appState.userData.account_type !== 'seller') {
            showToast('هذه الصفحة مخصصة للبائعين فقط', 'error');
            showScreen('homeScreen');
            return;
        }
        if (typeof refreshSellerDashboard === 'function') refreshSellerDashboard();
    }
    if (screenId === 'deliveryDashboardScreen') {
        if (!appState.user || appState.userData.account_type !== 'delivery') {
            showToast('هذه الصفحة مخصصة للمندوبين فقط', 'error');
            showScreen('homeScreen');
            return;
        }
        if (typeof refreshDeliveryDashboard === 'function') refreshDeliveryDashboard();
    }
    if (screenId === 'founderDashboardScreen') {
        if (!appState.user || appState.userData.account_type !== 'founder') {
            showToast('هذه الصفحة مخصصة للمؤسس فقط', 'error');
            showScreen('homeScreen');
            return;
        }
        loadGlobalFounderVisibility();
        loadFounderStats();
        loadPendingDeliveries();
        if (typeof displayAllDeliveryPersons === 'function') displayAllDeliveryPersons();
    }
    if (screenId === 'ordersScreen') {
        if (typeof loadBuyerOrdersWithTimeline === 'function') loadBuyerOrdersWithTimeline();
    }
    if (screenId === 'editProfileScreen') {
        updateUserInfo();
    }

    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
        screen.classList.add('hidden');
    });
    updateNavigation(screenId);
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.remove('hidden');
        screen.classList.add('active');
        appState.previousScreen = appState.currentScreen;
        appState.currentScreen = screenId;
        const backBtn = document.querySelector('.back-btn');
        if (backBtn) backBtn.classList.toggle('active', screenId !== 'homeScreen' && screenId !== 'locationScreen');
    }
    if (screenId === 'marketScreen') {
        const searchInput = document.getElementById('marketSearchInput');
        if (searchInput) { searchInput.value = ''; }
        const clearSearch = document.getElementById('clearSearch');
        if (clearSearch) clearSearch.style.display = 'none';
        if (typeof loadMarketProducts === 'function') loadMarketProducts();
    }
    if (screenId === 'profileScreen') {
        updateProfileLocation();
        // تحديث عداد عدد الطلبات في بطاقة "طلبات" بالملف الشخصي
        if (appState.user && typeof loadBuyerOrdersWithTimeline === 'function') {
            loadBuyerOrdersWithTimeline();
        } else {
            const profileOrdersCountEl = document.getElementById('profileOrdersCount');
            if (profileOrdersCountEl) profileOrdersCountEl.textContent = '0';
        }
    }
    if (screenId === 'editProfileScreen' && appState.user) updateProfileLocation();
    if (screenId === 'servicesScreen') {
        if (typeof loadServices === 'function') loadServices();
    }
    if (screenId === 'cartScreen') {
        if (typeof loadCart === 'function') loadCart();
    }
    if (screenId === 'loginScreen' || screenId === 'registerScreen') setTimeout(addInputInteractions, 50);
}
function goBack() { showScreen(appState.previousScreen || 'homeScreen'); }
function updateNavigation(screenId) {
    document.querySelectorAll('.nav-item').forEach((item, index) => {
        item.classList.remove('active');
        if (screenId === 'homeScreen' && index === 0) item.classList.add('active');
        else if (screenId === 'marketScreen' && index === 1) item.classList.add('active');
        else if (screenId === 'servicesScreen' && index === 2) item.classList.add('active');
        else if (screenId === 'cartScreen' && index === 3) item.classList.add('active');
        else if (screenId === 'profileScreen' && index === 4) item.classList.add('active');
    });
}
function skipLogin() { showScreen('homeScreen'); }
function addInputInteractions() {
    const inputs = document.querySelectorAll('#loginScreen input, #registerScreen input');
    const passwordInputs = document.querySelectorAll('#loginPassword, #registerPassword');
    inputs.forEach(inp => {
        inp.addEventListener('focus', () => setBearExpression('blink'));
        inp.addEventListener('blur', () => setBearExpression(''));
    });
    passwordInputs.forEach(pw => {
        pw.addEventListener('focus', () => setBearExpression('covering'));
        pw.addEventListener('blur', () => setBearExpression(''));
    });
}
function togglePasswordVisibility(inputId, toggleEl) {
    const input = document.getElementById(inputId);
    if (!input || !toggleEl) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    const icon = toggleEl.querySelector('i');
    if (icon) {
        icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;

// ============================================================
// الدردشة
// ============================================================
function openChatbot() {
    const chatbotScreen = document.getElementById('chatbotScreen');
    if (chatbotScreen) chatbotScreen.classList.add('active');
    const badge = document.getElementById('chatbotBadge');
    if (badge) badge.style.display = 'none';
    const messages = document.getElementById('chatMessages');
    if (messages) messages.scrollTop = messages.scrollHeight;
}
function closeChatbot() {
    const chatbotScreen = document.getElementById('chatbotScreen');
    if (chatbotScreen) chatbotScreen.classList.remove('active');
}
function sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    addMessage(msg, 'user');
    input.value = '';
    setTimeout(() => {
        addMessage(getBotResponse(msg), 'bot');
        const messages = document.getElementById('chatMessages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    }, 400);
}
function sendSuggestion(text) {
    addMessage(text, 'user');
    setTimeout(() => {
        addMessage(getBotResponse(text), 'bot');
        const messages = document.getElementById('chatMessages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    }, 400);
}
function addMessage(text, sender) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}
function getBotResponse(msg) {
    const m = msg.toLowerCase();
    if (m.includes('السلام') || m.includes('اهلا')) return 'وعليكم السلام! كيف يمكنني مساعدتك؟ 😊';
    if (m.includes('منتجات')) return 'لدينا إلكترونيات، أزياء، أثاث، أطعمة. تصفح المتجر!';
    if (m.includes('اشتري') || m.includes('شراء')) return 'اذهب للمتجر، أضف المنتج للسلة ثم أكمل الطلب من صفحة السلة.';
    if (m.includes('عروض')) return 'خصم 20% على الأثاث، وساعة هواوي بسعر مميز.';
    if (m.includes('صيانة')) return 'خدمات الصيانة متوفرة: أجهزة، سباكة، كهرباء. احجز من قسم الخدمات.';
    if (m.includes('طلب')) return 'تابع طلباتك من صفحة "طلباتي" في الملف الشخصي.';
    if (m.includes('خدمة العملاء') || m.includes('الدعم')) return 'تواصل معنا: support@misar.com أو 19000.';
    if (m.includes('شكرا')) return 'الشكر لله، دائمًا في خدمتك!';
    return 'عذرًا، لم أفهم. جرب الاقتراحات أعلاه.';
}

// ============================================================
// دوال الأمان (تغيير كلمة المرور، إعدادات الأمان)
// ============================================================
function showChangePasswordModal() {
    if (!appState.user) { showToast('يجب تسجيل الدخول أولاً', 'warning'); return; }
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.classList.add('active');
}
function showSecurityModal() {
    if (!appState.user) { showToast('يجب تسجيل الدخول أولاً', 'warning'); return; }
    const modal = document.getElementById('securityModal');
    if (modal) modal.classList.add('active');
}
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}
function changePassword() {
    const oldPass = document.getElementById('oldPassword');
    const newPass = document.getElementById('newPassword');
    const confirmPass = document.getElementById('confirmNewPassword');
    if (!oldPass || !newPass || !confirmPass) { showToast('يرجى ملء جميع الحقول', 'warning'); return; }
    if (newPass.value !== confirmPass.value) { showToast('كلمة المرور الجديدة غير متطابقة', 'error'); return; }
    showToast('تم تغيير كلمة المرور (وهمي)', 'success');
    closeModal('changePasswordModal');
    oldPass.value = '';
    newPass.value = '';
    confirmPass.value = '';
}
function saveSecuritySettings() {
    const twoFactor = document.getElementById('twoFactorCheck');
    const enabled = twoFactor ? twoFactor.checked : false;
    showToast(`تم حفظ إعدادات الأمان (المصادقة الثنائية: ${enabled ? 'مفعلة' : 'غير مفعلة'})`, 'success');
    closeModal('securityModal');
}

// ============================================================
// دوال إدارة المنتجات من المؤسس (تم نقلها إلى admin-products.js)
// ============================================================
// يتم تعريفها في admin-products.js

// ============================================================
// دوال إدارة المناديب (تم نقلها إلى admin-couriers.js)
// ============================================================
// يتم تعريفها في admin-couriers.js

// ============================================================
// دوال إدارة العملاء والبائعين (تم نقلها إلى admin-users.js)
// ============================================================
// يتم تعريفها في admin-users.js

// ============================================================
// دوال إدارة العقارات (تم نقلها إلى admin-properties.js)
// ============================================================
// يتم تعريفها في admin-properties.js

// ============================================================
// دوال إدارة الخدمات (تم نقلها إلى admin-services.js)
// ============================================================
// يتم تعريفها في admin-services.js

// ============================================================
// دوال إدارة الطلبات (تم نقلها إلى admin-orders.js)
// ============================================================
// يتم تعريفها في admin-orders.js

// ============================================================
// دوال إدارة البلاغات (تم نقلها إلى admin-reports.js)
// ============================================================
// يتم تعريفها في admin-reports.js

// ============================================================
// دوال سجل النشاط (تم نقلها إلى admin-logs.js)
// ============================================================
// يتم تعريفها في admin-logs.js

// ============================================================
// دوال الإعدادات والإشعارات الجماعية (تم نقلها إلى admin-settings.js)
// ============================================================
// يتم تعريفها في admin-settings.js

// ============================================================
// دوال CRUD الأساسية للمؤسس (مضافة حديثاً)
// ============================================================

// ----- المناديب -----
async function getAllDeliveries() {
    const { data, error } = await supabaseClient
        .from('user_data')
        .select('*')
        .eq('account_type', 'delivery')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function updateDeliveryStatus(userId, status) {
    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ status, updated_at: new Date() })
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_delivery_status`, { user_id: userId, status });
    return data;
}

async function deleteDelivery(userId) {
    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ status: 'rejected', updated_at: new Date() })
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, 'delete_delivery', { user_id: userId });
    return data;
}

// ----- العملاء -----
async function getAllClients() {
    const { data, error } = await supabaseClient
        .from('user_data')
        .select('*')
        .eq('account_type', 'client')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function updateClientStatus(userId, status) {
    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ status, updated_at: new Date() })
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_client_status`, { user_id: userId, status });
    return data;
}

async function deleteClient(userId) {
    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ status: 'deleted', updated_at: new Date() })
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, 'delete_client', { user_id: userId });
    return data;
}

// ----- البائعين -----
async function getAllSellers() {
    const { data, error } = await supabaseClient
        .from('user_data')
        .select('*')
        .eq('account_type', 'seller')
        .order('created_at', { ascending: false });
    if (error) throw error;
    // إضافة إحصائيات إضافية (عدد المنتجات، الطلبات، التقييم)
    for (let seller of data) {
        const { count: productCount } = await supabaseClient
            .from('products')
            .select('id', { count: 'exact' })
            .eq('user_id', seller.id);
        seller.product_count = productCount || 0;

        const { count: orderCount } = await supabaseClient
            .from('orders')
            .select('id', { count: 'exact' })
            .eq('seller_id', seller.id);
        seller.order_count = orderCount || 0;

        const { data: products } = await supabaseClient
            .from('products')
            .select('avg_rating')
            .eq('user_id', seller.id);
        const ratings = products?.filter(p => p.avg_rating).map(p => p.avg_rating) || [];
        seller.avg_rating = ratings.length ? (ratings.reduce((a,b) => a+b, 0) / ratings.length) : 0;
    }
    return data || [];
}

async function updateSellerStatus(userId, status) {
    const { data, error } = await supabaseClient
        .from('user_data')
        .update({ status, updated_at: new Date() })
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_seller_status`, { user_id: userId, status });
    return data;
}

// ----- المنتجات (إدارة المؤسس) -----
async function getAllProductsAdmin() {
    const { data, error } = await supabaseClient
        .from('products')
        .select('*, user_data(name)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function updateProductStatusAdmin(productId, status) {
    const { data, error } = await supabaseClient
        .from('products')
        .update({ status, updated_at: new Date() })
        .eq('id', productId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_product_status`, { product_id: productId, status });
    return data;
}

async function deleteProductAdmin(productId) {
    // حذف نهائي أو وضع حالة محذوف
    const { data, error } = await supabaseClient
        .from('products')
        .update({ status: 'deleted', updated_at: new Date() })
        .eq('id', productId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, 'delete_product_admin', { product_id: productId });
    return data;
}

// ----- العقارات -----
async function getAllProperties() {
    const { data, error } = await supabaseClient
        .from('properties')
        .select('*, owner:owner_id(id, name, email)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function saveProperty(propertyData) {
    const { data, error } = await supabaseClient
        .from('properties')
        .upsert(propertyData)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, propertyData.id ? 'update_property' : 'add_property', { property_id: data.id });
    return data;
}

async function updatePropertyStatus(propertyId, status) {
    const { data, error } = await supabaseClient
        .from('properties')
        .update({ status, updated_at: new Date() })
        .eq('id', propertyId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_property_status`, { property_id: propertyId, status });
    return data;
}

async function deleteProperty(propertyId) {
    const { data, error } = await supabaseClient
        .from('properties')
        .update({ status: 'hidden', updated_at: new Date() })
        .eq('id', propertyId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, 'delete_property', { property_id: propertyId });
    return data;
}

// ----- الخدمات -----
async function getAllServices() {
    const { data, error } = await supabaseClient
        .from('services')
        .select('*')
        .order('created_at', { ascending: false });
    if (!error && data) return data;
    // fallback على الخدمات المحلية في appState
    return appState.services || [];
}

async function saveService(serviceData) {
    const { data, error } = await supabaseClient
        .from('services')
        .upsert(serviceData)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, serviceData.id ? 'update_service' : 'add_service', { service_id: data.id });
    return data;
}

async function deleteService(serviceId) {
    const { data, error } = await supabaseClient
        .from('services')
        .delete()
        .eq('id', serviceId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, 'delete_service', { service_id: serviceId });
    return data;
}

// ----- الطلبات (إدارة المؤسس) -----
async function getAllOrdersAdmin() {
    const { data, error } = await supabaseClient
        .from('orders')
        .select('*, buyer:buyer_id(id, name, email), seller:seller_id(id, name, email), delivery:delivery_id(id, name, email)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function updateOrderStatusAdmin(orderId, status) {
    const { data, error } = await supabaseClient
        .from('orders')
        .update({ status, updated_at: new Date() })
        .eq('id', orderId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_order_status_admin`, { order_id: orderId, status });
    return data;
}

// ----- البلاغات -----
async function getAllReports() {
    const { data, error } = await supabaseClient
        .from('reports')
        .select('*, reporter:reporter_id(id, name, email)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function updateReportStatus(reportId, status) {
    const { data, error } = await supabaseClient
        .from('reports')
        .update({ status, updated_at: new Date() })
        .eq('id', reportId)
        .select()
        .maybeSingle();
    if (error) throw error;
    await logActivity(appState.user.id, `update_report_status`, { report_id: reportId, status });
    return data;
}

// ----- سجل النشاط -----
async function logActivity(adminId, actionType, details = {}) {
    try {
        await supabaseClient.from('activity_logs').insert({
            admin_id: adminId,
            action_type: actionType,
            details,
            created_at: new Date()
        });
    } catch (err) { console.warn('Failed to log activity:', err); }
}

async function getAllActivityLogs() {
    const { data, error } = await supabaseClient
        .from('activity_logs')
        .select('*, admin:admin_id(id, name, email)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

// ----- الإشعارات الجماعية -----
async function sendBulkNotification(recipientType, title, message, specificEmail = null) {
    let userIds = [];
    if (recipientType === 'all') {
        const { data } = await supabaseClient.from('user_data').select('id');
        userIds = data?.map(u => u.id) || [];
    } else if (recipientType === 'clients') {
        const { data } = await supabaseClient.from('user_data').select('id').eq('account_type', 'client');
        userIds = data?.map(u => u.id) || [];
    } else if (recipientType === 'sellers') {
        const { data } = await supabaseClient.from('user_data').select('id').eq('account_type', 'seller');
        userIds = data?.map(u => u.id) || [];
    } else if (recipientType === 'deliveries') {
        const { data } = await supabaseClient.from('user_data').select('id').eq('account_type', 'delivery');
        userIds = data?.map(u => u.id) || [];
    } else if (recipientType === 'specific' && specificEmail) {
        const { data } = await supabaseClient.from('user_data').select('id').eq('email', specificEmail);
        if (data?.length) userIds = [data[0].id];
        else throw new Error('المستخدم غير موجود');
    }
    for (const userId of userIds) {
        await sendNotification(userId, title, message);
    }
    await logActivity(appState.user.id, 'send_bulk_notification', { recipientType, count: userIds.length });
    return userIds.length;
}

// ----- الإعدادات -----
async function getAppSettings() {
    const { data, error } = await supabaseClient
        .from('app_settings')
        .select('setting_key, setting_value');
    if (error) throw error;
    return data || [];
}

async function saveAppSettings(settings) {
    for (const item of settings) {
        await supabaseClient
            .from('app_settings')
            .upsert({ setting_key: item.setting_key, setting_value: item.setting_value, updated_at: new Date() });
    }
    await logActivity(appState.user.id, 'update_app_settings', { count: settings.length });
}

// ============================================================
// تصدير جميع الدوال العامة
// ============================================================
window.supabaseClient = supabaseClient;
window.appState = appState;
window.compressImage = compressImage;
window.uploadProductImages = uploadProductImages;
window.uploadReviewImages = uploadReviewImages;
window.uploadReviewVideo = uploadReviewVideo;
window.canReviewProduct = canReviewProduct;
window.hasUserReviewed = hasUserReviewed;
window.getUserReview = getUserReview;
window.upsertReview = upsertReview;
window.updateProductRatingStats = updateProductRatingStats;
window.loadProductReviews = loadProductReviews;
window.getReviewStats = getReviewStats;
window.markReviewHelpful = markReviewHelpful;
window.getHelpfulCount = getHelpfulCount;
window.showScreen = showScreen;
window.goBack = goBack;
window.skipLogin = skipLogin;
window.openLocationSettings = openLocationSettings;
window.setBearExpression = setBearExpression;
window.showBearReaction = showBearReaction;
window.showLoading = showLoading;
window.showToast = showToast;
window.escapeHTML = escapeHTML;
window.signInWithGoogle = signInWithGoogle;
window.applyPendingAccountType = applyPendingAccountType;
window.signInWithEmail = signInWithEmail;
window.signUpWithEmail = signUpWithEmail;
window.logout = logout;
window.switchAccount = switchAccount;
window.confirmLogout = confirmLogout;
window.saveProfile = saveProfile;
window.showChangePasswordModal = showChangePasswordModal;
window.showSecurityModal = showSecurityModal;
window.closeModal = closeModal;
window.changePassword = changePassword;
window.saveSecuritySettings = saveSecuritySettings;
window.openChatbot = openChatbot;
window.closeChatbot = closeChatbot;
window.sendMessage = sendMessage;
window.sendSuggestion = sendSuggestion;
window.openFounderProfile = openFounderProfile;
window.closeFounderProfile = closeFounderProfile;
window.contactDeveloper = contactDeveloper;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.shareFounderPage = shareFounderPage;
window.trackShare = trackShare;
window.loadShareCounts = loadShareCounts;
window.getFounderShareLink = getFounderShareLink;
window.refreshFounderStats = refreshFounderStats;
window.approveDeliveryPerson = approveDeliveryPerson;
window.rejectDeliveryPerson = rejectDeliveryPerson;
window.loadPendingDeliveries = loadPendingDeliveries;
window.loadUserData = loadUserData;
window.updateUserInfo = updateUserInfo;
window.updateWelcomeLocation = updateWelcomeLocation;
window.updateProfileLocation = updateProfileLocation;
window.saveLocation = saveLocation;
window.loadUnreadNotificationsCount = loadUnreadNotificationsCount;
window.setupRealtimeSubscriptions = setupRealtimeSubscriptions;
window.sendNotification = sendNotification;
window.requestNotificationPermission = requestNotificationPermission;
window.showSystemNotification = showSystemNotification;
window.setupSystemNotifications = setupSystemNotifications;
window.showNotificationSettingsModal = showNotificationSettingsModal;
window.toggleSystemNotifications = toggleSystemNotifications;
window.sendTestNotification = sendTestNotification;
window.loadGlobalFounderVisibility = loadGlobalFounderVisibility;
window.initFounderSettings = initFounderSettings;
window.handleToggleChange = handleToggleChange;
window.generateOTP = generateOTP;
window.loadFounderStats = loadFounderStats;
window.trackFounderView = trackFounderView;
window.loadVillagesForCenter = loadVillagesForCenter;

// ===== تصدير دوال المؤسس CRUD =====
window.getAllDeliveries = getAllDeliveries;
window.updateDeliveryStatus = updateDeliveryStatus;
window.deleteDelivery = deleteDelivery;
window.getAllClients = getAllClients;
window.updateClientStatus = updateClientStatus;
window.deleteClient = deleteClient;
window.getAllSellers = getAllSellers;
window.updateSellerStatus = updateSellerStatus;
window.getAllProductsAdmin = getAllProductsAdmin;
window.updateProductStatusAdmin = updateProductStatusAdmin;
window.deleteProductAdmin = deleteProductAdmin;
window.getAllProperties = getAllProperties;
window.saveProperty = saveProperty;
window.updatePropertyStatus = updatePropertyStatus;
window.deleteProperty = deleteProperty;
window.getAllServices = getAllServices;
window.saveService = saveService;
window.deleteService = deleteService;
window.getAllOrdersAdmin = getAllOrdersAdmin;
window.updateOrderStatusAdmin = updateOrderStatusAdmin;
window.getAllReports = getAllReports;
window.updateReportStatus = updateReportStatus;
window.logActivity = logActivity;
window.getAllActivityLogs = getAllActivityLogs;
window.sendBulkNotification = sendBulkNotification;
window.getAppSettings = getAppSettings;
window.saveAppSettings = saveAppSettings;