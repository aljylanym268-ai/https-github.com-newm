// ========== ملف product.js الكامل (مع إضافة نظام التقييمات) ==========

// ========== فتح تفاصيل المنتج (معرض صورة واحد مع سحب + تقييمات) ==========
async function openProductDetail(product) {
    if (!product) return;
    appState.currentProduct = product;

    // جلب التقييمات والإحصائيات
    const reviews = await loadProductReviews(product.id);
    const stats = await getReviewStats(product.id);
    const avgRating = stats.average;
    const totalReviews = stats.total;

    // بناء نجوم التقييم
    const fullStars = Math.floor(avgRating);
    const hasHalfStar = avgRating % 1 >= 0.5;
    let ratingStars = '★'.repeat(fullStars);
    if (hasHalfStar) ratingStars += '★';
    ratingStars += '☆'.repeat(5 - Math.ceil(avgRating));
    while (ratingStars.length < 5) ratingStars += '☆';

    // تجهيز الصور (إزالة التكرار والروابط الفارغة)
    let images = sanitizeImages(product.images, product.image_url);
    const mainImage = images.length ? images[0] : '';

    // حالة المخزون
    const inStock = (product.stock !== undefined && product.stock > 0);
    const stockText = inStock ? '✅ متوفر' : '❌ غير متوفر';
    const stockColor = inStock ? '#4caf50' : '#e53935';

    // الكمية الافتراضية
    window._detailQuantity = 1;
    currentImageIndex = 0;

    const container = document.getElementById('productDetailContent');
    if (!container) return;

    // التحقق مما إذا كان المستخدم يمكنه التقييم
    let canReview = false;
    let userReview = null;
    if (appState.user) {
        canReview = await canReviewProduct(product.id, appState.user.id);
        userReview = await getUserReview(product.id, appState.user.id);
    }

    // بناء HTML مع معرض صور بسيط + قسم التقييمات
    let galleryHtml = '';
    if (images.length > 0) {
        galleryHtml = `
            <div class="product-detail-image-section">
                <div class="product-main-image-container" id="mainImageContainer">
                    <img src="${mainImage}" id="detailMainImage" alt="${escapeHTML(product.name)}"
                         onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\"no-image\">📦</div>';">
                    <button class="zoom-btn" onclick="toggleZoom()"><i class="fas fa-search-plus"></i></button>
                    ${images.length > 1 ? `<div class="image-counter-overlay">${currentImageIndex + 1} / ${images.length}</div>` : ''}
                </div>
            </div>
        `;
    } else {
        galleryHtml = `<div class="product-detail-image-section"><div class="product-main-image-container"><div class="no-image">📦</div></div></div>`;
    }

    // قسم التقييمات
    const reviewsHtml = await renderReviewsSection(product.id, reviews, stats);

    // زر إضافة تقييم (إذا كان المستخدم يستطيع)
    let reviewActionHtml = '';
    if (appState.user) {
        if (canReview && !userReview) {
            reviewActionHtml = `<button class="add-review-btn" onclick="showAddReviewForm('${product.id}')"><i class="fas fa-star"></i> إضافة تقييم</button>`;
        } else if (userReview) {
            reviewActionHtml = `<button class="edit-review-btn" onclick="showAddReviewForm('${product.id}')"><i class="fas fa-edit"></i> تعديل تقييمك</button>`;
        } else {
            reviewActionHtml = `<p style="color:#888; font-size:0.9rem;">⚠️ يمكنك تقييم هذا المنتج بعد استلام طلبك.</p>`;
        }
    } else {
        reviewActionHtml = `<p style="color:#888; font-size:0.9rem;">🔒 سجل دخولك لتقييم هذا المنتج.</p>`;
    }

    container.innerHTML = `
        <div class="product-detail-wrapper" id="productDetailWrapper">

            <!-- القسم العلوي -->
            <div class="product-detail-top-section">
                <h1 class="product-detail-name">${escapeHTML(product.name)}</h1>
                <div class="product-detail-meta">
                    <div class="product-rating-row">
                        <span class="stars">${ratingStars}</span>
                        <span class="rating-value">${avgRating.toFixed(1)}</span>
                        <span class="rating-count">(${totalReviews} تقييم)</span>
                    </div>
                    ${product.seller_name ? `<span class="seller-badge verified">✓ ${escapeHTML(product.seller_name)}</span>` : ''}
                </div>
                <div class="product-detail-description">
                    <p>${escapeHTML(product.description || 'لا يوجد وصف متاح لهذا المنتج.')}</p>
                </div>
            </div>

            <!-- معرض الصور (في المنتصف) -->
            ${galleryHtml}

            <!-- القسم السفلي -->
            <div class="product-detail-bottom-section">
                <div class="product-detail-price">
                    <span class="price-main" id="detailPrice">${(product.price * 1).toLocaleString()} ج.م</span>
                    ${product.discount ? `
                        <span class="price-original">${(product.price / (1 - product.discount/100)).toFixed(0)} ج.م</span>
                        <span class="discount-badge">خصم ${product.discount}%</span>
                    ` : ''}
                </div>
                <div class="product-stock" style="color:${stockColor}; font-weight:700; font-size:0.95rem;">
                    ${stockText}
                </div>
                <div class="product-quantity-section">
                    <label>الكمية:</label>
                    <div class="quantity-selector">
                        <button class="qty-btn" onclick="changeQuantity(-1)">−</button>
                        <span id="detailQuantity">1</span>
                        <button class="qty-btn" onclick="changeQuantity(1)">+</button>
                    </div>
                </div>
                <div class="product-total-section" style="text-align:center; margin:8px 0 12px;">
                    <span id="totalPriceDisplay" style="font-weight:900; color:#1a237e; font-size:1.4rem;">
                        الإجمالي: ${product.price.toLocaleString()} ج.م
                    </span>
                </div>
                <div class="product-detail-actions desktop-actions">
                    <button class="buy-now-btn" onclick="openDirectCheckout()">
                        <i class="fas fa-bolt"></i> شراء الآن
                    </button>
                    <button class="add-to-cart-btn" onclick="addToCartFromDetail()">
                        <i class="fas fa-cart-plus"></i> إضافة إلى السلة
                    </button>
                    <button class="share-btn-icon" onclick="shareProduct()" title="مشاركة المنتج">
                        <i class="fas fa-share-alt"></i>
                    </button>
                </div>
                <div class="product-specifications">
                    <h3>مواصفات المنتج</h3>
                    <div class="spec-grid">
                        <div class="spec-item"><span class="spec-label">التصنيف</span><span class="spec-value">${product.category || 'عام'}</span></div>
                        <div class="spec-item"><span class="spec-label">المخزون</span><span class="spec-value">${product.stock || 'غير محدد'}</span></div>
                        <div class="spec-item"><span class="spec-label">الحالة</span><span class="spec-value">جديد</span></div>
                        ${product.brand ? `<div class="spec-item"><span class="spec-label">الماركة</span><span class="spec-value">${escapeHTML(product.brand)}</span></div>` : ''}
                    </div>
                </div>
            </div>
        </div>

        <!-- منتجات مشابهة -->
        <div id="similarProductsSectionDetail" class="similar-products-section"></div>

        <!-- قسم التقييمات (آخر حاجة في الصفحة) -->
        <div class="product-reviews-section" style="max-width:900px; margin:0 auto; padding:0 16px 30px;">
            <div class="reviews-header">
                <h3>تقييمات العملاء</h3>
                ${reviewActionHtml}
            </div>
            ${reviewsHtml}
        </div>
    `;

    // تحديث عداد الصورة
    updateImageCounter();

    // إعداد خاصية السحب على الصورة
    setupSwipe();

    // تحميل المنتجات المشابهة
    loadSimilarProductsInDetail(product.category, product.id);
    showScreen('productDetailScreen');
    setTimeout(() => addStickyActions(), 100);
}

