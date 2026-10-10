// ============================================================
// لوحة تحكم المؤسس - الإحصائيات والتبويبات
// ============================================================

// ====== الإحصائيات ======
async function getFounderStats() {
    try {
        const { data: users } = await supabaseClient.from('user_data').select('account_type, status');
        const totalUsers = users?.length || 0;
        const clients = users?.filter(u => u.account_type === 'client').length || 0;
        const sellers = users?.filter(u => u.account_type === 'seller').length || 0;
        const deliveries = users?.filter(u => u.account_type === 'delivery').length || 0;
        const approvedDeliveries = users?.filter(u => u.account_type === 'delivery' && u.status === 'approved').length || 0;
        const pendingDeliveries = users?.filter(u => u.account_type === 'delivery' && u.status === 'pending').length || 0;
        const suspendedDeliveries = users?.filter(u => u.account_type === 'delivery' && u.status === 'suspended').length || 0;

        const { data: orders } = await supabaseClient.from('orders').select('status');
        const totalOrders = orders?.length || 0;
        const newOrders = orders?.filter(o => o.status === 'pending').length || 0;
        const inDeliveryOrders = orders?.filter(o => o.status === 'in_delivery').length || 0;
        const completedOrders = orders?.filter(o => o.status === 'delivered').length || 0;

        const { data: products } = await supabaseClient.from('products').select('id');
        const totalProducts = products?.length || 0;

        const { data: properties } = await supabaseClient.from('properties').select('id');
        const totalProperties = properties?.length || 0;

        const totalServices = appState.services?.length || 0;
        const totalStores = sellers;

        // عدد المتصلين الآن (من Presence إن كان متاحاً)
        let onlineNow = 0;
        try {
            if (window.presenceChannel) onlineNow = Object.values(window.presenceChannel.presenceState()).flat().length;
        } catch(e) {}

        return {
            onlineNow,
            totalUsers,
            clients,
            sellers,
            deliveries,
            approvedDeliveries,
            pendingDeliveries,
            suspendedDeliveries,
            totalOrders,
            newOrders,
            inDeliveryOrders,
            completedOrders,
            totalProducts,
            totalProperties,
            totalServices,
            totalStores
        };
    } catch (err) {
        console.error('Error getting founder stats:', err);
        return {};
    }
}

function renderStatsGrid(stats) {
    const container = document.getElementById('founderStatsGrid');
    if (!container) return;
    // tab: التبويب الذي يُفتح عند الضغط على البطاقة (null = بلا تنقل)
    // filter: فلتر اختياري يُطبَّق على الجدول بعد التنقل
    const items = [
        { icon: 'fas fa-signal', label: 'متصل الآن', value: stats.onlineNow || 0, tab: 'online' },
        { icon: 'fas fa-users', label: 'إجمالي المستخدمين', value: stats.totalUsers || 0, tab: 'customers' },
        { icon: 'fas fa-user', label: 'العملاء', value: stats.clients || 0, tab: 'customers' },
        { icon: 'fas fa-store', label: 'البائعين', value: stats.sellers || 0, tab: 'sellers' },
        { icon: 'fas fa-truck', label: 'المناديب', value: stats.deliveries || 0, tab: 'deliveries' },
        { icon: 'fas fa-check-circle', label: 'مندوب معتمد', value: stats.approvedDeliveries || 0, tab: 'deliveries', filter: 'approved' },
        { icon: 'fas fa-clock', label: 'مندوب قيد المراجعة', value: stats.pendingDeliveries || 0, tab: 'deliveries', filter: 'pending' },
        { icon: 'fas fa-ban', label: 'مندوب موقوف', value: stats.suspendedDeliveries || 0, tab: 'deliveries', filter: 'suspended' },
        { icon: 'fas fa-shopping-cart', label: 'إجمالي الطلبات', value: stats.totalOrders || 0, tab: 'orders' },
        { icon: 'fas fa-plus-circle', label: 'طلبات جديدة', value: stats.newOrders || 0, tab: 'orders', filter: 'pending' },
        { icon: 'fas fa-truck', label: 'قيد التوصيل', value: stats.inDeliveryOrders || 0, tab: 'orders', filter: 'in_delivery' },
        { icon: 'fas fa-check-double', label: 'مكتملة', value: stats.completedOrders || 0, tab: 'orders', filter: 'delivered' },
        { icon: 'fas fa-store-alt', label: 'إجمالي المتاجر', value: stats.totalStores || 0, tab: 'sellers' },
        { icon: 'fas fa-boxes', label: 'إجمالي المنتجات', value: stats.totalProducts || 0, tab: 'products' },
        { icon: 'fas fa-building', label: 'إجمالي العقارات', value: stats.totalProperties || 0, tab: 'properties' },
        { icon: 'fas fa-concierge-bell', label: 'إجمالي الخدمات', value: stats.totalServices || 0, tab: 'services' },
    ];
    container.innerHTML = items.map(item => {
        const clickable = !!item.tab;
        const dataTab = item.tab ? ` data-stat-tab="${item.tab}"` : '';
        const dataFilter = item.filter ? ` data-stat-filter="${item.filter}"` : '';
        return `
        <div class="stat-card-founder${clickable ? ' stat-card-clickable' : ''}"${dataTab}${dataFilter}
             ${clickable ? 'title="اضغط للانتقال إلى القسم"' : ''}>
            <div class="stat-icon"><i class="${item.icon}"></i></div>
            <div class="stat-number">${item.value}</div>
            <div class="stat-label">${item.label}</div>
        </div>
    `;
    }).join('');

    // ربط النقر بتنقّل واحد (بلا onclick مضمّن لتجنّب أي XSS/تفويض غير مقصود)
    container.querySelectorAll('.stat-card-clickable').forEach(card => {
        card.addEventListener('click', () => {
            const tab = card.dataset.statTab;
            const filter = card.dataset.statFilter || null;
            if (tab && typeof window.onFounderStatCardClick === 'function') {
                window.onFounderStatCardClick(tab, filter);
            }
        });
    });
}

