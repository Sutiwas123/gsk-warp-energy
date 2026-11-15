# GSK Three Rockets v7 (realtime)

LED page: `/mc-cinizax0a8.html` · Phone page: `/` (same as `/mobile.html`)

v7 adds a realtime link so phones and the LED connect across devices
(Cloudflare Worker + Durable Object WebSocket at `/ws`).

Deploy: `npx wrangler deploy` in this folder, or connect this repo/branch in
Cloudflare → Workers & Pages → Create → Import a repository.
