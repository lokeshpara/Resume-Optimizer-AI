// =====================================================
// ENHANCED DASHBOARD JAVASCRIPT
// =====================================================

let allApplications = [];
let filteredApplications = [];
let dailyChartInstance = null;
let statusChartInstance = null;

// =====================================================
// INITIALIZATION
// =====================================================

async function init() {
    await loadSummary();
    await loadDailyChart();
    await loadStatusChart();
    await loadRecentActivity();
    await loadApplications();
}

// =====================================================
// LOAD SUMMARY (KPIs)
// =====================================================

async function loadSummary() {
    try {
        // Show loading state
        totalApps.innerHTML = '<div class="skeleton" style="width: 60px; height: 36px;"></div>';
        companies.innerHTML = '<div class="skeleton" style="width: 60px; height: 36px;"></div>';
        interviewRate.innerHTML = '<div class="skeleton" style="width: 60px; height: 36px;"></div>';
        avgResponse.innerHTML = '<div class="skeleton" style="width: 60px; height: 36px;"></div>';
        offers.innerHTML = '<div class="skeleton" style="width: 60px; height: 36px;"></div>';
        thisWeek.innerHTML = '<div class="skeleton" style="width: 60px; height: 36px;"></div>';

        const res = await fetch('/api/dashboard/summary');
        const data = await res.json();

        // Animate in the real data
        setTimeout(() => {
            totalApps.textContent = data.totalApplications || 0;
            companies.textContent = data.uniqueCompanies || 0;
            interviewRate.textContent = data.interviewRate ? `${data.interviewRate}%` : '0%';
            avgResponse.textContent = data.avgResponseTime ? `${data.avgResponseTime}d` : 'N/A';
            offers.textContent = data.offersReceived || 0;
            thisWeek.textContent = data.thisWeekCount || 0;
        }, 100);
    } catch (error) {
        console.error('Failed to load summary:', error);
        // Show error state
        totalApps.textContent = '—';
        companies.textContent = '—';
        interviewRate.textContent = '—';
        avgResponse.textContent = '—';
        offers.textContent = '—';
        thisWeek.textContent = '—';
    }
}

// =====================================================
// LOAD DAILY CHART
// =====================================================

async function loadDailyChart() {
    try {
        const res = await fetch('/api/dashboard/daily');
        const rawData = await res.json();

        if (!rawData || rawData.length === 0) {
            document.getElementById('dailyChart').parentElement.innerHTML =
                '<p style="text-align: center; color: #666; padding: 40px;">No data available yet</p>';
            return;
        }

        const labels = rawData.map(d =>
            new Date(d.date_applied).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        );
        const values = rawData.map(d => Number(d.count));

        const canvas = document.getElementById('dailyChart');
        const ctx = canvas.getContext('2d');

        if (dailyChartInstance) dailyChartInstance.destroy();

        dailyChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: values,
                    borderColor: '#2c2c2c',
                    backgroundColor: 'rgba(44, 44, 44, 0.1)',
                    borderWidth: 3,
                    tension: 0,
                    fill: true,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    pointBackgroundColor: '#2c2c2c',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        backgroundColor: '#2c2c2c',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            title: (ctx) => `Date: ${labels[ctx[0].dataIndex]}`,
                            label: (ctx) => `Applications: ${ctx.raw}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#666',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: '#e0e0e0' },
                        ticks: {
                            color: '#666',
                            precision: 0
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Failed to load daily chart:', error);
    }
}

// =====================================================
// LOAD STATUS CHART (PIE/DONUT)
// =====================================================

async function loadStatusChart() {
    try {
        const res = await fetch('/api/dashboard/status-dist');
        const data = await res.json();

        if (!data || data.length === 0) {
            document.getElementById('statusChart').parentElement.innerHTML =
                '<p style="text-align: center; color: #666; padding: 40px;">No data available yet</p>';
            return;
        }

        const labels = data.map(d => d.status);
        const values = data.map(d => Number(d.count));
        const percentages = data.map(d => Number(d.percentage));

        const statusColors = {
            'Applied': '#1976d2',
            'Interview': '#7b1fa2',
            'Offer': '#388e3c',
            'Rejected': '#d32f2f'
        };

        const backgroundColors = labels.map(status => statusColors[status] || '#666');

        const canvas = document.getElementById('statusChart');
        const ctx = canvas.getContext('2d');

        if (statusChartInstance) statusChartInstance.destroy();

        statusChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: backgroundColors,
                    borderColor: '#2c2c2c',
                    borderWidth: 3,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#2c2c2c',
                            padding: 15,
                            font: {
                                size: 13,
                                family: "'Courier New', monospace",
                                weight: 'bold'
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#2c2c2c',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 12,
                        callbacks: {
                            label: (ctx) => {
                                const label = ctx.label || '';
                                const value = ctx.raw || 0;
                                const percentage = percentages[ctx.dataIndex] || 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Failed to load status chart:', error);
    }
}

// =====================================================
// LOAD RECENT ACTIVITY
// =====================================================

async function loadRecentActivity() {
    try {
        const res = await fetch('/api/dashboard/recent');
        const activities = await res.json();

        const feed = document.getElementById('recentActivity');

        if (!activities || activities.length === 0) {
            feed.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No recent activity</p>';
            return;
        }

        feed.innerHTML = activities.map(act => `
            <div class="activity-item" onclick="window.location.href='/application/${act.id}'">
                <div class="activity-header">
                    <span class="activity-company">${escapeHtml(act.company_name)}</span>
                    <span class="activity-time">${timeAgo(act.updated_at)}</span>
                </div>
                <div class="activity-position">${escapeHtml(act.position_applied)}</div>
                <div class="activity-status">Status: ${act.status}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load recent activity:', error);
    }
}