// ========== عرض قسم التقييمات ==========
async function renderReviewsSection(productId, reviews, stats) {
    if (!reviews || reviews.length === 0) {
        return `<div class="no-reviews">لا توجد تقييمات لهذا المنتج بعد. كن أول من يقيّم!</div>`;
    }

    // توزيع النجوم
    const distribution = stats.distribution || { 1:0, 2:0, 3:0, 4:0, 5:0 };
    const total = stats.total || reviews.length;
    let distHtml = '';
    for (let i = 5; i >= 1; i--) {
        const count = distribution[i] || 0;
        const percent = total > 0 ? (count / total * 100) : 0;
        distHtml += `
            <div class="rating-dist-row">
                <span class="dist-stars">${'★'.repeat(i)}</span>
                <div class="dist-bar"><div class="dist-fill" style="width:${percent}%;"></div></div>
                <span class="dist-count">${count}</span>
            </div>
        `;
    }

    // قائمة التقييمات
    let listHtml = '';
    for (const review of reviews) {
        const user = review.users || {};
        const userImage = user.image_url ? `<img src="${user.image_url}" alt="${escapeHTML(user.name)}">` : `<i class="fas fa-user"></i>`;
        const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        const date = new Date(review.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
        const imagesHtml = review.images && review.images.length > 0
            ? `<div class="review-images">${review.images.map(img => `<img src="${img}" loading="lazy" onclick="openImageModalFromReview('${img}')">`).join('')}</div>`
            : '';
        const videoHtml = review.video
            ? `<div class="review-video"><video controls src="${review.video}"></video></div>`
            : '';
        const verifiedBadge = review.is_verified_purchase
            ? `<span class="verified-badge"><i class="fas fa-check-circle"></i> شراء موثق</span>`
            : '';

        listHtml += `
            <div class="review-item" data-review-id="${review.id}">
                <div class="review-avatar">${userImage}</div>
                <div class="review-content">
                    <div class="review-name">${escapeHTML(user.name || 'مستخدم')} ${verifiedBadge}</div>
                    <div class="review-stars">${stars}</div>
                    ${review.title ? `<div class="review-title">${escapeHTML(review.title)}</div>` : ''}
                    <p class="review-text">${escapeHTML(review.comment)}</p>
                    ${imagesHtml}
                    ${videoHtml}
                    <div class="review-footer">
                        <span class="review-date">${date}</span>
                        <button class="helpful-btn" onclick="markHelpful('${review.id}')">
                            <i class="fas fa-thumbs-up"></i> مفيد (${review.helpful_count || 0})
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="reviews-stats">
            <div class="rating-summary">
                <div class="rating-average">${stats.average.toFixed(1)}</div>
                <div class="rating-stars">${'★'.repeat(Math.floor(stats.average))}${'☆'.repeat(5 - Math.floor(stats.average))}</div>
                <div class="rating-count">${total} تقييم</div>
            </div>
            <div class="rating-distribution">${distHtml}</div>
        </div>
        <div class="reviews-list">${listHtml}</div>
    `;
}

// ========== عرض نموذج إضافة تقييم ==========
function showAddReviewForm(productId) {
    if (!appState.user) {
        showToast('يجب تسجيل الدخول أولاً', 'warning');
        return;
    }
    // التحقق من وجود تقييم سابق لتعديله
    getUserReview(productId, appState.user.id).then(review => {
        const modal = document.getElementById('addReviewModal');
        if (!modal) {
            showToast('النموذج غير متوفر', 'error');
            return;
        }
        // تعبئة الحقول إذا كان هناك تقييم سابق
        if (review) {
            document.getElementById('reviewRating').value = review.rating;
            document.getElementById('reviewTitle').value = review.title || '';
            document.getElementById('reviewComment').value = review.comment || '';
            document.getElementById('reviewProductId').value = productId;
            document.getElementById('reviewId').value = review.id;
            // تحديث النجوم
            document.querySelectorAll('.star').forEach(s => {
                const val = parseInt(s.dataset.value);
                s.textContent = val <= review.rating ? '★' : '☆';
                s.style.color = val <= review.rating ? '#D4AF37' : '#ccc';
            });
        } else {
            document.getElementById('reviewRating').value = 5;
            document.getElementById('reviewTitle').value = '';
            document.getElementById('reviewComment').value = '';
            document.getElementById('reviewProductId').value = productId;
            document.getElementById('reviewId').value = '';
            // تعيين النجوم إلى 5 افتراضياً
            document.querySelectorAll('.star').forEach(s => {
                const val = parseInt(s.dataset.value);
                s.textContent = val <= 5 ? '★' : '☆';
                s.style.color = val <= 5 ? '#D4AF37' : '#ccc';
            });
        }
        // تنظيف معاينة الملفات
        document.getElementById('reviewImagesPreview').innerHTML = '';
        document.getElementById('reviewVideoPreview').innerHTML = '';
        document.getElementById('reviewImages').value = '';
        document.getElementById('reviewVideo').value = '';
        modal.classList.add('active');
    });
}

// ========== إرسال التقييم ==========
async function submitReview() {
    const productId = document.getElementById('reviewProductId').value;
    const reviewId = document.getElementById('reviewId').value;
    const rating = parseInt(document.getElementById('reviewRating').value);
    const title = document.getElementById('reviewTitle').value.trim();
    const comment = document.getElementById('reviewComment').value.trim();
    const imagesInput = document.getElementById('reviewImages');
    const videoInput = document.getElementById('reviewVideo');

    if (!rating || rating < 1 || rating > 5) {
        showToast('يرجى اختيار تقييم من 1 إلى 5 نجوم', 'warning');
        return;
    }
    if (!comment) {
        showToast('يرجى كتابة تعليق', 'warning');
        return;
    }

    showLoading(true);
    try {
        // رفع الملفات إن وجدت
        let imageUrls = [];
        let videoUrl = null;

        // الحصول على معرف التقييم (إذا كان جديداً، سننشئه ثم نرفع الملفات)
        let tempReviewId = reviewId;
        if (!tempReviewId) {
            // إنشاء سجل مؤقت للحصول على ID
            const { data, error } = await supabaseClient
                .from('reviews')
                .insert({
                    product_id: productId,
                    user_id: appState.user.id,
                    rating: rating,
                    title: title,
                    comment: comment,
                    is_verified_purchase: false,
                    created_at: new Date(),
                    updated_at: new Date()
                })
                .select('id')
                .single();
            if (error) throw error;
            tempReviewId = data.id;
        }

        // رفع الصور
        if (imagesInput.files.length > 0) {
            if (imagesInput.files.length > 5) {
                throw new Error('يمكن رفع 5 صور كحد أقصى');
            }
            imageUrls = await uploadReviewImages(Array.from(imagesInput.files), tempReviewId);
        }

        // رفع الفيديو
        if (videoInput.files.length > 0) {
            const videoFile = videoInput.files[0];
            if (videoFile.size > 50 * 1024 * 1024) throw new Error('الفيديو كبير جداً (الحد 50 ميجابايت)');
            videoUrl = await uploadReviewVideo(videoFile, tempReviewId);
        }

        // التحقق من الشراء (is_verified_purchase)
        const canReview = await canReviewProduct(productId, appState.user.id);

        // حفظ أو تحديث التقييم
        const reviewData = {
            product_id: productId,
            user_id: appState.user.id,
            order_id: null,
            rating: rating,
            title: title,
            comment: comment,
            images: imageUrls,
            video: videoUrl,
            is_verified_purchase: canReview
        };

        // إذا كان هناك reviewId موجود، نقوم بالتحديث
        if (reviewId) {
            const { error } = await supabaseClient
                .from('reviews')
                .update({
                    rating,
                    title,
                    comment,
                    images: imageUrls.length > 0 ? imageUrls : undefined,
                    video: videoUrl || undefined,
                    updated_at: new Date()
                })
                .eq('id', reviewId);
            if (error) throw error;
        } else {
            // إدراج كامل (لأننا أنشأنا سجلاً مؤقتاً، لكننا سنستبدله بالكامل)
            // نمسح المؤقت ونضيف الجديد
            if (tempReviewId) {
                await supabaseClient.from('reviews').delete().eq('id', tempReviewId);
            }
            const { data, error } = await supabaseClient
                .from('reviews')
                .insert({
                    product_id: productId,
                    user_id: appState.user.id,
                    rating: rating,
                    title: title,
                    comment: comment,
                    images: imageUrls,
                    video: videoUrl,
                    is_verified_purchase: canReview,
                    created_at: new Date(),
                    updated_at: new Date()
                })
                .select()
                .single();
            if (error) throw error;
        }

        // تحديث إحصائيات المنتج
        await updateProductRatingStats(productId);

        // إغلاق المودال
        closeReviewModal();

        // إعادة تحميل تفاصيل المنتج لتحديث التقييمات
        const product = appState.products.find(p => p.id === productId);
        if (product) {
            await openProductDetail(product);
        }

        showToast('تم إرسال التقييم بنجاح!', 'success');
    } catch (err) {
        showToast(err.message, 'error');
        console.error(err);
    } finally {
        showLoading(false);
    }
}

// ========== إغلاق مودال التقييم ==========
function closeReviewModal() {
    document.getElementById('addReviewModal').classList.remove('active');
}

// ========== معاينة الصور قبل الرفع ==========
function previewReviewImages(event) {
    const files = event.target.files;
    const container = document.getElementById('reviewImagesPreview');
    container.innerHTML = '';
    for (let i = 0; i < files.length && i < 5; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'preview-thumb';
            container.appendChild(img);
        };
        reader.readAsDataURL(file);
    }
}

function previewReviewVideo(event) {
    const file = event.target.files[0];
    const container = document.getElementById('reviewVideoPreview');
    container.innerHTML = '';
    if (file) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.controls = true;
        video.className = 'preview-video';
        container.appendChild(video);
    }
}

