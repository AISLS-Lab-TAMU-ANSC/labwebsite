#!/usr/bin/env python3
# Install dependencies first:
#   pip install requests beautifulsoup4 lxml scholarly
# (scholarly is optional - the script falls back to requests/BeautifulSoup
#  scraping automatically if scholarly is not installed or gets blocked.)
"""
Fetch all publications listed on a Google Scholar author profile and save
them to a structured JSON file.

Google Scholar has no official public API and actively rate-limits /
CAPTCHA-blocks automated traffic. This script is best run occasionally by
hand (e.g. once a semester) rather than on a schedule or in CI. It tries the
`scholarly` library first (handles some blocking scenarios via proxies) and
falls back to a direct requests + BeautifulSoup scrape of the public
citations page, which is what Google Scholar actually renders server-side.

Usage:
    python scripts/fetch_publications.py
    python scripts/fetch_publications.py --user-id nJoDXMMAAAAJ --output data/publications.json
"""

import argparse
import difflib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

DEFAULT_USER_ID = "nJoDXMMAAAAJ"
SCHOLAR_BASE = "https://scholar.google.com"
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "data" / "publications.json"

# Conference abstracts are often listed with a leading abstract/program
# number, e.g. "254 Feedlot economic visualization...". Strip it for display.
LEADING_ABSTRACT_NUMBER_RE = re.compile(r"^\d{1,4}\s+(?=[A-Za-z])")

# Two titles at or above this ratio (after normalization) are treated as the
# same paper listed twice by Google Scholar (e.g. preprint + published
# version, or a conference abstract duplicated across two profile entries).
DEDUP_SIMILARITY_THRESHOLD = 0.85

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}


def log(msg):
    print(f"[fetch_publications] {msg}", file=sys.stderr)


def split_authors(raw):
    if not raw:
        return []
    return [a.strip() for a in raw.split(",") if a.strip()]


def clean_title(title):
    title = (title or "").strip()
    title = LEADING_ABSTRACT_NUMBER_RE.sub("", title)
    title = re.sub(r"\s+", " ", title)  # collapse doubled spaces from get_text(" ")
    return title.strip()


def normalize_for_dedup(title):
    t = clean_title(title).lower()
    t = t.rstrip(".… ")
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def merge_publication_group(group):
    """Collapse a cluster of near-identical publication records into one."""
    is_truncated = lambda p: p["title"].rstrip().endswith(("…", "..."))
    complete_titles = [p for p in group if not is_truncated(p)]
    title_candidates = complete_titles or group
    title = min(title_candidates, key=lambda p: len(p["title"]))["title"]

    year_counts = {}
    for p in group:
        if p["year"]:
            year_counts[p["year"]] = year_counts.get(p["year"], 0) + 1
    if year_counts:
        best_count = max(year_counts.values())
        year = max(y for y, c in year_counts.items() if c == best_count)
    else:
        year = None

    venue = max((p["venue"] for p in group), key=len, default="")
    authors = max(group, key=lambda p: len(p["authors"]))["authors"]
    citations = max(p["citations"] for p in group)
    url = max(group, key=lambda p: p["citations"])["url"]

    return {
        "title": title,
        "authors": authors,
        "venue": venue,
        "year": year,
        "citations": citations,
        "url": url,
    }


def dedupe_publications(publications):
    clusters = []  # list[list[int]] - indices into `publications`
    normalized = [normalize_for_dedup(p["title"]) for p in publications]

    for i, norm_i in enumerate(normalized):
        match = None
        for cluster in clusters:
            if difflib.SequenceMatcher(None, norm_i, normalized[cluster[0]]).ratio() >= DEDUP_SIMILARITY_THRESHOLD:
                match = cluster
                break
        if match is not None:
            match.append(i)
        else:
            clusters.append([i])

    merged = []
    removed = 0
    for cluster in clusters:
        group = [publications[i] for i in cluster]
        if len(group) == 1:
            merged.append(group[0])
        else:
            merged.append(merge_publication_group(group))
            removed += len(group) - 1

    if removed:
        log(f"Merged {removed} duplicate publication(s) into existing entries")

    return merged


def fetch_with_scholarly(user_id, delay=1.0):
    """Try the `scholarly` library. Returns a list of dicts or None on failure."""
    try:
        from scholarly import scholarly
    except ImportError:
        log("scholarly not installed, skipping to requests/BeautifulSoup fallback")
        return None

    try:
        author = scholarly.search_author_id(user_id)
        author = scholarly.fill(author, sections=["publications"])
    except Exception as err:
        log(f"scholarly failed to load author profile ({err}); falling back")
        return None

    publications = []
    for pub_stub in author.get("publications", []):
        try:
            pub = scholarly.fill(pub_stub)
        except Exception as err:
            log(f"scholarly failed to fetch one publication's details ({err}); skipping it")
            continue

        bib = pub.get("bib", {})
        year_raw = bib.get("pub_year")
        try:
            year = int(year_raw) if year_raw else None
        except (TypeError, ValueError):
            year = None

        publications.append({
            "title": clean_title(bib.get("title", "")),
            "authors": split_authors(bib.get("author", "")),
            "venue": bib.get("venue") or bib.get("citation") or "",
            "year": year,
            "citations": pub.get("num_citations", 0) or 0,
            "url": pub.get("pub_url") or pub.get("author_pub_id") or "",
        })
        time.sleep(delay)

    if not publications:
        log("scholarly returned zero publications; falling back")
        return None

    return publications


