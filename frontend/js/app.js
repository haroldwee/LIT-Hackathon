const API_BASE = 'http://localhost:5000/api';
let queuedFiles = [];
let allContracts = [];
let calendar = null;

document.addEventListener('DOMContentLoaded', () => {
    refreshData();
    setupDropZone();
});

function setupDropZone() {
    const dz = document.getElementById('dropZone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function handleFiles(fileList) {
    const rejected = [];
    Array.from(fileList).forEach(f => {
        const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
        if (!['.pdf', '.docx', '.txt'].includes(ext)) {
            rejected.push(f);
            return;
        }
        const dup = queuedFiles.some(q => q.name === f.name && q.size === f.size);
        if (!dup) queuedFiles.push(f);
    });
    renderUploadQueue();
    if (rejected.length > 0) {
        const queue = document.getElementById('uploadQueue');
        rejected.forEach(f => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            div.setAttribute('data-name', f.name);
            div.innerHTML = `<span class="file-name" title="${escapeHtml(f.name)}"><i class="fas fa-file"></i> ${escapeHtml(f.name)} (${formatFileSize(f.size)})</span><span class="file-status status-error">Unsupported type - need .pdf, .docx or .txt</span>`;
            queue.appendChild(div);
        });
    }
}

function setQueueStatus(name, status, msg) {
    document.querySelectorAll('.queue-item').forEach(item => {
        if (item.getAttribute('data-name') === name) {
            const span = item.querySelector('.file-status');
            if (span) {
                span.className = `file-status status-${status}`;
                span.textContent = msg;
                span.title = msg;
            }
        }
    });
}

function renderUploadQueue() {
    const queue = document.getElementById('uploadQueue');
    const btn = document.getElementById('uploadBtn');
    if (btn && !uploadInProgress) btn.disabled = queuedFiles.length === 0;
    queue.innerHTML = queuedFiles.map(f => `
        <div class="queue-item" data-name="${escapeHtml(f.name)}">
            <span class="file-name" title="${escapeHtml(f.name)}"><i class="fas fa-file"></i> ${escapeHtml(f.name)} (${formatFileSize(f.size)})</span>
            <span class="file-status status-processing">Queued</span>
        </div>
    `).join('');
}

let uploadInProgress = false;

async function uploadFiles() {
    if (queuedFiles.length === 0 || uploadInProgress) return;
    uploadInProgress = true;
    const files = [...queuedFiles];
    queuedFiles = [];
    const progress = document.getElementById('uploadProgress');
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    const uploadBtn = document.getElementById('uploadBtn');
    progress.style.display = 'block';
    fill.style.width = '0%';
    uploadBtn.disabled = true;

    const CHUNK = 5;
    let done = 0, failed = 0;
    for (let i = 0; i < files.length; i += CHUNK) {
        const chunk = files.slice(i, i + CHUNK);
        const upto = Math.min(i + CHUNK, files.length);
        text.textContent = `Processing ${upto} of ${files.length}… AI extraction runs on each document, this can take a few minutes.`;
        fill.style.width = `${Math.round((upto / files.length) * 100)}%`;
        const fd = new FormData();
        chunk.forEach(f => fd.append('files', f));
        try {
            const res = await fetch(`${API_BASE}/upload_multiple`, { method: 'POST', body: fd });
            const data = await res.json();
            (data.results || []).forEach(r => { setQueueStatus(r.filename, 'done', 'Processed'); done++; });
            (data.errors || []).forEach(e => { setQueueStatus(e.file, 'error', e.error || 'Failed'); failed++; });
        } catch (err) {
            console.error('Chunk upload failed:', err);
            chunk.forEach(f => { setQueueStatus(f.name, 'error', 'Network/server error'); failed++; });
        }
    }

    text.textContent = `Complete: ${done} processed${failed > 0 ? `, ${failed} failed (see file statuses)` : ''}`;
    uploadInProgress = false;
    if (queuedFiles.length > 0) uploadBtn.disabled = false;
    refreshData();
    setTimeout(() => {
        progress.style.display = 'none';
        fill.style.width = '0%';
        text.textContent = 'Processing…';
        document.getElementById('uploadQueue').innerHTML = '';
    }, 8000);
}

