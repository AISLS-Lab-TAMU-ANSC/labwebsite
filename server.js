import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files (the existing site) from project root
app.use(express.static(__dirname));

// Paths for data persistence
const DATA_DIR = path.join(__dirname, 'data');
const MOCK_FILE = path.join(DATA_DIR, 'mock-hostaway-reviews.json');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');

// Ensure data directory and files exist
async function ensureDataFiles() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
  try {
    await fs.access(MOCK_FILE);
  } catch {
    await fs.writeFile(MOCK_FILE, JSON.stringify({ status: 'success', result: [] }, null, 2));
  }
  try {
    await fs.access(APPROVALS_FILE);
  } catch {
    await fs.writeFile(APPROVALS_FILE, JSON.stringify({}, null, 2));
  }
}

function toIsoDateTime(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) {
    return new Date(dateStr).toISOString();
  }
  return d.toISOString();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function computeOverallRating(review) {
  // Prefer direct rating if present and numeric
  if (typeof review.rating === 'number' && !isNaN(review.rating)) {
    // Hostaway example sometimes uses 1-10; map to 5 if > 5
    return review.rating > 5 ? Math.round((review.rating / 2) * 10) / 10 : review.rating;
  }
  if (Array.isArray(review.reviewCategory) && review.reviewCategory.length > 0) {
    const values = review.reviewCategory
      .map(c => (typeof c.rating === 'number' ? c.rating : null))
      .filter(v => v !== null);
    if (values.length) {
      const avg10 = values.reduce((a, b) => a + b, 0) / values.length; // out of 10
      return Math.round((avg10 / 2) * 10) / 10; // convert to 5-scale, 1 decimal
    }
  }
  return null;
}

function normalizeHostawayReview(raw, approvalsMap) {
  const listingName = raw.listingName || raw.listing_title || 'Unknown Listing';
  const listingId = raw.listingId || raw.listing_id || slugify(listingName);
  const categories = Array.isArray(raw.reviewCategory)
    ? raw.reviewCategory.reduce((acc, c) => {
        const key = String(c.category || '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
        if (typeof c.rating === 'number') acc[key] = c.rating > 5 ? c.rating / 2 : c.rating;
        return acc;
      }, {})
    : {};

  const id = String(raw.id ?? raw.reviewId ?? `${listingId}-${toIsoDateTime(raw.submittedAt)}`);
  const approved = Boolean(approvalsMap[id]?.approved);

  return {
    id,
    source: 'hostaway',
    type: raw.type || raw.review_type || 'guest-to-host',
    status: raw.status || 'published',
    listingId,
    listingName,
    reviewerName: raw.guestName || raw.reviewer_name || null,
    submittedAt: toIsoDateTime(raw.submittedAt || raw.created_at || raw.updated_at),
    ratingOverall: computeOverallRating(raw),
    ratingScale: 5,
    categoryRatings: categories,
    textPublic: raw.publicReview || raw.public_review || raw.review_text || '',
    channel: raw.channel || raw.platform || 'direct',
    approved,
  };
}

async function readJson(filePath, fallback) {
  try {
    const txt = await fs.readFile(filePath, 'utf8');
    return JSON.parse(txt);
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function fetchHostawayReviewsReal(accountId, apiKey) {
  // Note: Sandbox returns no reviews per instructions; implemented for completeness
  const url = `https://api.hostaway.com/v1/reviews?accountId=${encodeURIComponent(accountId)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hostaway API error ${res.status}: ${text}`);
  }
  return res.json();
}

function applyFilters(reviews, query) {
  let filtered = reviews;
  const { listingId, channel, type, approvedOnly, minRating, startDate, endDate } = query;

  if (listingId) {
    const lid = String(listingId).toLowerCase();
    filtered = filtered.filter(r => r.listingId.toLowerCase() === lid || slugify(r.listingName) === lid);
  }
  if (channel) {
    const cset = new Set(String(channel).split(',').map(s => s.trim().toLowerCase()));
    filtered = filtered.filter(r => cset.has(String(r.channel || '').toLowerCase()));
  }
  if (type) {
    const tset = new Set(String(type).split(',').map(s => s.trim().toLowerCase()));
    filtered = filtered.filter(r => tset.has(String(r.type || '').toLowerCase()));
  }
  if (approvedOnly === 'true') {
    filtered = filtered.filter(r => r.approved);
  }
  if (minRating) {
    const min = Number(minRating);
    if (!isNaN(min)) {
      filtered = filtered.filter(r => (typeof r.ratingOverall === 'number' ? r.ratingOverall >= min : false));
    }
  }
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate) : null;
    const endD = endDate ? new Date(endDate) : null;
    filtered = filtered.filter(r => {
      if (!r.submittedAt) return false;
      const d = new Date(r.submittedAt);
      if (start && d < start) return false;
      if (endD && d > endD) return false;
      return true;
    });
  }
  return filtered;
}