// =====================================================
// LOAD APPLICATIONS
// =====================================================

async function loadApplications() {
    try {
        const res = await fetch('/api/applications');
        allApplications = await res.json();
        filteredApplications = [...allApplications];

        renderTable();
        updateTableCount();
    } catch (error) {
        console.error('Failed to load applications:', error);
    }
}

// =====================================================
// RENDER TABLE
// =====================================================

function renderTable() {
    const tbody = document.getElementById('applicationsTable');
    const noResults = document.getElementById('noResults');

    if (!filteredApplications || filteredApplications.length === 0) {
        tbody.innerHTML = '';
        noResults.classList.remove('hidden');
        return;
    }

    noResults.classList.add('hidden');

    tbody.innerHTML = filteredApplications.map(app => {
        // Calculate if application was actually updated after being created
        const dateApplied = new Date(app.date_applied);
        const dateUpdated = new Date(app.updated_at);
        const wasActuallyUpdated = dateUpdated.getTime() - dateApplied.getTime() > 60000; // More than 1 min difference

        // Show different display based on whether it was actually updated
        const updatedDisplay = wasActuallyUpdated
            ? timeAgo(app.updated_at)
            : '<span style="color: #999;">—</span>';

        return `
            <tr onclick="window.location.href='/application/${app.id}'">
                <td>${escapeHtml(app.company_name)}</td>
                <td>${escapeHtml(app.position_applied)}</td>
                <td>${formatDate(app.date_applied)}</td>
                <td><span class="status ${app.status.toLowerCase()}">${app.status}</span></td>
                <td>${updatedDisplay}</td>
                <td onclick="event.stopPropagation()">
                    <div class="action-buttons">
                        <button class="action-btn" onclick="quickEdit(${app.id})">✏️ EDIT</button>
                        <button class="action-btn delete" onclick="showDeleteConfirmation(${app.id}, '${escapeHtml(app.company_name)}')">🗑️ DELETE</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// =====================================================
// SEARCH
// =====================================================

let searchTimeout;

function handleSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        applyFilters();
    }, 300); // Debounce 300ms
}

// =====================================================
// APPLY FILTERS
// =====================================================

function applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const statusFilter = document.getElementById('statusFilter').value;
    const dateFilter = document.getElementById('dateFilter').value;

    filteredApplications = allApplications.filter(app => {
        // Search filter
        const matchesSearch = !searchTerm ||
            app.company_name.toLowerCase().includes(searchTerm) ||
            app.position_applied.toLowerCase().includes(searchTerm);

        // Status filter
        const matchesStatus = !statusFilter || app.status === statusFilter;

        // Date filter
        let matchesDate = true;
        if (dateFilter !== 'all') {
            const days = parseInt(dateFilter);
            const appDate = new Date(app.date_applied);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            matchesDate = appDate >= cutoffDate;
        }

        return matchesSearch && matchesStatus && matchesDate;
    });

    renderTable();
    updateTableCount();
}

// =====================================================
// SORTING
// =====================================================

function applySorting() {
    const sortBy = document.getElementById('sortBy').value;

    filteredApplications.sort((a, b) => {
        switch (sortBy) {
            case 'date_desc':
                return new Date(b.date_applied) - new Date(a.date_applied);
            case 'date_asc':
                return new Date(a.date_applied) - new Date(b.date_applied);
            case 'updated_desc':
                return new Date(b.updated_at) - new Date(a.updated_at);
            case 'company_asc':
                return a.company_name.localeCompare(b.company_name);
            case 'company_desc':
                return b.company_name.localeCompare(a.company_name);
            default:
                return 0;
        }
    });

    renderTable();
}

// =====================================================
// CLEAR FILTERS
// =====================================================

function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('dateFilter').value = 'all';

    filteredApplications = [...allApplications];
    renderTable();
    updateTableCount();
}

// =====================================================
// UPDATE TABLE COUNT
// =====================================================

function updateTableCount() {
    document.getElementById('tableCount').textContent = filteredApplications.length;
}

// =====================================================
// QUICK ACTIONS
// =====================================================

async function quickEdit(id) {
    window.location.href = `/application/${id}`;
}

// =====================================================
// EXPORT TO CSV
// =====================================================

function exportData() {
    const csv = generateCSV(filteredApplications);
    downloadCSV(csv, `applications_${new Date().toISOString().split('T')[0]}.csv`);
}

function generateCSV(data) {
    if (!data || data.length === 0) {
        return 'No data to export';
    }

    const headers = ['Company', 'Position', 'Date Applied', 'Status', 'Resume Link', 'JD Link'];
    const rows = data.map(app => [
        app.company_name,
        app.position_applied,
        formatDate(app.date_applied),
        app.status,
        app.resume_link || '',
        app.jd_link || ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function timeAgo(dateStr) {
    if (!dateStr) return 'Never';

    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    // Less than 1 minute
    if (diffMins < 1) return 'Just now';

    // Less than 1 hour
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;

    // Less than 24 hours
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

    // Less than 7 days
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

    // Less than 30 days
    if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;

    // Less than 12 months
    if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;

    // More than a year - show actual date
    return formatDate(dateStr);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =====================================================
// START
// =====================================================

init();