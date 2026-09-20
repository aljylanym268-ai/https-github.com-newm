// ============================================================
// دالة ترقيم الصفحات (مشتركة)
// ============================================================
function renderPagination(containerId, total, currentPage, pageSize, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="${i === currentPage ? 'active' : ''}" onclick="(function(){ ${onPageChange.toString()}( ${i} ); })()">${i}</button>`;
    }
    container.innerHTML = html;
}
window.renderPagination = renderPagination;