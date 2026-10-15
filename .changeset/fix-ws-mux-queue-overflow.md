---
"cc-viewer": patch
---

Fix WS-mux cold-load queue overflow that left the dialogue blank after refresh: disable perMessageDeflate (its zlib queue inflated `ws.bufferedAmount` and tripped the backpressure gate, queueing pings until the 8MB cap killed the socket), and raise the mux queue safety net from 8MB to 32MB. Includes temporary `[ws.mux.diag]` console probes in the web transport for field verification — they will be removed once the fix is confirmed.
