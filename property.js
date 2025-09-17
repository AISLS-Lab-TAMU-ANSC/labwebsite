async function fetchApproved(listingId) {
  const qs = new URLSearchParams({ useMock: 'true', approvedOnly: 'true', listingId });
  const res = await fetch(`/api/reviews/hostaway?${qs.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

function getParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function render(list, listingName) {
  document.getElementById('propertyName').textContent = listingName || 'Property';
  const container = document.getElementById('reviews');
  const empty = document.getElementById('noReviews');
  container.innerHTML = '';
  if (!list.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.forEach(r => {
    const div = document.createElement('div');
    div.className = 'review';
    const rating = typeof r.ratingOverall === 'number' ? `${r.ratingOverall.toFixed(1)}/${r.ratingScale}` : '';
    div.innerHTML = `
      <div class="meta">
        <span class="rating">${rating}</span>
        <span>•</span>
        <span>${r.reviewerName || 'Guest'}</span>
        <span>•</span>
        <span>${r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : ''}</span>
        <span>•</span>
        <span>${r.channel}</span>
      </div>
      <div>${r.textPublic || ''}</div>
    `;
    container.appendChild(div);
  });
}

async function load() {
  const listingId = getParam('listingId') || '';
  const data = await fetchApproved(listingId);
  const list = data.result || [];
  const listingName = list[0]?.listingName || '';
  render(list, listingName);
}

document.addEventListener('DOMContentLoaded', load);