async function refreshData() {
    try {
        const [contractsRes, statsRes, calendarRes] = await Promise.all([
            fetch(`${API_BASE}/contracts`).then(r => r.json()),
            fetch(`${API_BASE}/stats`).then(r => r.json()),
            fetch(`${API_BASE}/calendar`).then(r => r.json())
        ]);
        allContracts = contractsRes.contracts || [];
        const steps = [
            ['stats', () => updateStats(statsRes)],
            ['calendar', () => initCalendar(calendarRes.events || [])],
            ['partyFilter', () => populatePartyFilter()],
            ['matrixSelect', () => populateMatrixSelect()],
            ['contractsGrid', () => renderContracts(allContracts)],
            ['deliverables', () => renderDeliverables(allContracts)],
            ['dashboard', () => renderDashboard(allContracts)],
        ];
        steps.forEach(([name, fn]) => {
            try { fn(); } catch (e) { console.error(`refreshData/${name} failed:`, e); }
        });
    } catch (err) { console.error('Refresh error:', err); }
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function populatePartyFilter() {
    const sel = document.getElementById('partyFilter');
    const current = sel.value;
    const parties = new Set();
    allContracts.forEach(c => (c.parties || []).forEach(p => { if (p) parties.add(p); }));
    const sorted = [...parties].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = '<option value="">All Parties</option>' +
        sorted.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (sorted.some(p => p === current)) sel.value = current;
}

function updateStats(stats) {
    document.getElementById('statTotal').textContent = stats.total || 0;
    document.getElementById('statParties').textContent = stats.with_parties || 0;
    document.getElementById('statUpcoming').textContent = stats.upcoming_deadlines || 0;
    const urgent = allContracts.filter(c => {
        if (!c.end_date) return false;
        const end = new Date(c.end_date);
        const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30);
        return end <= thirtyDays && end >= new Date();
    }).length;
    document.getElementById('statUrgent').textContent = urgent;
    document.getElementById('totalBadge').textContent = `${stats.total || 0} Contracts`;
}