// ========== تسجيل إعجاب "مفيد" ==========
async function markHelpful(reviewId) {
    if (!appState.user) {
        showToast('يجب تسجيل الدخول أولاً', 'warning');
        return;
    }
    try {
        await markReviewHelpful(reviewId, appState.user.id);
        showToast('شكراً لك! تم تسجيل تقييمك كمفيد.', 'success');
        // تحديث عدد الإعجابات في الواجهة مع الحفاظ على أيقونة الإبهام
        const btn = document.querySelector(`.review-item[data-review-id="${reviewId}"] .helpful-btn`);
        if (btn) {
            const current = parseInt(btn.textContent.match(/\d+/)?.[0] || 0);
            btn.innerHTML = `<i class="fas fa-thumbs-up"></i> مفيد (${current + 1})`;
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ========== فتح الصورة في مودال ==========
function openImageModalFromReview(imageSrc) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    if (modal && modalImg) {
        modalImg.src = imageSrc;
        modal.classList.add('active');
    }
}

// ========== إعداد السحب (Swipe) على الصورة ==========
function setupSwipe() {
    const container = document.getElementById('mainImageContainer');
    if (!container) return;
    
    let startX = 0;
    let isDragging = false;
    let currentTranslateX = 0;
    let isSwiping = false;
    const threshold = 30;

    // إزالة المستمعات القديمة لتجنب التكرار
    container.removeEventListener('touchstart', handleTouchStart);
    container.removeEventListener('touchmove', handleTouchMove);
    container.removeEventListener('touchend', handleTouchEnd);
    container.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // دوال اللمس
    function handleTouchStart(e) {
        const touch = e.touches[0];
        startX = touch.clientX;
        isDragging = true;
        isSwiping = false;
        currentTranslateX = 0;
        container.style.transition = 'none';
    }

    function handleTouchMove(e) {
        if (!isDragging) return;
        const touch = e.touches[0];
        const diff = touch.clientX - startX;
        currentTranslateX = diff;
        const img = container.querySelector('img');
        if (img) {
            img.style.transform = `translateX(${diff}px)`;
        }
        if (Math.abs(diff) > 10) {
            isSwiping = true;
            e.preventDefault();
        }
    }

    function handleTouchEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        container.style.transition = 'transform 0.3s ease';
        const img = container.querySelector('img');
        if (img) {
            img.style.transform = 'translateX(0)';
        }
        if (isSwiping) {
            const diff = currentTranslateX;
            if (Math.abs(diff) > threshold) {
                if (diff < 0) {
                    slideGallery(1);
                } else {
                    slideGallery(-1);
                }
            }
        }
        isSwiping = false;
        currentTranslateX = 0;
    }

    // دوال الفأرة (للسطح المكتب)
    function handleMouseDown(e) {
        startX = e.clientX;
        isDragging = true;
        isSwiping = false;
        currentTranslateX = 0;
        container.style.transition = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        e.preventDefault();
    }

    function handleMouseMove(e) {
        if (!isDragging) return;
        const diff = e.clientX - startX;
        currentTranslateX = diff;
        const img = container.querySelector('img');
        if (img) {
            img.style.transform = `translateX(${diff}px)`;
        }
        if (Math.abs(diff) > 10) {
            isSwiping = true;
        }
    }

    function handleMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;
        container.style.transition = 'transform 0.3s ease';
        const img = container.querySelector('img');
        if (img) {
            img.style.transform = 'translateX(0)';
        }
        if (isSwiping) {
            const diff = currentTranslateX;
            if (Math.abs(diff) > threshold) {
                if (diff < 0) {
                    slideGallery(1);
                } else {
                    slideGallery(-1);
                }
            }
        }
        isSwiping = false;
        currentTranslateX = 0;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }

    // إضافة المستمعات
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('mousedown', handleMouseDown);
}

