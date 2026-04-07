21:39:15.810
info
[debugLog] installed; capturing console + window errors
21:39:15.810
info
[main] mounting React app
21:39:15.810
info
[main] React mount called
21:39:22.440
info
[Welcome.validate] handler entered
21:39:22.440
info
[Welcome.validate] base="https://api.asksage.health.mil" keyLength=64
21:39:22.440
info
[Welcome.validate] state set: validating=true
21:39:22.440
info
[Welcome.validate] constructing AskSageClient
21:39:22.440
info
[Welcome.validate] calling client.getModels()
21:39:22.525
error
[Welcome.validate] caught error: AskSageError: Network error calling POST https://api.asksage.health.mil/server/get-models: TypeError: Failed to fetch. This is typically a CORS preflight rejection, DNS failure, unreachable host, or browser security policy. The browser does not expose the underlying reason to JavaScript.
AskSageError: Network error calling POST https://api.asksage.health.mil/server/get-models: TypeError: Failed to fetch. This is typically a CORS preflight rejection, DNS failure, unreachable host, or browser security policy. The browser does not expose the underlying reason to JavaScript.
    at O0.post (file:///C:/Users/1527558480.MIL/OneDrive%20-%20militaryhealth/Documents/index.html:73:6924)
    at async O0.getModels (file:///C:/Users/1527558480.MIL/OneDrive%20-%20militaryhealth/Documents/index.html:73:7436)
    at async _ (file:///C:/Users/1527558480.MIL/OneDrive%20-%20militaryhealth/Documents/index.html:86:721)
21:39:22.525
info
[Welcome.validate] handler complete
