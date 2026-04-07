21:03:33.124
info
[debugLog] installed; capturing console + window errors
21:03:33.124
info
[main] mounting React app
21:03:33.126
info
[main] React mount called
21:03:38.931
info
[Welcome.validate] handler entered
21:03:38.931
info
[Welcome.validate] base="https://api.asksage.health.mil" keyLength=64
21:03:38.931
info
[Welcome.validate] state set: validating=true
21:03:38.931
info
[Welcome.validate] constructing AskSageClient
21:03:38.931
info
[Welcome.validate] calling client.getModels()
21:05:53.819
error
[Welcome.validate] caught error: AskSageError: Network error calling POST https://api.asksage.health.mil/server/get-models: TypeError: Failed to fetch. This is typically a CORS preflight rejection, DNS failure, unreachable host, or browser security policy. The browser does not expose the underlying reason to JavaScript.
AskSageError: Network error calling POST https://api.asksage.health.mil/server/get-models: TypeError: Failed to fetch. This is typically a CORS preflight rejection, DNS failure, unreachable host, or browser security policy. The browser does not expose the underlying reason to JavaScript.
    at Ih.post (https://tingtung93.github.io/ASKSageDocumentWriter/:73:3287)
    at async Ih.getModels (https://tingtung93.github.io/ASKSageDocumentWriter/:73:3799)
    at async w (https://tingtung93.github.io/ASKSageDocumentWriter/:86:719)
21:05:53.819
info
[Welcome.validate] handler complete