// GET /api/reviews/hostaway - normalized reviews (real or mock)
app.get('/api/reviews/hostaway', async (req, res) => {
  try {
    await ensureDataFiles();
    const approvals = await readJson(APPROVALS_FILE, {});

    const useMock = req.query.useMock === 'true' || process.env.USE_MOCK === 'true';
    let raw;
    if (!useMock && process.env.HOSTAWAY_ACCOUNT_ID && process.env.HOSTAWAY_API_KEY) {
      try {
        raw = await fetchHostawayReviewsReal(process.env.HOSTAWAY_ACCOUNT_ID, process.env.HOSTAWAY_API_KEY);
      } catch (err) {
        // Fallback to mock if real API fails or returns empty
        raw = await readJson(MOCK_FILE, { status: 'success', result: [] });
      }
    } else {
      raw = await readJson(MOCK_FILE, { status: 'success', result: [] });
    }
    const results = Array.isArray(raw?.result) ? raw.result : [];
    const normalized = results.map(r => normalizeHostawayReview(r, approvals));
    const filtered = applyFilters(normalized, req.query);

    const response = {
      status: 'success',
      count: filtered.length,
      totals: {
        all: normalized.length,
        approved: normalized.filter(r => r.approved).length,
        byChannel: normalized.reduce((acc, r) => {
          const key = r.channel || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        byListing: normalized.reduce((acc, r) => {
          acc[r.listingId] = (acc[r.listingId] || 0) + 1;
          return acc;
        }, {}),
      },
      result: filtered,
    };
    res.json(response);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Approvals API
app.get('/api/reviews/approvals', async (req, res) => {
  try {
    await ensureDataFiles();
    const approvals = await readJson(APPROVALS_FILE, {});
    res.json({ status: 'success', result: approvals });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/reviews/approvals', async (req, res) => {
  try {
    await ensureDataFiles();
    const { reviewId, approved, listingId } = req.body || {};
    if (!reviewId || typeof approved !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'reviewId and approved are required' });
    }
    const approvals = await readJson(APPROVALS_FILE, {});
    approvals[String(reviewId)] = { approved, listingId: listingId || null, updatedAt: new Date().toISOString() };
    await writeJson(APPROVALS_FILE, approvals);
    res.json({ status: 'success', result: approvals[String(reviewId)] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.patch('/api/reviews/:id/approve', async (req, res) => {
  try {
    await ensureDataFiles();
    const id = String(req.params.id);
    const { approved } = req.body || {};
    if (typeof approved !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'approved (boolean) is required' });
    }
    const approvals = await readJson(APPROVALS_FILE, {});
    approvals[id] = { ...(approvals[id] || {}), approved, updatedAt: new Date().toISOString() };
    await writeJson(APPROVALS_FILE, approvals);
    res.json({ status: 'success', result: approvals[id] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Google Reviews (Exploration)
app.get('/api/reviews/google', async (req, res) => {
  try {
    const { placeId } = req.query;
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return res.json({
        status: 'disabled',
        message: 'Set GOOGLE_PLACES_API_KEY to enable this route',
      });
    }
    if (!placeId) {
      return res.status(400).json({ status: 'error', message: 'placeId is required' });
    }
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=rating,user_ratings_total,reviews,name&key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const reviews = (data.result?.reviews || []).map((r, idx) => ({
      id: r.time ? String(r.time) : String(idx),
      source: 'google',
      type: 'guest-to-host',
      status: 'published',
      listingId: slugify(data.result?.name || 'google-place'),
      listingName: data.result?.name || 'Google Place',
      reviewerName: r.author_name,
      submittedAt: new Date(r.time * 1000).toISOString(),
      ratingOverall: r.rating,
      ratingScale: 5,
      categoryRatings: {},
      textPublic: r.text,
      channel: 'google',
      approved: false,
    }));
    res.json({ status: 'success', count: reviews.length, result: reviews });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


