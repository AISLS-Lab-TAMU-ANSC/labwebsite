async function fetchReviews(params = {}) {
  const qs = new URLSearchParams({ useMock: 'true', ...params });
  const res = await fetch(`/api/reviews/hostaway?${qs.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch reviews');
  return res.json();
}

async function setApproval(reviewId, approved) {
  const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved })
  });
  if (!res.ok) throw new Error('Failed to update approval');
  return res.json();
}

function byDateDesc(a, b) {
  const da = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
  const db = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
  return db - da;
}

function renderStats(container, data) {
  const { totals } = data;
  const channelEntries = Object.entries(totals.byChannel || {});
  container.innerHTML = `
    <div class="stat"><strong>Total</strong><div>${totals.all}</div></div>
    <div class="stat"><strong>Approved</strong><div>${totals.approved}</div></div>
    <div class="stat"><strong>Channels</strong><div>${channelEntries.map(([k,v]) => `<span class="pill">${k}: ${v}</span>`).join(' ')}</div></div>
  `;
}

function renderRows(container, list) {
  container.innerHTML = '';
  list.sort(byDateDesc).forEach(r => {
    const row = document.createElement('div');
    row.className = 'grid row';
    const rating = typeof r.ratingOverall === 'number' ? `${r.ratingOverall.toFixed(1)}/${r.ratingScale}` : '-';
    const approvedClass = r.approved ? 'pill approved' : 'pill';
    row.innerHTML = `
      <div>
        <div><strong>${r.listingName}</strong></div>
        <div class="review-text">${r.textPublic || ''}</div>
      </div>
      <div><span class="pill">${r.channel}</span></div>
      <div><span class="pill">${r.type}</span></div>
      <div>${rating}</div>
      <div>${r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '-'}</div>
      <div>
        <div class="controls">
          <button class="btn ${r.approved ? '' : 'primary'}" data-action="toggle" data-id="${r.id}">${r.approved ? 'Unapprove' : 'Approve'}</button>
          <span class="${approvedClass}">${r.approved ? 'Approved' : 'Pending'}</span>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

function collectFilters() {
  const listingId = document.getElementById('listing').value.trim();
  const channel = document.getElementById('channel').value;
  const type = document.getElementById('type').value;
  const minRating = document.getElementById('minRating').value;
  const startDate = document.getElementById('dateStart').value;
  const endDate = document.getElementById('dateEnd').value;
  const approvedOnly = document.getElementById('approvedOnly').checked ? 'true' : '';
  const params = {};
  if (listingId) params.listingId = listingId;
  if (channel) params.channel = channel;
  if (type) params.type = type;
  if (minRating) params.minRating = minRating;
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  if (approvedOnly) params.approvedOnly = approvedOnly;
  return params;
}

async function load() {
  const params = collectFilters();
  const data = await fetchReviews(params);
  const rows = document.getElementById('rows');
  const stats = document.getElementById('stats');
  const empty = document.getElementById('empty');
  renderStats(stats, data);
  if (data.result.length === 0) {
    rows.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    renderRows(rows, data.result);
  }
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t && t.matches('button[data-action="toggle"]')) {
    const id = t.getAttribute('data-id');
    const unapprove = t.textContent.includes('Unapprove');
    await setApproval(id, !unapprove);
    await load();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('applyFilters').addEventListener('click', load);
  document.getElementById('resetFilters').addEventListener('click', () => {
    ['listing','channel','type','minRating','dateStart','dateEnd'].forEach(id => {
      const el = document.getElementById(id);
      if (el.tagName === 'SELECT') el.selectedIndex = 0; else el.value = '';
    });
    document.getElementById('approvedOnly').checked = false;
    load();
  });
  load();
});


