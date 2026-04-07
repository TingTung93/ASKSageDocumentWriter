Base URL:
https://api.asksage.health.mil/
Auth header mode for probes below:

x-access-tokens: <access_token> (recommended)
Step 1 — exchange API key for access token
Exchange API key → access token
Step 2 — probes (uses the auth header mode selected above)
/server/get-models
/user/get-all-files-ingested
/user/get-datasets
/server/query (tiny "ping")
/server/openai/v1/chat/completions (tiny)
Run all probes
Results
✔ openai
{
  "url": "https://api.asksage.health.mil/server/openai/v1/chat/completions",
  "ms": 82,
  "network_error": {
    "name": "TypeError",
    "message": "Failed to fetch"
  },
  "status": null,
  "visible_response_headers": {},
  "body_text_excerpt": null,
  "body_parsed": null
}
▶ openai (running…)
✔ query
{
  "url": "https://api.asksage.health.mil/server/query",
  "ms": 82,
  "network_error": {
    "name": "TypeError",
    "message": "Failed to fetch"
  },
  "status": null,
  "visible_response_headers": {},
  "body_text_excerpt": null,
  "body_parsed": null
}
▶ query (running…)
✔ datasets
{
  "url": "https://api.asksage.health.mil/user/get-datasets",
  "ms": 87,
  "network_error": {
    "name": "TypeError",
    "message": "Failed to fetch"
  },
  "status": null,
  "visible_response_headers": {},
  "body_text_excerpt": null,
  "body_parsed": null
}
▶ datasets (running…)
✔ files
{
  "url": "https://api.asksage.health.mil/user/get-all-files-ingested",
  "ms": 85,
  "network_error": {
    "name": "TypeError",
    "message": "Failed to fetch"
  },
  "status": null,
  "visible_response_headers": {},
  "body_text_excerpt": null,
  "body_parsed": null
}
▶ files (running…)
✔ models
{
  "url": "https://api.asksage.health.mil/server/get-models",
  "ms": 89,
  "network_error": {
    "name": "TypeError",
    "message": "Failed to fetch"
  },
  "status": null,
  "visible_response_headers": {},
  "body_text_excerpt": null,
  "body_parsed": null
}
▶ models (running…)
info
access_token captured into the token field. Now run the probes.
✔ exchange
{
  "url": "https://api.asksage.health.mil/user/get-token-with-api-key",
  "ms": 457,
  "network_error": null,
  "status": 200,
  "visible_response_headers": {
    "content-length": "370",
    "content-type": "application/json"
  },
  "body_text_excerpt": "{\"response\":{\"access_token\":\"eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4OTEsInVzZXJfdHlwZSI6InVzZXIiLCJwYWlkIjp0cnVlLCJuZXdfcGFzc3dvcmRfcmVxdWlyZWQiOmZhbHNlLCJtZmFfcmVxdWlyZWQiOmZhbHNlLCJtZmFfYXV0aCI6ZmFsc2UsImNhY19hdXRoIjpmYWxzZSwiZXhwIjoxNzc1Njg1MzEzfQ.3h0kxt78e4VrCFer4zWRbA75KNgRYbvW8WYjWl7Ktu5PlVMH3HTFgIC3mIoUVbI9opohnUGx0cuNR9awiBXXUw\"},\"status\":\"200\"}\n",
  "body_parsed": {
    "response": {
      "access_token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4OTEsInVzZXJfdHlwZSI6InVzZXIiLCJwYWlkIjp0cnVlLCJuZXdfcGFzc3dvcmRfcmVxdWlyZWQiOmZhbHNlLCJtZmFfcmVxdWlyZWQiOmZhbHNlLCJtZmFfYXV0aCI6ZmFsc2UsImNhY19hdXRoIjpmYWxzZSwiZXhwIjoxNzc1Njg1MzEzfQ.3h0kxt78e4VrCFer4zWRbA75KNgRYbvW8WYjWl7Ktu5PlVMH3HTFgIC3mIoUVbI9opohnUGx0cuNR9awiBXXUw"
    },
    "status": "200"
  }
}
▶ exchange (running…)
warn
no access_token field found in response — inspect body_parsed above to see the actual shape.
✔ exchange
{
  "url": "https://api.asksage.ai/user/get-token-with-api-key",
  "ms": 703,
  "network_error": {
    "name": "TypeError",
    "message": "Failed to fetch"
  },
  "status": null,
  "visible_response_headers": {},
  "body_text_excerpt": null,
  "body_parsed": null
}
