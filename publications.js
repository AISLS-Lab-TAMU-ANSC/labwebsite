// Loads data/publications.json (kept up to date by scripts/fetch_publications.py)
// and renders it, grouped by year, into #pub-container on publications-and-awards.html.
// Also wires up the #pub-search box to instantly filter by title/author/year.
document.addEventListener('DOMContentLoaded', function () {
    var statusEl = document.getElementById('pub-status');
    var containerEl = document.getElementById('pub-container');
    var searchInput = document.getElementById('pub-search');
    var searchWrapEl = document.querySelector('.pub-search-wrap');
    if (!statusEl || !containerEl) return;

    var SCHOLAR_PROFILE_URL = 'https://scholar.google.com/citations?user=nJoDXMMAAAAJ&hl=en';

    // {card: HTMLElement, group: HTMLElement, searchText: string}
    var entries = [];
    var baseStatusText = '';
    var noResultsEl = null;

    if (searchWrapEl) searchWrapEl.style.display = 'none';

    fetch('data/publications.json', { cache: 'no-store' })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(renderPublications)
        .catch(function (err) {
            console.error('Failed to load publications:', err);
            statusEl.textContent = 'Could not load the publications list right now. ';
            var link = document.createElement('a');
            link.href = SCHOLAR_PROFILE_URL;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = 'View the profile directly on Google Scholar.';
            statusEl.appendChild(link);
        });

    function renderPublications(data) {
        var pubs = Array.isArray(data.publications) ? data.publications : [];
        if (pubs.length === 0) {
            statusEl.textContent = 'No publications found yet.';
            return;
        }

        var byYear = new Map();
        pubs.forEach(function (pub) {
            var key = pub.year || 'Undated';
            if (!byYear.has(key)) byYear.set(key, []);
            byYear.get(key).push(pub);
        });

        var years = Array.from(byYear.keys()).sort(function (a, b) {
            if (a === 'Undated') return 1;
            if (b === 'Undated') return -1;
            return b - a;
        });

        var frag = document.createDocumentFragment();

        years.forEach(function (year) {
            var group = document.createElement('div');
            group.className = 'pub-year-group';

            var heading = document.createElement('h3');
            heading.className = 'pub-year-heading';
            heading.textContent = year;
            group.appendChild(heading);

            var list = document.createElement('div');
            list.className = 'pub-list';
            byYear.get(year).forEach(function (pub) {
                var card = buildCard(pub);
                list.appendChild(card);
                entries.push({
                    card: card,
                    group: group,
                    searchText: buildSearchText(pub, year),
                });
            });
            group.appendChild(list);

            frag.appendChild(group);
        });

        containerEl.appendChild(frag);

        noResultsEl = document.createElement('p');
        noResultsEl.className = 'pub-status pub-hidden';
        noResultsEl.textContent = 'No publications match your search.';
        containerEl.appendChild(noResultsEl);

        var total = pubs.length;
        var generated = data.generatedAt
            ? new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
            : null;
        baseStatusText = total + ' publication' + (total === 1 ? '' : 's') +
            (generated ? ' — last synced ' + generated : '');
        statusEl.textContent = baseStatusText;

        if (searchWrapEl) searchWrapEl.style.display = '';
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                applyFilter(searchInput.value);
            });
        }
    }

    function buildSearchText(pub, year) {
        var parts = [
            pub.title || '',
            Array.isArray(pub.authors) ? pub.authors.join(' ') : '',
            pub.venue || '',
            year !== 'Undated' ? String(year) : '',
        ];
        return parts.join(' ').toLowerCase();
    }

    function applyFilter(query) {
        var q = query.trim().toLowerCase();
        var visibleCount = 0;

        entries.forEach(function (entry) {
            var matches = !q || entry.searchText.indexOf(q) !== -1;
            entry.card.classList.toggle('pub-hidden', !matches);
            if (matches) visibleCount++;
        });

        var seenGroups = new Set();
        entries.forEach(function (entry) {
            if (seenGroups.has(entry.group)) return;
            seenGroups.add(entry.group);
            var groupHasVisible = entry.group.querySelector('.pub-card:not(.pub-hidden)');
            entry.group.classList.toggle('pub-hidden', !groupHasVisible);
        });

        if (!q) {
            statusEl.textContent = baseStatusText;
            if (noResultsEl) noResultsEl.classList.add('pub-hidden');
        } else if (visibleCount === 0) {
            statusEl.textContent = '';
            if (noResultsEl) noResultsEl.classList.remove('pub-hidden');
        } else {
            if (noResultsEl) noResultsEl.classList.add('pub-hidden');
            statusEl.textContent = 'Showing ' + visibleCount + ' of ' + entries.length +
                ' publications matching "' + query.trim() + '"';
        }
    }

    function buildCard(pub) {
        var card = document.createElement('div');
        card.className = 'pub-card';

        var title = document.createElement('a');
        title.className = 'pub-title';
        title.textContent = pub.title || 'Untitled';
        title.href = pub.url || SCHOLAR_PROFILE_URL;
        title.target = '_blank';
        title.rel = 'noopener';
        card.appendChild(title);

        if (Array.isArray(pub.authors) && pub.authors.length) {
            var authors = document.createElement('p');
            authors.className = 'pub-authors';
            authors.textContent = pub.authors.join(', ');
            card.appendChild(authors);
        }

        var meta = document.createElement('div');
        meta.className = 'pub-meta';

        var venue = document.createElement('span');
        venue.className = 'pub-venue';
        venue.textContent = (pub.venue || '') + (pub.year ? ' (' + pub.year + ')' : '');
        meta.appendChild(venue);

        if (typeof pub.citations === 'number' && pub.citations > 0) {
            var badge = document.createElement('span');
            badge.className = 'pub-citation-badge';
            badge.textContent = pub.citations + (pub.citations === 1 ? ' citation' : ' citations');
            meta.appendChild(badge);
        }

        card.appendChild(meta);
        return card;
    }
});
