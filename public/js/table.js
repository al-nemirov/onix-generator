/**
 * ONIX Generator — Table utilities
 * Additional table features: column resize, virtual scroll (future).
 * Core table rendering is in app.js.
 */

// Column resize functionality
document.addEventListener('DOMContentLoaded', () => {
    // Add resize handles to headers
    document.querySelectorAll('.spreadsheet th').forEach(th => {
        if (th.classList.contains('col-checkbox') || th.classList.contains('col-num')) return;
        const handle = document.createElement('div');
        handle.className = 'resize-handle';
        th.appendChild(handle);

        let startX, startWidth;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startWidth = th.offsetWidth;

            const onMove = (e) => {
                const diff = e.clientX - startX;
                th.style.width = `${Math.max(40, startWidth + diff)}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
});
