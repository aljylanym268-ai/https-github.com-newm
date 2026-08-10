// ============================================================
// سجل النشاط (عرض، تصفية)
// ============================================================

let logsFilter = { query: '' };

async function loadLogsTable(page = 1, pageSize = 10) {
    const logs = await getAllActivityLogs();
    const filtered = logs.filter(l => {
        const q = logsFilter.query.toLowerCase();
        return !q || l.action_type.toLowerCase().includes(q) ||
               (l.admin?.name && l.admin.name.toLowerCase().includes(q));
    });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filtered.slice(start, end);
    renderLogsTable(pageData);
    renderPagination('logsPagination', total, page, pageSize, (p) => loadLogsTable(p, pageSize));
}

function renderLogsTable(data) {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">لا توجد سجلات</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(l => {
        const details = l.details ? JSON.stringify(l.details) : '';
        return `<tr>
            <td>${escapeHTML(l.admin?.name || 'غير معروف')}</td>
            <td>${escapeHTML(l.action_type)}</td>
            <td>${escapeHTML(details)}</td>
            <td>${new Date(l.created_at).toLocaleString('ar-EG')}</td>
        </tr>`;
    }).join('');
}

window.filterLogs = function() {
    const input = document.getElementById('logSearchInput');
    logsFilter.query = input ? input.value.trim() : '';
    loadLogsTable();
};