// ========== تحديث عداد الصورة الحالية ==========
function updateImageCounter() {
    const images = getProductImages();
    const counter = document.querySelector('.image-counter-overlay');
    if (counter && images.length > 0) {
        counter.textContent = `${currentImageIndex + 1} / ${images.length}`;
    }
}

// ========== دالة مساعدة لتنقية صور المنتج (إزالة التكرارات والروابط الفارغة) ==========
function sanitizeImages(imagesArray, singleImage) {
    let result = [];
    if (imagesArray && Array.isArray(imagesArray) && imagesArray.length) {
        result = imagesArray.filter(url => url && typeof url === 'string' && url.trim() !== '');
    }
    if (singleImage && typeof singleImage === 'string' && singleImage.trim() !== '') {
        if (!result.includes(singleImage)) {
            result.unshift(singleImage);
        }
    }
    return [...new Set(result)];
}

// ========== دوال مساعدة للكمية ==========
function changeQuantity(delta) {
    const qtySpan = document.getElementById('detailQuantity');
    const priceSpan = document.getElementById('detailPrice');
    const totalSpan = document.getElementById('totalPriceDisplay');
    if (!qtySpan || !priceSpan || !appState.currentProduct) return;
    let qty = parseInt(qtySpan.textContent) + delta;
    if (qty < 1) qty = 1;
    if (appState.currentProduct.stock && qty > appState.currentProduct.stock) {
        showToast('الكمية المطلوبة تتجاوز المخزون المتاح', 'warning');
        return;
    }
    qtySpan.textContent = qty;
    window._detailQuantity = qty;
    const price = appState.currentProduct.price;
    priceSpan.textContent = (price * qty).toLocaleString() + ' ج.م';
    totalSpan.textContent = `الإجمالي: ${(price * qty).toLocaleString()} ج.م`;
}

