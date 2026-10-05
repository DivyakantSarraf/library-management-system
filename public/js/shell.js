document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    const backdrop = document.querySelector('.sidebar-backdrop');
    
    // Desktop collapse state from localStorage
    const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (isCollapsed && window.innerWidth >= 1024) {
        document.body.classList.add('sidebar-collapsed');
    }

    // Toggle Sidebar
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            if (window.innerWidth >= 1024) {
                // Desktop collapse
                document.body.classList.toggle('sidebar-collapsed');
                localStorage.setItem('sidebar-collapsed', document.body.classList.contains('sidebar-collapsed'));
            } else {
                // Mobile overlay
                if (sidebar) sidebar.classList.toggle('open');
                if (backdrop) backdrop.classList.toggle('visible');
                
                if (sidebar && sidebar.classList.contains('open')) {
                    sidebar.focus();
                }
            }
        });
    }

    // Close mobile sidebar on backdrop click
    if (backdrop) {
        backdrop.addEventListener('click', () => {
            if (sidebar) sidebar.classList.remove('open');
            backdrop.classList.remove('visible');
        });
    }

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            if (backdrop) backdrop.classList.remove('visible');
            if (sidebarToggle) sidebarToggle.focus();
        }
    });
});
