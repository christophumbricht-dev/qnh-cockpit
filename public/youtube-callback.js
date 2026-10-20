// Google sends Christoph back here after «YouTube-Kanal verbinden» (?code=…&state=… or ?error=…).
// The answer goes to sessionStorage and the cockpit finishes the connection (state check, op youtube-connect).
// A separate page so the code never meets the cockpit's own sign-in handling of URL parameters.
try { sessionStorage.setItem("qnh-yt-result", location.search); } catch (e) { /* private mode: the cockpit says it did not work */ }
location.replace("./#social");
