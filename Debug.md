Local html is working now.

✓ get-models (POST /server/get-models) — 173ms
URL: https://api.asksage.health.mil/server/get-models
Status: 200
Response body (813 chars)
{"data":[{"created":"na","id":"aws-bedrock-claude-35-sonnet-gov","name":"aws-bedrock-claude-35-sonnet-gov","object":"model","owned_by":"organization-owner"},{"created":"na","id":"aws-bedrock-claude-37-sonnet-gov","name":"aws-bedrock-claude-37-sonnet-gov","object":"model","owned_by":"organization-owner"},{"created":"na","id":"aws-bedrock-claude-45-sonnet-gov","name":"aws-bedrock-claude-45-sonnet-gov","object":"model","owned_by":"organization-owner"},{"created":"na","id":"aws-bedrock-nova-lite-gov","name":"aws-bedrock-nova-lite-gov","object":"model","owned_by":"organization-owner"},{"created":"na","id":"aws-bedrock-nova-pro-gov","name":"aws-bedrock-nova-pro-gov","object":"model","owned_by":"organization-owner"},{"created":"na","id":"aws-bedrock-nova-micro-gov","name":"aws-bedrock-nova-micro-… [truncated]
Visible response headers (2) — most are hidden by CORS
content-length: 4751
content-type: application/json
Request shape
POST https://api.asksage.health.mil/server/get-models
Content-Type: application/json
x-access-tokens: <redacted>

{}
✓ query ping (POST /server/query) — 2468ms
URL: https://api.asksage.health.mil/server/query
Status: 200
Response body (640 chars)
{"added_obj":null,"embedding_down":false,"message":"\n\nHello! \ud83d\udc4b I'm Ask Sage, and I'm here and ready to help you!\n\nIs there something I can assist you with today? Whether you need help with:\n- Analysis and insights\n- Writing (essays, articles, code, etc.)\n- Language translation\n- Data interpretation\n- Problem-solving\n- Or anything else\n\nJust let me know what you're working on, and I'll do my best to help!","references":"","response":"OK","status":200,"tool_calls":null,"tool_calls_unified":[],"tool_responses":[],"type":"completion","usage":null,"uuid":"0b0802ed-19ff-40d5-9dfc-b0a296f68931","vectors_down":false}
Visible response headers (2) — most are hidden by CORS
content-length: 640
content-type: application/json
Request shape
POST https://api.asksage.health.mil/server/query
Content-Type: application/json
x-access-tokens: <redacted>

{"message":"ping","model":"google-claude-45-haiku","dataset":"none","temperature":0}