// ========== تغيير الصورة الرئيسية ==========
let currentImageIndex = 0;

function changeMainImageByIndex(index) {
    const images = getProductImages();
    if (!images || index < 0 || index >= images.length) return;
    currentImageIndex = index;
    const mainImg = document.getElementById('detailMainImage');
    if (mainImg) {
        const src = images[index];
        if (src && src.trim() !== '') {
            mainImg.src = src;
            mainImg.onerror = function() {
                this.onerror = null;
                this.parentElement.innerHTML = '<div class="no-image">📦</div>';
            };
        } else {
            mainImg.parentElement.innerHTML = '<div class="no-image">📦</div>';
        }
    }
    updateImageCounter();
}

function getProductImages() {
    const product = appState.currentProduct;
    if (!product) return [];
    return sanitizeImages(product.images, product.image_url);
}

function slideGallery(direction) {
    const images = getProductImages();
    if (!images.length) return;
    let newIndex = currentImageIndex + direction;
    if (newIndex < 0) newIndex = images.length - 1;
    if (newIndex >= images.length) newIndex = 0;
    changeMainImageByIndex(newIndex);
}

// ========== تكبير الصورة ==========
let zoomActive = false;
function toggleZoom() {
    const container = document.getElementById('mainImageContainer');
    if (!container) return;
    zoomActive = !zoomActive;
    container.classList.toggle('zoomed', zoomActive);
}

