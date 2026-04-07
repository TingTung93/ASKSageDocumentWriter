Connection failed.

Network error calling POST https://api.asksage.health.mil/server/get-models: TypeError: Failed to fetch. This is typically a CORS preflight rejection, DNS failure, unreachable host, or browser security policy. The browser does not expose the underlying reason to JavaScript.

Try the diagnostics panel below for full per-probe detail — it surfaces the same info DevTools would show.
Diagnostics
Runs the same probes as probe.html but renders the results inline so you can debug without DevTools. The API key is sent only to the base URL above and is shown as <redacted> in the output below.

Run all probes
✗ get-models (POST /server/get-models) — 83ms
URL: https://api.asksage.health.mil/server/get-models
Status: (no response)
NETWORK ERROR: TypeError: Failed to fetch

The browser refused or could not complete the request. Common causes from a file:// origin against api.asksage.health.mil:
• CORS preflight rejected by the server (no Access-Control-Allow-Origin for this origin)
• Network unreachable (firewall, VPN, proxy)
• DNS resolution failure
• Browser security policy on file://
• Mixed content / certificate issue
Visible response headers (0) — most are hidden by CORS
(none visible to JavaScript)
Request shape
POST https://api.asksage.health.mil/server/get-models
Content-Type: application/json
x-access-tokens: <redacted>

{}
✗ query ping (POST /server/query) — 82ms
URL: https://api.asksage.health.mil/server/query
Status: (no response)
NETWORK ERROR: TypeError: Failed to fetch

The browser refused or could not complete the request. Common causes from a file:// origin against api.asksage.health.mil:
• CORS preflight rejected by the server (no Access-Control-Allow-Origin for this origin)
• Network unreachable (firewall, VPN, proxy)
• DNS resolution failure
• Browser security policy on file://
• Mixed content / certificate issue
Visible response headers (0) — most are hidden by CORS
(none visible to JavaScript)
Request shape
POST https://api.asksage.health.mil/server/query
Content-Type: application/json
x-access-tokens: <redacted>

{"message":"ping","model":"google-claude-45-haiku","dataset":"none","temperature":0}
