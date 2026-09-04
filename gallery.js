// Loads data/gallery.json (built by scripts/extract_pptx_photos.py) and
// streams it onto photos.html in batches as the user scrolls, instead of
// dropping all photos into the DOM (and requesting all of them) at once.
document.addEventListener('DOMContentLoaded', function () {
    var statusEl = document.getElementById('gallery-status');
    var gridEl = document.getElementById('gallery-grid');
    var sentinelEl = document.getElementById('gallery-sentinel');
    if (!statusEl || !gridEl) return;

    var BATCH_SIZE = 24;
    var photos = [];
    var loadedCount = 0;
    var lightbox = null;
    var observer = null;

    fetch('data/gallery.json', { cache: 'no-store' })
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(init)
        .catch(function (err) {
            console.error('Failed to load gallery:', err);
            statusEl.textContent = 'Could not load the photo gallery right now.';
        });

    function init(data) {
        photos = Array.isArray(data.photos) ? data.photos : [];
        if (photos.length === 0) {
            statusEl.textContent = 'No photos yet.';
            return;
        }

        lightbox = buildLightbox(photos);
        document.body.appendChild(lightbox.overlay);

        loadNextBatch();

        if (sentinelEl && 'IntersectionObserver' in window) {
            observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) loadNextBatch();
                });
            }, { rootMargin: '400px' });
            observer.observe(sentinelEl);
        }
    }

    function loadNextBatch() {
        if (loadedCount >= photos.length) {
            if (observer && sentinelEl) observer.unobserve(sentinelEl);
            statusEl.textContent = photos.length + ' photo' + (photos.length === 1 ? '' : 's');
            return;
        }

        var nextSlice = photos.slice(loadedCount, loadedCount + BATCH_SIZE);
        var frag = document.createDocumentFragment();

        nextSlice.forEach(function (photo, i) {
            var index = loadedCount + i;
            var thumb = document.createElement('div');
            thumb.className = 'gallery-thumb';

            var img = document.createElement('img');
            img.src = photo.file;
            img.alt = 'AISLS Lab photo ' + (index + 1);
            img.loading = 'lazy';
            thumb.appendChild(img);

            thumb.addEventListener('click', function () {
                lightbox.show(index);
            });

            frag.appendChild(thumb);
        });

        gridEl.appendChild(frag);
        loadedCount += nextSlice.length;

        statusEl.textContent = 'Showing ' + loadedCount + ' of ' + photos.length + ' photos' +
            (loadedCount < photos.length ? ' — scroll for more' : '');
    }

    function buildLightbox(allPhotos) {
        var currentIndex = -1;

        var overlay = document.createElement('div');
        overlay.className = 'gallery-lightbox pub-hidden';

        var closeBtn = document.createElement('button');
        closeBtn.className = 'gallery-lightbox-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        overlay.appendChild(closeBtn);

        var prevBtn = document.createElement('button');
        prevBtn.className = 'gallery-lightbox-nav gallery-lightbox-prev';
        prevBtn.type = 'button';
        prevBtn.setAttribute('aria-label', 'Previous photo');
        overlay.appendChild(prevBtn);

        var nextBtn = document.createElement('button');
        nextBtn.className = 'gallery-lightbox-nav gallery-lightbox-next';
        nextBtn.type = 'button';
        nextBtn.setAttribute('aria-label', 'Next photo');
        overlay.appendChild(nextBtn);

        var img = document.createElement('img');
        overlay.appendChild(img);

        function hide() {
            overlay.classList.add('pub-hidden');
            img.src = '';
        }

        function showAt(index) {
            if (index < 0 || index >= allPhotos.length) return;
            currentIndex = index;
            var photo = allPhotos[index];
            img.src = photo.file;
            img.alt = 'AISLS Lab photo ' + (index + 1);
            // Inline styles (not classes) so this can't collide with any
            // stylesheet rule ordering - only show an arrow when there is
            // somewhere for it to go.
            prevBtn.style.display = index > 0 ? 'flex' : 'none';
            nextBtn.style.display = index < allPhotos.length - 1 ? 'flex' : 'none';
            overlay.classList.remove('pub-hidden');
        }

        prevBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            showAt(currentIndex - 1);
        });
        nextBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            showAt(currentIndex + 1);
        });

        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target === closeBtn) hide();
        });
        document.addEventListener('keydown', function (e) {
            if (overlay.classList.contains('pub-hidden')) return;
            if (e.key === 'Escape') hide();
            else if (e.key === 'ArrowLeft') showAt(currentIndex - 1);
            else if (e.key === 'ArrowRight') showAt(currentIndex + 1);
        });

        return { overlay: overlay, show: showAt, hide: hide };
    }
});