// ========== مشاركة المنتج ==========
function shareProduct() {
    if (!appState.currentProduct) return;
    const url = `${window.location.origin}${window.location.pathname}?id=${appState.currentProduct.id}`;
    const text = `اطلع على منتج ${appState.currentProduct.name} على Misar Systems`;
    if (navigator.share) {
        navigator.share({ title: appState.currentProduct.name, text, url }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url).then(() => {
            showToast('تم نسخ رابط المنتج', 'success');
        }).catch(() => {
            showToast('فشل النسخ، حاول يدوياً', 'error');
        });
    }
}

// ========== جلب المراجعات من قاعدة البيانات ==========
// تم نقل هذه الدالة إلى supabase.js، لكن نتركها هنا للتوافق
async function loadProductReviews(productId) {
    try {
        const { data, error } = await supabaseClient
            .from('reviews')
            .select('*')
            .eq('product_id', productId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data || [];
    } catch (e) {
        console.warn('فشل جلب المراجعات:', e);
        return [];
    }
}

// ========== تبديل إظهار المراجعات ==========
function toggleReviews() {
    const section = document.getElementById('productReviewsSection');
    const icon = document.getElementById('reviewsToggleIcon');
    if (!section) return;
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ========== إضافة الأزرار المثبتة ==========
function addStickyActions() {
    const existing = document.querySelector('.sticky-actions-mobile');
    if (existing) existing.remove();

    const desktopActions = document.querySelector('.product-detail-actions.desktop-actions');
    if (!desktopActions) return;

    const stickyDiv = document.createElement('div');
    stickyDiv.className = 'sticky-actions-mobile';

    // زر شراء الآن
    const buyBtn = desktopActions.querySelector('.buy-now-btn');
    if (buyBtn) {
        const cloneBuy = buyBtn.cloneNode(true);
        cloneBuy.onclick = openDirectCheckout;
        stickyDiv.appendChild(cloneBuy);
    }

    // زر إضافة إلى السلة
    const addBtn = desktopActions.querySelector('.add-to-cart-btn');
    if (addBtn) {
        const cloneAdd = addBtn.cloneNode(true);
        cloneAdd.onclick = addToCartFromDetail;
        stickyDiv.appendChild(cloneAdd);
    }

    // زر مشاركة المنتج
    const shareBtn = desktopActions.querySelector('.share-btn-icon');
    if (shareBtn) {
        const cloneShare = shareBtn.cloneNode(true);
        cloneShare.onclick = shareProduct;
        stickyDiv.appendChild(cloneShare);
    }

    const wrapper = document.querySelector('.product-detail-wrapper');
    if (wrapper) wrapper.appendChild(stickyDiv);
}

// ========== دوال الشراء المباشر ==========
function openDirectCheckout() {
    if (!appState.user) {
        showToast('يجب تسجيل الدخول أولاً', 'warning');
        return;
    }
    if (!appState.currentProduct) {
        showToast('حدث خطأ، الرجاء المحاولة مرة أخرى', 'error');
        return;
    }

    // تعبئة الحقول تلقائياً من بيانات المستخدم
    const userData = appState.userData || {};
    document.getElementById('directName').value = userData.name || '';
    document.getElementById('directPhone').value = userData.phone || '';
    document.getElementById('directAddress').value = userData.address || '';
    document.getElementById('directGovernorate').value = userData.governorate || 'قنا';
    document.getElementById('directCity').value = userData.center || '';
    document.getElementById('directNotes').value = '';

    // عرض المودال
    document.getElementById('directCheckoutModal').classList.add('active');
}

async function confirmDirectOrder() {
    const name = document.getElementById('directName').value.trim();
    const phone = document.getElementById('directPhone').value.trim();
    const address = document.getElementById('directAddress').value.trim();
    const governorate = document.getElementById('directGovernorate').value;
    const city = document.getElementById('directCity').value.trim();
    const notes = document.getElementById('directNotes').value.trim();

    if (!name || !phone || !address || !city) {
        showToast('يرجى ملء جميع الحقول المطلوبة', 'warning');
        return;
    }

    showLoading(true);
    try {
        const product = appState.currentProduct;
        const quantity = window._detailQuantity || 1;
        const totalPrice = product.price * quantity;
        const deliveryFee = 20;

        await createOrder(
            product.id,
            quantity,
            totalPrice + deliveryFee,
            product.user_id,
            name,
            phone,
            address,
            city,
            deliveryFee
        );

        document.getElementById('directCheckoutModal').classList.remove('active');

        showToast('تم تقديم الطلب بنجاح!', 'success');
        showScreen('ordersScreen');
        if (typeof loadBuyerOrdersWithTimeline === 'function') {
            loadBuyerOrdersWithTimeline();
        }
    } catch (err) {
        showToast(err.message, 'error');
        console.error(err);
    } finally {
        showLoading(false);
    }
}

function closeDirectCheckout() {
    document.getElementById('directCheckoutModal').classList.remove('active');
}

// ========== إضافة إلى السلة من التفاصيل ==========
function addToCartFromDetail() {
    if (!appState.currentProduct) return;
    const qty = window._detailQuantity || 1;
    addToCartWithQuantity(appState.currentProduct.id, qty);
}

function buyNowFromDetail() {
    openDirectCheckout();
}

async function addToCartWithQuantity(productId, quantity) {
    if (!appState.user) {
        showToast('يجب تسجيل الدخول أولاً', 'warning');
        return;
    }
    showLoading(true);
    try {
        const { data: existing } = await supabaseClient
            .from('cart_items')
            .select('id, quantity')
            .eq('user_id', appState.user.id)
            .eq('product_id', productId)
            .maybeSingle();
        if (existing) {
            await supabaseClient
                .from('cart_items')
                .update({ quantity: existing.quantity + quantity })
                .eq('id', existing.id);
        } else {
            await supabaseClient
                .from('cart_items')
                .insert({
                    user_id: appState.user.id,
                    product_id: productId,
                    quantity: quantity,
                    created_at: new Date()
                });
        }
        const product = appState.products.find(p => p.id === productId);
        showToast(`تم إضافة ${product?.name || 'المنتج'} إلى السلة (${quantity})`, 'success');
        await updateCartBadgeFromDB();
        await loadCart();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ========== تحميل منتجات مشابهة ==========
function loadSimilarProductsInDetail(category, currentProductId, limit = 6) {
    const container = document.getElementById('similarProductsSectionDetail');
    if (!container) return;
    let similar = appState.products.filter(p => p.category === category && p.id !== currentProductId);
    similar = similar.slice(0, limit);
    const hasMore = appState.products.filter(p => p.category === category && p.id !== currentProductId).length > limit;
    let html = '';
    if (similar.length === 0) {
        html = `<div class="similar-products-header"><h3>منتجات مشابهة</h3><p style="color:#999;">لا توجد منتجات مشابهة</p></div>`;
    } else {
        html = `
            <div class="similar-products-header">
                <h3>منتجات مشابهة</h3>
                ${hasMore ? `<button class="explore-more-btn" onclick="exploreMore('${category}')"><i class="fas fa-compass"></i> استكشاف المزيد</button>` : ''}
            </div>
            <div class="similar-products-grid">
                ${similar.map(p => {
                    const imgUrl = p.images && p.images.length ? p.images[0] : (p.image_url || '');
                    const imgHtml = imgUrl ? `<img src="${imgUrl}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div>📦</div>';">` : '<div>📦</div>';
                    return `
                        <div class="similar-product-card" onclick="openProductDetail(appState.products.find(pr => pr.id === '${p.id}'))">
                            <div class="similar-product-image">${imgHtml}</div>
                            <div class="similar-product-info">
                                <div class="similar-product-name">${escapeHTML(p.name)}</div>
                                <div class="similar-product-price">${p.price} ج.م</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
    container.innerHTML = html;
}

function exploreMore(category) {
    showScreen('marketScreen');
    const searchInput = document.getElementById('marketSearchInput');
    if (searchInput) {
        searchInput.value = category;
        filterMarketProducts(category);
    }
    showToast(`عرض منتجات من فئة: ${category}`, 'info');
}

// ========== تصدير الدوال العامة ==========
window.openProductDetail = openProductDetail;
window.changeQuantity = changeQuantity;
window.changeMainImageByIndex = changeMainImageByIndex;
window.slideGallery = slideGallery;
window.toggleZoom = toggleZoom;
window.shareProduct = shareProduct;
window.loadProductReviews = loadProductReviews;
window.toggleReviews = toggleReviews;
window.addStickyActions = addStickyActions;
window.addToCartFromDetail = addToCartFromDetail;
window.buyNowFromDetail = buyNowFromDetail;
window.addToCartWithQuantity = addToCartWithQuantity;
window.loadSimilarProductsInDetail = loadSimilarProductsInDetail;
window.exploreMore = exploreMore;
window.openDirectCheckout = openDirectCheckout;
window.confirmDirectOrder = confirmDirectOrder;
window.closeDirectCheckout = closeDirectCheckout;
window.sanitizeImages = sanitizeImages;
window.updateImageCounter = updateImageCounter;
window.getProductImages = getProductImages;
window.setupSwipe = setupSwipe;
window.showAddReviewForm = showAddReviewForm;
window.submitReview = submitReview;
window.closeReviewModal = closeReviewModal;
window.previewReviewImages = previewReviewImages;
window.previewReviewVideo = previewReviewVideo;
window.markHelpful = markHelpful;
window.openImageModalFromReview = openImageModalFromReview;
window.renderReviewsSection = renderReviewsSection;