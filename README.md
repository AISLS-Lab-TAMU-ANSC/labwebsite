# Flex Living – Reviews Dashboard (Mocked Hostaway)

## Quick start

1. Node 18+ recommended. Install deps:
```
npm install
```
2. Start server:
```
npm run start
```
3. Open the dashboard:
```
http://localhost:3000/dashboard.html
```
4. Open a property page (approved reviews only):
```
http://localhost:3000/property.html?listingId=2b-n1-a-29-shoreditch-heights
```

Environment variables (optional):
```
HOSTAWAY_ACCOUNT_ID=61148
HOSTAWAY_API_KEY=f94377ebbbb479490bb3ec364649168dc443dda2e4830facaf5de2e74ccc9152
GOOGLE_PLACES_API_KEY=your_key
USE_MOCK=true
```

If `USE_MOCK=true`, backend serves data from `data/mock-hostaway-reviews.json` and persists approvals to `data/approvals.json`.

## API

- GET `/api/reviews/hostaway`
  - Query: `useMock` (bool), `listingId`, `channel`, `type`, `approvedOnly`, `minRating`, `startDate`, `endDate`
  - Response: `{ status, count, totals, result: Review[] }`
  - Normalized review shape:
    ```json
    {
      "id": "string",
      "source": "hostaway|google",
      "type": "guest-to-host|host-to-guest",
      "status": "published",
      "listingId": "string",
      "listingName": "string",
      "reviewerName": "string|null",
      "submittedAt": "ISO",
      "ratingOverall": 4.5,
      "ratingScale": 5,
      "categoryRatings": { "cleanliness": 4.5 },
      "textPublic": "",
      "channel": "airbnb|booking.com|vrbo|direct|google",
      "approved": true
    }
    ```

- GET `/api/reviews/approvals`
- POST `/api/reviews/approvals` `{ reviewId, approved, listingId? }`
- PATCH `/api/reviews/:id/approve` `{ approved }`
- GET `/api/reviews/google?placeId=...` (requires `GOOGLE_PLACES_API_KEY`)

## UX notes

- Dashboard provides filters by listing, channel, type, rating threshold, and date range.
- Approve/unapprove toggles persist immediately. Property page shows only approved reviews.

## Design decisions

- Normalization converts Hostaway 10-point subscores to 5-point scale. If overall rating is present (>5 assumed 10-pt), it is converted to 5-pt.
- Each review is addressable by stable `id`. Approvals stored in JSON file for simplicity.
- Fallback to mock data if sandbox API is empty or errors.

## Google Reviews findings

- Places Details API returns at most a limited set of recent reviews, subject to policy and availability.
- Endpoint implemented as a basic exploration. Production requires per-listing `place_id` mapping and caching.


