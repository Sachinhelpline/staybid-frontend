/* OFFLINE TEST HARNESS — browser-side fakes for the Travel Buddy LIVE preview (test-only; never shipped).
 *
 * Injected by tests/live-ai/travel-buddy-live-preview.mjs before the app's own scripts. It replaces ONLY
 * browser APIs, never StayBid code:
 *   • navigator.mediaDevices.getUserMedia → a fake mic track (no audio is captured; nothing leaves the page);
 *   • RTCPeerConnection → a fake peer whose "oai-events" data channel carries PROVIDER-SHAPED transcript
 *     events (conversation.item.created → conversation.item.input_audio_transcription.completed) that the
 *     ORIGINAL createBrowserMedia transcript gate consumes;
 *   • WebSocket for the fixed test host wss://offline-gateway.invalid → the local preview's in-process gateway
 *     bridge (ws://<preview host>/__og/ws/<gatewaySessionId>), keeping the browser's subprotocols.
 * While the fake mic is open, a clearly labelled panel lets the tester "speak" a phrase.
 */
(function () {
  "use strict";
  if (window.__OG) return;
  var OG = window.__OG = { channels: [], gum: 0, tracksStopped: 0, peers: 0, denyMic: false, liveTrack: null, said: [] };
  var PHRASES = [
    "show me the stays",
    "compare the first two",
    "show me stays under 4000",
    "open the first one",
    "is breakfast included",
    "show the rooms",
    "book the first one and pay",
  ];

  // ── fake microphone ───────────────────────────────────────────────────
  var md = navigator.mediaDevices || {};
  try { Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: md }); } catch (e) { /* keep existing */ }
  md.getUserMedia = function () {
    OG.gum += 1;
    if (OG.denyMic) return Promise.reject(new DOMException("Permission denied (offline harness)", "NotAllowedError"));
    var track = { kind: "audio", readyState: "live", stop: function () { if (track.readyState === "ended") return; track.readyState = "ended"; OG.tracksStopped += 1; if (OG.liveTrack === track) OG.liveTrack = null; render(); } };
    OG.liveTrack = track;
    render();
    return Promise.resolve({ getTracks: function () { return [track]; }, getAudioTracks: function () { return [track]; } });
  };

  // ── fake peer + provider data channel ─────────────────────────────────
  function FakePeer() { OG.peers += 1; this._closed = false; }
  FakePeer.prototype.addTrack = function () {};
  FakePeer.prototype.createDataChannel = function (label) {
    var dc = { label: label, onmessage: null, readyState: "open", close: function () { dc.readyState = "closed"; } };
    OG.channels.push(dc);
    return dc;
  };
  FakePeer.prototype.createOffer = function () { return Promise.resolve({ type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=offline-harness\r\n" }); };
  FakePeer.prototype.setLocalDescription = function () { return Promise.resolve(); };
  FakePeer.prototype.setRemoteDescription = function () { return Promise.resolve(); };
  FakePeer.prototype.close = function () { this._closed = true; };
  window.RTCPeerConnection = FakePeer;

  var seq = 0;
  /** What the provider would send for one finished utterance. Returns false if no live mic channel. */
  OG.speak = function (text) {
    var dc = null;
    for (var i = OG.channels.length - 1; i >= 0; i--) { if (OG.channels[i].readyState === "open" && typeof OG.channels[i].onmessage === "function") { dc = OG.channels[i]; break; } }
    if (!dc || !OG.liveTrack) return false;
    var id = "item_harness_" + (++seq);
    OG.said.push(String(text));
    dc.onmessage({ data: JSON.stringify({ type: "conversation.item.created", item: { id: id } }) });
    dc.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: String(text) }) });
    return true;
  };

  // ── control socket → the preview's in-process gateway bridge ──────────
  var OrigWS = window.WebSocket;
  function HarnessWS(url, protocols) {
    var u = String(url);
    if (u.indexOf("wss://offline-gateway.invalid/") === 0) {
      var m = /\/v1\/live-ai\/sessions\/([^/]+)\/control$/.exec(new URL(u).pathname);
      var target = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/__og/ws/" + (m ? m[1] : "invalid");
      return new OrigWS(target, protocols);
    }
    return protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
  }
  HarnessWS.prototype = OrigWS.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { HarnessWS[k] = OrigWS[k]; });
  window.WebSocket = HarnessWS;

  // ── the labelled "speak" panel (visible only while the fake mic is open) ──
  var panel = null;
  function build() {
    panel = document.createElement("div");
    panel.setAttribute("data-og-harness", "1");
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Offline test harness: simulated speech");
    panel.style.cssText = "position:fixed;top:8px;left:8px;right:8px;max-width:420px;z-index:2147483000;background:#1d1b16;color:#fff;border:2px dashed #f2c650;border-radius:12px;padding:8px 10px;font:12px/1.35 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);display:none";
    var h = document.createElement("div");
    h.textContent = "OFFLINE TEST HARNESS — simulated speech, not real AI. Tap what the guest says:";
    h.style.cssText = "font-weight:700;margin-bottom:6px;color:#f2c650";
    panel.appendChild(h);
    var row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
    PHRASES.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = p; b.setAttribute("data-og-phrase", p);
      b.style.cssText = "min-height:32px;padding:4px 10px;border-radius:999px;border:1px solid #f2c650;background:#2b2820;color:#fff;font:inherit;cursor:pointer";
      b.addEventListener("click", function () { OG.speak(p); });
      row.appendChild(b);
    });
    panel.appendChild(row);
    var f = document.createElement("form");
    f.style.cssText = "display:flex;gap:6px;margin-top:6px";
    var inp = document.createElement("input");
    inp.type = "text"; inp.placeholder = "or type what the guest says…"; inp.setAttribute("aria-label", "Simulated speech text");
    inp.style.cssText = "flex:1;min-height:32px;border-radius:8px;border:1px solid #f2c650;background:#fff;color:#111;padding:0 8px;font:inherit";
    var go = document.createElement("button");
    go.type = "submit"; go.textContent = "Say";
    go.style.cssText = "min-height:32px;padding:0 12px;border-radius:8px;border:0;background:#f2c650;color:#1d1b16;font:inherit;font-weight:700";
    f.appendChild(inp); f.appendChild(go);
    f.addEventListener("submit", function (e) { e.preventDefault(); var t = inp.value.trim(); if (t && OG.speak(t)) inp.value = ""; });
    panel.appendChild(f);
    document.body.appendChild(panel);
  }
  function render() {
    if (!document.body) return;
    if (!panel) build();
    panel.style.display = OG.liveTrack ? "block" : "none";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