async function refreshFounderDashboard() {
    if (!appState.user || appState.userData.account_type !== 'founder') return;
    showLoading(true);
    try {
        const stats = await getFounderStats();
        renderStatsGrid(stats);
        const activeTab = document.querySelector('.founder-tab.active');
        if (activeTab) {
            const tabId = activeTab.dataset.tab;
            switch (tabId) {
                case 'deliveries': loadDeliveriesTable(); break;
                case 'customers': loadCustomersTable(); break;
                case 'sellers': loadSellersTable(); break;
                case 'products': loadProductsTableAdmin(); break;
                case 'properties': loadPropertiesTable(); break;
                case 'services': loadServicesTableAdmin(); break;
                case 'orders': loadOrdersTableAdmin(); break;
                case 'reports': loadReportsTable(); break;
                case 'logs': loadLogsTable(); break;
                case 'banners': if (typeof refreshBannersAdmin === 'function') await refreshBannersAdmin(); break;
                case 'settings': loadSettingsForm(); break;
            }
        }
        await loadFounderStats();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        showLoading(false);
    }
}

window.switchFounderTab = function (tabId) {
    document.querySelectorAll('.founder-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelector(`.founder-tab[data-tab="${tabId}"]`).classList.add('active');
    document.querySelectorAll('.founder-tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    switch (tabId) {
        case 'dashboard': refreshFounderDashboard(); break;
        case 'deliveries': loadDeliveriesTable(); break;
        case 'customers': loadCustomersTable(); break;
        case 'sellers': loadSellersTable(); break;
        case 'products': loadProductsTableAdmin(); break;
        case 'properties': loadPropertiesTable(); break;
        case 'services': loadServicesTableAdmin(); break;
        case 'orders': loadOrdersTableAdmin(); break;
        case 'reports': loadReportsTable(); break;
        case 'logs': loadLogsTable(); break;
        case 'banners': if (typeof refreshBannersAdmin === 'function') refreshBannersAdmin(); break;
        case 'settings': loadSettingsForm(); break;
        case 'locations': if (typeof initFounderLocationsAdmin === 'function') initFounderLocationsAdmin(); break;
        case 'returns': if (typeof displayFounderReturns === 'function') displayFounderReturns(); break;
        case 'online': if (typeof initFounderOnlineTab === 'function') initFounderOnlineTab(); break;
        case 'general-manager': if (typeof misarRenderGmAdminPanel === 'function') misarRenderGmAdminPanel(); break;
    }
};

// ============================================================
// النقر على بطاقة إحصائية → الانتقال للتبويب المناسب + الفلتر
// ============================================================
window.onFounderStatCardClick = function (tab, filter) {
    if (!tab) return;
    if (typeof window.switchFounderTab !== 'function') return;

    window.switchFounderTab(tab);

    // تطبيق الفلتر بعد تحميل بيانات التبويب
    if (!filter) return;
    setTimeout(() => {
        try {
            if (tab === 'deliveries' && typeof window.filterDeliveriesByStatus === 'function') {
                window.filterDeliveriesByStatus(filter);
            } else if (tab === 'orders' && typeof window.filterOrdersAdminByStatus === 'function') {
                window.filterOrdersAdminByStatus(filter);
            } else if (tab === 'sellers' && typeof window.filterSellersByStatus === 'function') {
                window.filterSellersByStatus(filter);
            }
        } catch (e) {
            console.warn('تعذر تطبيق فلتر بطاقة الإحصائيات:', e);
        }
    }, 450);
};

// تصدير الدوال
window.getFounderStats = getFounderStats;
window.renderStatsGrid = renderStatsGrid;
window.refreshFounderDashboard = refreshFounderDashboard;