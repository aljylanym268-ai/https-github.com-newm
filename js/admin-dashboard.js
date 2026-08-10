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

        return {
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
    const items = [
        { icon: 'fas fa-users', label: 'إجمالي المستخدمين', value: stats.totalUsers || 0 },
        { icon: 'fas fa-user', label: 'العملاء', value: stats.clients || 0 },
        { icon: 'fas fa-store', label: 'البائعين', value: stats.sellers || 0 },
        { icon: 'fas fa-truck', label: 'المناديب', value: stats.deliveries || 0 },
        { icon: 'fas fa-check-circle', label: 'مندوب معتمد', value: stats.approvedDeliveries || 0 },
        { icon: 'fas fa-clock', label: 'مندوب قيد المراجعة', value: stats.pendingDeliveries || 0 },
        { icon: 'fas fa-ban', label: 'مندوب موقوف', value: stats.suspendedDeliveries || 0 },
        { icon: 'fas fa-shopping-cart', label: 'إجمالي الطلبات', value: stats.totalOrders || 0 },
        { icon: 'fas fa-plus-circle', label: 'طلبات جديدة', value: stats.newOrders || 0 },
        { icon: 'fas fa-truck', label: 'قيد التوصيل', value: stats.inDeliveryOrders || 0 },
        { icon: 'fas fa-check-double', label: 'مكتملة', value: stats.completedOrders || 0 },
        { icon: 'fas fa-store-alt', label: 'إجمالي المتاجر', value: stats.totalStores || 0 },
        { icon: 'fas fa-boxes', label: 'إجمالي المنتجات', value: stats.totalProducts || 0 },
        { icon: 'fas fa-building', label: 'إجمالي العقارات', value: stats.totalProperties || 0 },
        { icon: 'fas fa-concierge-bell', label: 'إجمالي الخدمات', value: stats.totalServices || 0 },
    ];
    container.innerHTML = items.map(item => `
        <div class="stat-card-founder">
            <div class="stat-icon"><i class="${item.icon}"></i></div>
            <div class="stat-number">${item.value}</div>
            <div class="stat-label">${item.label}</div>
        </div>
    `).join('');
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

window.switchFounderTab = function(tabId) {
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
    }
};

// تصدير الدوال
window.getFounderStats = getFounderStats;
window.renderStatsGrid = renderStatsGrid;
window.refreshFounderDashboard = refreshFounderDashboard;