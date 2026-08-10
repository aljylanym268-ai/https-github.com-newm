// Fetch banners from Supabase and render hero slider
let heroIndex = 0;
let heroTimer = null;
const HERO_INTERVAL = 5000; // 5 seconds

async function loadHeroBanners() {
    try {
        const { data, error } = await supabaseClient
            .from('banners')
            .select('*')
            .eq('active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        const banners = data || [];
        renderHeroSlides(banners);
        startHeroAutoPlay();
    } catch (e) {
        console.error('Failed to load banners:', e);
        // hide slider on error to avoid empty white space
        const slider = document.getElementById('heroSlider');
        if (slider) slider.style.display = 'none';
        stopHeroAutoPlay();
    }
}

function renderHeroSlides(banners) {
    const slidesContainer = document.getElementById('heroSlides');
    const dotsContainer = document.getElementById('heroDots');
    slidesContainer.innerHTML = '';
    dotsContainer.innerHTML = '';
    if (!banners || banners.length === 0) {
        // hide slider if none
        document.getElementById('heroSlider').style.display = 'none';
        return;
    }
    document.getElementById('heroSlider').style.display = 'block';
    banners.forEach((b, i) => {
        const slide = document.createElement('div');
        slide.className = 'hero-slide';
        slide.setAttribute('role','group');
        slide.setAttribute('aria-roledescription','slide');
        slide.setAttribute('aria-label', `${i+1} / ${banners.length}`);
        const imageUrl = b.image_url || '';
        // Use a real <img> element so the banner image is clearly visible
        slide.innerHTML = '\n            <img class="hero-slide-img" src="' + escapeHTML(imageUrl) + '" alt="' + escapeHTML(b.title || 'إعلان') + '" loading="lazy" onerror="this.style.display=\'none\';">\n            <div class="overlay"></div>\n            <div class="content">\n                <h2>' + escapeHTML(b.title || '') + '</h2>\n                <p>' + escapeHTML(b.description || '') + '</p>\n            </div>\n            <button class="btn-view">عرض الإعلان</button>\n        ';

        // View button opens vertical detail modal; keep image click opening the link if needed
        slide.querySelector('.btn-view').addEventListener('click', (ev) => {
            ev.stopPropagation();
            openBannerDetail(b);
        });

        // keep image click for direct navigation if user prefers
        slide.addEventListener('click', (ev) => {
            // default click navigates to link
            if (b.link) {
                const link = b.link;
                const isExternal = /^(https?:)?\/\//i.test(link);
                if (isExternal) window.open(link, '_blank');
                else window.location.href = link;
            }
        });
        slidesContainer.appendChild(slide);

        const dot = document.createElement('button');
        dot.setAttribute('aria-label', `انتقال إلى الإعلان ${i+1}`);
        dot.addEventListener('click', () => { goToHeroIndex(i); });
        dotsContainer.appendChild(dot);
    });

    // set initial
    heroIndex = 0;
    updateHeroPosition();

    // attach controls
    document.getElementById('heroPrev').onclick = () => { prevHero(); };
    document.getElementById('heroNext').onclick = () => { nextHero(); };
    // pause on hover
    const slider = document.getElementById('heroSlider');
    slider.addEventListener('mouseenter', () => stopHeroAutoPlay());
    slider.addEventListener('mouseleave', () => startHeroAutoPlay());
}

function updateHeroPosition() {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('#heroDots button');
    if (slides.length === 0) return;
    const container = document.getElementById('heroSlides');
    // Check document direction: in RTL, flex items lay out right-to-left,
    // so we must translate in the opposite (positive X) direction.
    const isRTL = getComputedStyle(document.documentElement).direction === 'rtl';
    const offset = heroIndex * 100;
    container.style.transform = isRTL ? `translateX(${offset}%)` : `translateX(-${offset}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === heroIndex));
}

function prevHero() { heroIndex = (heroIndex - 1 + getHeroCount()) % getHeroCount(); updateHeroPosition(); resetHeroTimer(); }
function nextHero() { heroIndex = (heroIndex + 1) % getHeroCount(); updateHeroPosition(); resetHeroTimer(); }
function goToHeroIndex(i) { heroIndex = i % getHeroCount(); updateHeroPosition(); resetHeroTimer(); }
function getHeroCount() { return document.querySelectorAll('.hero-slide').length; }

function startHeroAutoPlay() {
    stopHeroAutoPlay();
    heroTimer = setInterval(() => { nextHero(); }, HERO_INTERVAL);
}
function stopHeroAutoPlay() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }
function resetHeroTimer() { stopHeroAutoPlay(); startHeroAutoPlay(); }

// Banner detail modal handlers
function openBannerDetail(banner) {
    const modal = document.getElementById('bannerDetailModal');
    if (!modal) return;
    const media = document.getElementById('bannerDetailMedia');
    const title = document.getElementById('bannerDetailTitle');
    const desc = document.getElementById('bannerDetailDesc');
    const visit = document.getElementById('bannerDetailVisit');

    media.style.backgroundImage = `url('${banner.image_url || ''}')`;
    title.textContent = banner.title || '';
    desc.textContent = banner.description || '';
    visit.onclick = (ev) => {
        ev.stopPropagation();
        if (banner.link) {
            const isExternal = /^(https?:)?\/\//i.test(banner.link);
            if (isExternal) window.open(banner.link, '_blank');
            else window.location.href = banner.link;
        }
    };

    modal.classList.add('active');
    modal.setAttribute('aria-hidden','false');
    // stop slider while modal open
    stopHeroAutoPlay();
}
function closeBannerDetail() {
    const modal = document.getElementById('bannerDetailModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden','true');
    // resume slider
    startHeroAutoPlay();
}
// attach modal close handlers
document.addEventListener('click', function(e){
    const modal = document.getElementById('bannerDetailModal');
    if (!modal) return;
    if (modal.classList.contains('active')){
        const card = modal.querySelector('.banner-detail-card');
        if (!card.contains(e.target)) {
            closeBannerDetail();
        }
    }
});
const modalCloseBtn = document.getElementById('bannerDetailClose');
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeBannerDetail);

// initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    // load banners (graceful if table doesn't exist yet)
    if (typeof supabaseClient !== 'undefined') {
        loadHeroBanners().catch(() => {});
    }
});

