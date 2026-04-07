Here are the logs from the browser test. For whatever reason, when we tested the API using probe.html it worked.

Run all probes
✗ get-models (POST /server/get-models) — 84ms
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
Request shape
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
Request shape