function renderDashboard(contracts) {
    const typeChart = document.getElementById('typeChart');
    const types = {};
    contracts.forEach(c => { const t = c.contract_type || 'Agreement'; types[t] = (types[t] || 0) + 1; });
    const total = contracts.length || 1;
    if (Object.keys(types).length === 0) { typeChart.innerHTML = '<p class="placeholder">No contracts uploaded yet</p>'; return; }
    const colors = { 'NDAs': '#3b82f6', 'Supplier Contract': '#10b981', 'Customer Terms': '#f59e0b', 'Lease': '#8b5cf6', 'Distribution Agreement': '#ec4899', 'Agreement': '#64748b' };
    typeChart.innerHTML = Object.entries(types).map(([type, count]) => `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:8px;background:var(--bg);border-radius:8px">
            <div style="width:12px;height:12px;border-radius:3px;background:${colors[type]||'#64748b'}"></div>
            <span style="flex:1;font-size:0.9rem">${type}</span>
            <span style="font-weight:700">${count}</span>
            <div style="width:120px;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
                <div style="width:${(count/total)*100}%;height:100%;background:${colors[type]||'#64748b'};border-radius:4px;transition:width 0.5s"></div>
            </div>
            <span style="font-size:0.8rem;color:var(--text-light)">${Math.round((count/total)*100)}%</span>
        </div>
    `).join('');

    const recent = document.getElementById('recentActivity');
    const sorted = [...contracts].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)).slice(0, 5);
    if (sorted.length === 0) { recent.innerHTML = '<p class="placeholder">No recent activity</p>'; return; }
    recent.innerHTML = sorted.map(c => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:36px;height:36px;border-radius:8px;background:rgba(79,70,229,0.1);display:flex;align-items:center;justify-content:center;color:var(--primary)"><i class="fas fa-file-contract"></i></div>
            <div style="flex:1"><div style="font-weight:600;font-size:0.9rem">${c.contract_name}</div><div style="font-size:0.8rem;color:var(--text-light)">${c.contract_type} • ${c.uploaded_at ? new Date(c.uploaded_at).toLocaleDateString() : ''}</div></div>
            <span class="contract-type-badge type-${c.contract_type}">${c.contract_type}</span>
        </div>
    `).join('');
}

function renderContracts(contracts) {
    const grid = document.getElementById('contractsGrid');
    if (contracts.length === 0) { grid.innerHTML = '<div class="placeholder"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:12px"></i>No contracts found</div>'; return; }
    grid.innerHTML = contracts.map(c => `
        <div class="contract-card" onclick="viewContract('${c.id}')">
            <div class="contract-card-header">
                <h4 title="${c.contract_name}">${c.contract_name}</h4>
                <span class="contract-type-badge type-${c.contract_type}">${c.contract_type}</span>
            </div>
            <div class="contract-details">
                <div><i class="fas fa-users"></i> ${c.parties ? c.parties.join(', ') : 'N/A'}</div>
                <div><i class="fas fa-calendar"></i> ${c.start_date ? new Date(c.start_date).toLocaleDateString() : 'N/A'} - ${c.end_date ? new Date(c.end_date).toLocaleDateString() : 'N/A'}</div>
                <div><i class="fas fa-tasks"></i> ${c.deliverables ? c.deliverables.length : 0} deliverables</div>
            </div>
            ${issueChipsHtml(c)}
        </div>
    `).join('');
}

function renderDeliverables(contracts) {
    const container = document.getElementById('deliverablesList');
    const allDL = [];
    contracts.forEach(c => {
        const dds = (c.deliverable_details && c.deliverable_details.length > 0)
            ? c.deliverable_details
            : (c.deliverables || []).map(dl => ({ date: dl, description: 'Deliverable deadline' }));
        dds.forEach(d => allDL.push({ date: d.date, desc: d.description, cit: d, contract: c.contract_name, type: c.contract_type, parties: c.parties, id: c.id, cref: c, label: 'Deliverable' }));
        if (c.end_date) allDL.push({ date: c.end_date, contract: c.contract_name, type: c.contract_type, parties: c.parties, id: c.id, label: 'End Date', cref: c });
        if (c.start_date) allDL.push({ date: c.start_date, contract: c.contract_name, type: c.contract_type, parties: c.parties, id: c.id, label: 'Start Date', cref: c });
    });

    allDL.sort((a, b) => new Date(a.date) - new Date(b.date));
    if (allDL.length === 0) { container.innerHTML = '<p class="placeholder">No deliverables found</p>'; return; }
    container.innerHTML = allDL.map(d => `
        <div class="deliverable-item">
            <div class="deliverable-date"><i class="fas fa-clock"></i> ${new Date(d.date).toLocaleDateString()}</div>
            <div class="deliverable-info">
                <strong>${d.label}: ${d.desc || d.contract}</strong>
                <small>${d.type} • ${d.parties ? d.parties.join(', ') : ''} ${citeHtml(d.cref, d.cit)}</small>
            </div>
            <span class="contract-type-badge type-${d.type}">${d.type}</span>
        </div>
    `).join('');
}

function initCalendar(events) {
    const el = document.getElementById('calendar');
    if (calendar) calendar.destroy();
    calendar = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        headerToolbar: { left: 'prev,today,next', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
        events: events.map(e => ({
            ...e,
            backgroundColor: e.color || '#4f46e5',
            borderColor: e.color || '#4f46e5',
            title: e.title,
        })),
        eventClick: info => {
            const contract = allContracts.find(c => c.id === info.event.id);
            if (contract) viewContract(contract.id);
        },
        eventBackgroundColor: '#4f46e5',
        height: 'auto',
        locale: 'en'
    });
    calendar.render();
}

function contractIssues(c) {
    const issues = { law: false, contracts: false, internal: false, ambiguity: false, anyLow: false, lowCount: 0 };
    (c.matrix && c.matrix.rows ? c.matrix.rows : []).forEach(r => {
        if (r.confidence === 'low' && r.low_reason) {
            issues.anyLow = true;
            issues.lowCount++;
            if (r.low_reason.type === 'statute') issues.law = true;
            if (r.low_reason.type === 'conflict') issues.contracts = true;
            if (r.low_reason.type === 'internal') issues.internal = true;
            if (r.low_reason.type === 'ambiguity') issues.ambiguity = true;
        }
    });
    return issues;
}

function truncateText(s, n) {
    const t = String(s || '').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function issueChipsHtml(c) {
    const issues = contractIssues(c);
    const rows = (c.matrix && c.matrix.rows) ? c.matrix.rows : [];
    const chips = [];

    if (issues.law) {
        const statutes = [];
        rows.forEach(r => {
            if (r.confidence === 'low' && r.low_reason && r.low_reason.type === 'statute' && r.low_reason.statute) {
                const s = r.low_reason.statute;
                let label = s.name || 'Unnamed statute';
                if (s.section && !/^n\/a/i.test(String(s.section).trim())) label += ', ' + s.section;
                if (!statutes.some(x => x.toLowerCase() === label.toLowerCase())) statutes.push(label);
            }
        });
        const shown = statutes.slice(0, 2).map(s => truncateText(s, 38));
        const more = statutes.length > 2 ? ` +${statutes.length - 2} more` : '';
        chips.push(`<span class="issue-chip issue-law" title="Clashes with: ${escapeHtml(statutes.join('; '))}"><i class="fas fa-scale-balanced"></i> Law: ${escapeHtml(shown.join(' · '))}${more}</span>`);
    }

    if (issues.contracts) {
        const others = [];
        rows.forEach(r => {
            if (r.confidence === 'low' && r.low_reason && r.low_reason.type === 'conflict' && r.low_reason.conflict_with && r.low_reason.conflict_with.contract) {
                const nm = r.low_reason.conflict_with.contract;
                if (!others.includes(nm)) others.push(nm);
            }
        });
        const shown = others.slice(0, 2).map(s => truncateText(s, 30));
        const more = others.length > 2 ? ` +${others.length - 2} more` : '';
        chips.push(`<span class="issue-chip issue-contracts" title="Clashes with: ${escapeHtml(others.join('; '))}"><i class="fas fa-file-circle-exclamation"></i> vs: ${escapeHtml(shown.join(' · '))}${more}</span>`);
    }

    if (issues.internal) {
        const pairs = [];
        rows.forEach(r => {
            if (r.confidence === 'low' && r.low_reason && r.low_reason.type === 'internal' && r.low_reason.internal_conflict) {
                const aRaw = r.clause || 'Unlabelled clause';
                const bRaw = r.low_reason.internal_conflict.clause || 'Unlabelled clause';
                const pair = aRaw.trim().toLowerCase() === bRaw.trim().toLowerCase()
                    ? `within ${truncateText(aRaw, 30)}`
                    : `${truncateText(aRaw, 22)} ↔ ${truncateText(bRaw, 22)}`;
                if (!pairs.includes(pair)) pairs.push(pair);
            }
        });
        const shown = pairs.slice(0, 2);
        const more = pairs.length > 2 ? ` +${pairs.length - 2} more` : '';
        chips.push(`<span class="issue-chip issue-internal" title="Internal clashes: ${escapeHtml(pairs.join('; '))}"><i class="fas fa-rotate"></i> ${escapeHtml(shown.join(' · '))}${more}</span>`);
    }

    if (chips.length === 0) chips.push('<span class="issue-chip issue-clean" title="No statute, cross-contract or internal conflicts flagged"><i class="fas fa-check"></i> No issue</span>');
    if (issues.lowCount > 0) chips.push(`<span class="issue-chip issue-count" title="Total low-confidence flags">${issues.lowCount} flag${issues.lowCount > 1 ? 's' : ''}</span>`);
    return `<div class="issue-chips">${chips.join('')}</div>`;
}

function filterContracts() {
    const type = document.getElementById('typeFilter').value;
    const party = document.getElementById('partyFilter').value.toLowerCase();
    const search = document.getElementById('searchInput').value.toLowerCase();
    const issue = document.getElementById('issueFilter').value;
    let filtered = allContracts;
    if (type) filtered = filtered.filter(c => c.contract_type === type);
    if (party) filtered = filtered.filter(c => (c.parties || []).some(p => p.toLowerCase() === party));
    if (issue) {
        filtered = filtered.filter(c => {
            const issues = contractIssues(c);
            if (issue === 'law') return issues.law;
            if (issue === 'contracts') return issues.contracts;
            if (issue === 'internal') return issues.internal;
            if (issue === 'none') return !issues.law && !issues.contracts && !issues.internal;
            return true;
        });
    }
    if (search) filtered = filtered.filter(c => c.contract_name.toLowerCase().includes(search) || (c.parties || []).some(p => p.toLowerCase().includes(search)));
    renderContracts(filtered);
}

function citeHtml(c, cit) {
    const ct = cit || {};
    const parts = [];
    if (ct.page) parts.push('p.' + ct.page);
    if (ct.paragraph) parts.push('¶' + ct.paragraph);
    if (ct.clause) parts.push(ct.clause);
    if (parts.length === 0) return '';
    const label = parts.join(' · ');
    const isPdf = (c.filepath || '').toLowerCase().endsWith('.pdf');
    if (isPdf && ct.page) {
        const params = new URLSearchParams({
            file: c.filepath, page: ct.page, q: ct.quote || '',
            clause: ct.clause || '', para: ct.paragraph || '', name: c.contract_name || ''
        });
        return `<a class="cite-link" href="/viewer?${params.toString()}" target="_blank" title="Open source document at page ${ct.page}, highlighted"><i class="fas fa-arrow-up-right-from-square"></i> ${escapeHtml(label)}</a>`;
    }
    return `<span class="cite-link"><i class="fas fa-quote-right"></i> ${escapeHtml(label)}</span>`;
}

function basisBadge(basis) {
    const b = basis === 'found' ? 'found' : 'inferred';
    return `<span class="basis-badge basis-${b}" title="${b === 'found' ? 'Explicitly found in the document' : 'Inferred by the AI, not explicitly stated'}">${b.toUpperCase()}</span>`;
}

function viewContract(id) {
    const c = allContracts.find(cc => cc.id === id);
    if (!c) return;
    document.getElementById('modalTitle').textContent = c.contract_name;
    const fc = c.field_citations || {};

    const row = (label, value, cit) =>
        `<div class="detail-row"><strong>${label}</strong><span>${value}${citeHtml(c, cit)} ${basisBadge(cit && cit.basis)}</span></div>`;

    const facts = c.facts || [];
    const factsHtml = facts.length > 0 ? facts.map(f => `
        <div class="fact-item conf-border-${f.confidence || 'low'}">
            <div class="fact-header">
                <span class="fact-term">${escapeHtml(f.term)}</span>
                <span class="fact-badges">${basisBadge(f.basis)}<span class="conf-badge conf-${f.confidence || 'low'}">${escapeHtml(f.confidence || 'low')}</span></span>
            </div>
            <div class="fact-value">${escapeHtml(f.value)}</div>
            ${(f.quote || f.page || f.clause) ? `<div class="fact-source">${citeHtml(c, f)}${f.quote ? `"${escapeHtml(f.quote)}"` : ''}</div>` : ''}
        </div>
    `).join('') : '<p class="placeholder">No facts extracted for this contract</p>';

    const dd = c.deliverable_details || [];
    const delivHtml = dd.length > 0 ? `
        <h4 style="margin-top:16px;margin-bottom:10px"><i class="fas fa-calendar-check"></i> Deliverables &amp; Deadlines</h4>
        <div class="deliv-cite-list">${dd.map(d => `
            <div class="deliv-row">
                <span class="deliv-date">${new Date(d.date).toLocaleDateString()}</span>
                <span class="deliv-desc">${escapeHtml(d.description)}</span>
                <span class="deliv-cite">${basisBadge(d.basis)}${citeHtml(c, d)}</span>
            </div>
        `).join('')}</div>` : '';

    const flaggedRows = (c.matrix && c.matrix.rows ? c.matrix.rows : []).filter(r => r.confidence === 'low' && r.low_reason);
    const issuesHtml = flaggedRows.length > 0
        ? flaggedRows.map((r, i) => issueDetailHtml(c, r, i === 0)).join('')
        : '<p class="placeholder" style="padding:14px">No flagged issues - no statute, cross-contract or internal conflicts detected.</p>';

    const methodLabel = c.extraction_method === 'ai_vision' ? 'AI vision OCR' : (c.extraction_method === 'ai' ? 'AI extraction' : 'rule-based fallback');
    const body = `
        ${row('Contract Type', escapeHtml(c.contract_type || 'N/A'), fc.contract_type)}
        ${row('Parties', escapeHtml(c.parties ? c.parties.join(', ') : 'N/A'), fc.parties)}
        ${row('Start Date', c.start_date ? new Date(c.start_date).toLocaleDateString() : 'N/A', fc.start_date)}
        ${row('End Date', c.end_date ? new Date(c.end_date).toLocaleDateString() : 'N/A', fc.end_date)}
        ${row('Deliverables', String(c.deliverables ? c.deliverables.length : 0), fc.deliverables)}
        <div class="detail-row"><strong>Uploaded</strong><span>${c.uploaded_at ? new Date(c.uploaded_at).toLocaleDateString() : 'N/A'}</span></div>
        <div class="detail-row"><strong>Extraction</strong><span><i class="fas fa-robot"></i> ${methodLabel}</span></div>
        ${flaggedRows.length > 0 ? `<h4 style="margin-top:16px;margin-bottom:10px"><i class="fas fa-triangle-exclamation"></i> Flagged Issues (${flaggedRows.length}) - click to expand</h4>
        <div class="issues-list">${issuesHtml}</div>` : ''}
        <h4 style="margin-top:16px;margin-bottom:10px"><i class="fas fa-list-check"></i> Extracted Facts &amp; Terms</h4>
        <div class="facts-list">${factsHtml}</div>
        ${delivHtml}
        <button class="btn btn-danger" style="margin-top:16px" onclick="deleteContract('${c.id}')"><i class="fas fa-trash"></i> Delete Contract</button>
    `;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; }

async function deleteContract(id) {
    if (!confirm('Are you sure you want to delete this contract?')) return;
    try {
        await fetch(`${API_BASE}/delete/${id}`, { method: 'DELETE' });
        closeModal(); refreshData();
    } catch (err) { console.error('Delete error:', err); }
}

function showPopup(title, html) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('modalOverlay').style.display = 'flex';
}

let currentMatrix = null;
let matrixContractId = null;

function populateMatrixSelect() {
    const sel = document.getElementById('matrixContractSelect');
    const current = matrixContractId;
    sel.innerHTML = '<option value="">Select contract…</option>' +
        allContracts.map(c => `<option value="${c.id}">${escapeHtml(c.contract_name)}</option>`).join('');
    if (current && allContracts.some(c => c.id === current)) {
        sel.value = current;
    } else if (allContracts.length > 0) {
        matrixContractId = allContracts[0].id;
        sel.value = matrixContractId;
    }
}

function onMatrixContractChange() {
    matrixContractId = document.getElementById('matrixContractSelect').value;
    if (matrixContractId) loadMatrix(false);
}

async function loadMatrix(force) {
    const container = document.getElementById('matrixContainer');
    if (!matrixContractId) {
        container.innerHTML = '<p class="placeholder">Select a contract to view its extracted terms matrix</p>';
        return;
    }
    container.innerHTML = '<p class="placeholder"><i class="fas fa-spinner fa-spin"></i> Analyzing contract with AI (party terms, confidence, statute & conflict checks)…</p>';
    try {
        const res = await fetch(`${API_BASE}/matrix/${matrixContractId}${force ? '?force=1' : ''}`, { method: force ? 'POST' : 'GET' });
        const data = await res.json();
        if (!res.ok) {
            container.innerHTML = `<p class="placeholder"><i class="fas fa-triangle-exclamation"></i> ${escapeHtml(data.error || 'Matrix analysis failed')}</p>`;
            return;
        }
        currentMatrix = data.matrix;
        renderMatrix(currentMatrix);
    } catch (err) {
        container.innerHTML = '<p class="placeholder">Failed to reach the server</p>';
    }
}

function renderMatrix(m) {
    const container = document.getElementById('matrixContainer');
    const c = allContracts.find(x => x.id === matrixContractId);
    const p1 = m.party1 && m.party1.name ? m.party1 : { name: 'Party 1' };
    const p2 = m.party2 && m.party2.name ? m.party2 : { name: 'Party 2' };
    const roleTag = p => p.role ? ` <small>${escapeHtml(p.role)}</small>` : '';

    const rowsHtml = m.rows.map(r => {
        if (r.not_addressed) {
            return `<tr class="matrix-na"><td colspan="2">Not addressed in this contract</td><td><span class="na-badge">N/A</span></td></tr>`;
        }
        const conf = r.confidence === 'low'
            ? `<span class="conf-badge conf-low conf-clickable" onclick="openLowPopup('${escapeHtml(r.topic).replace(/'/g, '&#39;')}')" title="Click for explanation &amp; recommendation">LOW ⓘ</span>`
            : `<span class="conf-badge conf-high">HIGH</span>`;
        const cite = citeHtml(c, r);
        if (r.both) {
            return `<tr class="merged-row">
                <td colspan="2"><div class="cell-both"><span class="both-tag">MUTUAL</span> ${escapeHtml(r.both)}${cite ? `<div class="cell-cite">${cite}${r.quote ? `<span class="cell-quote">"${escapeHtml(r.quote)}"</span>` : ''}</div>` : ''}</div></td>
                <td class="conf-cell">${conf}</td></tr>`;
        }
        return `<tr>
            <td>${r.party1 ? escapeHtml(r.party1) : '—'}${cite ? `<div class="cell-cite">${cite}${r.quote ? `<span class="cell-quote">"${escapeHtml(r.quote)}"</span>` : ''}</div>` : ''}</td>
            <td>${r.party2 ? escapeHtml(r.party2) : '—'}</td>
            <td class="conf-cell">${conf}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <div class="matrix-parties">
            <div class="matrix-party"><span class="party-tag">Party 1</span><strong>${escapeHtml(p1.name)}</strong>${roleTag(p1)}</div>
            <div class="matrix-vs"><i class="fas fa-right-left"></i></div>
            <div class="matrix-party"><span class="party-tag">Party 2</span><strong>${escapeHtml(p2.name)}</strong>${roleTag(p2)}</div>
        </div>
        <table class="matrix-table">
            <thead><tr><th>${escapeHtml(p1.name)}</th><th>${escapeHtml(p2.name)}</th><th>Confidence</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>`;
}

function issueTypeMeta(type) {
    const map = {
        statute: { chip: 'issue-law', icon: 'fa-scale-balanced', label: 'Clash with the law' },
        conflict: { chip: 'issue-contracts', icon: 'fa-file-circle-exclamation', label: 'Clash with another contract' },
        internal: { chip: 'issue-internal', icon: 'fa-rotate', label: 'Internal clash' },
        ambiguity: { chip: 'issue-ambiguity', icon: 'fa-circle-question', label: 'Ambiguity' },
    };
    return map[type] || map.ambiguity;
}

function issueDetailHtml(c, row, open) {
    const lr = row.low_reason;
    const cite = citeHtml(c, row);
    const meta = issueTypeMeta(lr.type);

    let detailBox = '';

    if (lr.type === 'statute' && lr.statute) {
        const sUrl = lr.statute.url || 'https://sso.agc.gov.sg/';
        detailBox = `<div class="lr-box lr-statute">
            <div class="lr-box-title"><i class="fas fa-scale-balanced"></i> Statutory conflict</div>
            <p><strong>${escapeHtml(lr.statute.name)}</strong>${lr.statute.section ? `, ${escapeHtml(lr.statute.section)}` : ''}
            &nbsp;<a href="${escapeHtml(sUrl)}" target="_blank" class="cite-link"><i class="fas fa-arrow-up-right-from-square"></i> View statute / guidance</a></p>
        </div>`;
    } else if (lr.type === 'conflict' && lr.conflict_with) {
        const cw = lr.conflict_with;
        const target = cw.contract_id ? allContracts.find(x => x.id === cw.contract_id) : null;
        let targetLinks = '';
        if (target) {
            targetLinks = `<div class="lr-actions">
                <button class="btn btn-sm btn-primary" onclick="closeModal(); viewContract('${target.id}')"><i class="fas fa-file-contract"></i> Open conflicting contract</button>
                ${(target.filepath || '').toLowerCase().endsWith('.pdf') ? `<a class="btn btn-sm btn-outline" target="_blank" href="/viewer?file=${encodeURIComponent(target.filepath)}&page=1&name=${encodeURIComponent(target.contract_name)}"><i class="fas fa-arrow-up-right-from-square"></i> View its source</a>` : ''}
            </div>`;
        }
        detailBox = `<div class="lr-box lr-conflict">
            <div class="lr-box-title"><i class="fas fa-file-circle-exclamation"></i> Cross-contract conflict</div>
            <p><strong>${escapeHtml(cw.contract)}</strong></p>
            <p>${escapeHtml(cw.detail)}</p>
            ${targetLinks}
        </div>`;
    } else if (lr.type === 'internal' && lr.internal_conflict) {
        const ic = lr.internal_conflict;
        detailBox = `<div class="lr-box lr-internal">
            <div class="lr-box-title"><i class="fas fa-rotate"></i> Internal clash within this contract</div>
            <div class="clash-pair">
                <div class="clash-side">
                    <span class="clash-label">Clause 1 - flagged row</span>
                    <strong>${escapeHtml(row.clause || 'Unlabelled clause')}</strong>
                    ${citeHtml(c, row)}
                    ${row.quote ? `<div class="cell-quote">"${escapeHtml(row.quote)}"</div>` : ''}
                </div>
                <div class="clash-vs"><i class="fas fa-bolt"></i> clashes with</div>
                <div class="clash-side">
                    <span class="clash-label">Clause 2 - contradicting clause</span>
                    <strong>${escapeHtml(ic.clause || 'Unlabelled clause')}</strong>
                    ${citeHtml(c, ic)}
                    ${ic.quote ? `<div class="cell-quote">"${escapeHtml(ic.quote)}"</div>` : ''}
                </div>
            </div>
        </div>`;
    } else {
        detailBox = `<div class="lr-box lr-ambiguity">
            <div class="lr-box-title"><i class="fas fa-circle-question"></i> Ambiguity</div>
        </div>`;
    }

    return `
      <details class="issue-details"${open ? ' open' : ''}>
        <summary>
            <span class="issue-chip ${meta.chip}"><i class="fas ${meta.icon}"></i> ${meta.label}</span>
            <span class="issue-topic">${escapeHtml(row.topic)}</span>
            ${cite}
        </summary>
        <div class="issue-body">
            ${detailBox}
            ${row.quote ? `<div class="lr-quote">"${escapeHtml(row.quote)}"</div>` : ''}
            <p class="lr-explain">${escapeHtml(lr.explanation)}</p>
            <div class="lr-recommend"><strong>Recommendation:</strong> ${escapeHtml(lr.recommendation)}</div>
        </div>
      </details>`;
}

function openLowPopup(topic) {
    if (!currentMatrix) return;
    const c = allContracts.find(x => x.id === matrixContractId);
    const row = currentMatrix.rows.find(r => r.topic === topic);
    if (!row || !row.low_reason) return;
    const html = `
        <div class="lowconf-header">
            <span class="conf-badge conf-low">LOW CONFIDENCE</span>
            <strong>${escapeHtml(row.topic)}</strong>
        </div>
        ${issueDetailHtml(c, row, true)}
        <p class="lr-note"><i class="fas fa-robot"></i> AI-generated analysis - statutory references should be verified on Singapore Statutes Online and with counsel.</p>
    `;
    showPopup('Low Confidence Explanation', html);
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
    if (tabName === 'calendar' || tabName === 'dashboard') refreshData();
    if (tabName === 'calendar' && matrixContractId) loadMatrix(false);
}

document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