def parse_listing_row(row):
    title_tag = row.select_one("a.gsc_a_at")
    if not title_tag:
        return None

    # separator=" " prevents italicized species names (e.g. <i>Escherichia coli</i>)
    # from being glued to adjacent words with no space
    title = clean_title(title_tag.get_text(" ", strip=True))
    href = title_tag.get("href", "")
    url = urljoin(SCHOLAR_BASE, href)

    gray_divs = row.select("div.gs_gray")
    authors_raw = gray_divs[0].get_text(strip=True) if len(gray_divs) > 0 else ""

    venue = ""
    year = None
    if len(gray_divs) > 1:
        venue_div = gray_divs[1]
        oph = venue_div.select_one("span.gs_oph")
        year_text = ""
        if oph:
            year_text = oph.get_text(strip=True).lstrip(", ").strip()
            oph.extract()  # remove so venue text below doesn't include the year
        venue = venue_div.get_text(strip=True)
        if year_text.isdigit():
            year = int(year_text)

    year_col = row.select_one("td.gsc_a_y span")
    if year_col:
        year_text = year_col.get_text(strip=True)
        if year_text.isdigit():
            year = int(year_text)

    if not year:  # Scholar sometimes reports "0" for an unknown year
        year = None

    citation_tag = row.select_one("td.gsc_a_c a.gsc_a_ac")
    citations_text = citation_tag.get_text(strip=True) if citation_tag else ""
    citations = int(citations_text) if citations_text.isdigit() else 0

    return {
        "title": title,
        "authors": split_authors(authors_raw),
        "venue": venue,
        "year": year,
        "citations": citations,
        "url": url,
    }


def fetch_with_requests(user_id, pagesize=100, delay=1.5, max_pages=20):
    """Scrape the public citations page directly. Returns a list of dicts or None."""
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        log("requests/beautifulsoup4 not installed - cannot run fallback scraper")
        return None

    session = requests.Session()
    session.headers.update(HEADERS)

    publications = []
    seen_urls = set()

    for page in range(max_pages):
        cstart = page * pagesize
        params = {
            "user": user_id,
            "hl": "en",
            "cstart": cstart,
            "pagesize": pagesize,
        }
        try:
            resp = session.get(f"{SCHOLAR_BASE}/citations", params=params, timeout=20)
        except Exception as err:
            log(f"network error fetching page (cstart={cstart}): {err}")
            break

        if resp.status_code != 200:
            log(f"Google Scholar returned HTTP {resp.status_code} (possible block); stopping")
            break

        lowered = resp.text.lower()
        if "our systems have detected unusual traffic" in lowered or "recaptcha" in lowered:
            log("Google Scholar returned a CAPTCHA/block page; stopping")
            break

        # Parse resp.content (not resp.text) so lxml can detect the page's
        # own charset instead of relying on requests' header-based guess,
        # which otherwise mangles non-ASCII characters (e.g. curly quotes).
        soup = BeautifulSoup(resp.content, "lxml")
        rows = soup.select("tr.gsc_a_tr")
        if not rows:
            break

        new_count = 0
        for row in rows:
            pub = parse_listing_row(row)
            if pub and pub["url"] not in seen_urls:
                seen_urls.add(pub["url"])
                publications.append(pub)
                new_count += 1

        if new_count == 0:
            break

        show_more = soup.select_one("#gsc_bpf_more")
        if show_more and show_more.has_attr("disabled"):
            break

        time.sleep(delay)

    if not publications:
        log("requests/BeautifulSoup fallback returned zero publications")
        return None

    return publications


def sort_publications(publications):
    return sorted(
        publications,
        key=lambda p: (p["year"] is None, -(p["year"] or 0), p["title"].lower()),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", default=DEFAULT_USER_ID, help="Google Scholar user ID")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to output JSON file")
    parser.add_argument("--delay", type=float, default=1.5, help="Delay (s) between requests")
    args = parser.parse_args()

    output_path = Path(args.output)

    publications = fetch_with_scholarly(args.user_id, delay=args.delay)
    if publications is None:
        publications = fetch_with_requests(args.user_id, delay=args.delay)

    if publications is None:
        log("All fetch methods failed (Google Scholar likely blocked this IP with a CAPTCHA).")
        if output_path.exists():
            log(f"Leaving existing {output_path} untouched.")
        else:
            log(f"No existing {output_path} found; nothing was written.")
        sys.exit(1)

    publications = dedupe_publications(publications)
    publications = sort_publications(publications)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceProfile": f"{SCHOLAR_BASE}/citations?user={args.user_id}&hl=en",
        "userId": args.user_id,
        "count": len(publications),
        "publications": publications,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"Wrote {len(publications)} publications to {output_path}")


if __name__ == "__main__":
    main()
