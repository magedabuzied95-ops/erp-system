// WHEP client — the browser end of the media path.
//
// WHEP is "WebRTC-HTTP Egress Protocol": POST an SDP offer, get an SDP answer.
// That is the entire handshake, which is why there is no library here.
//
// WHERE THE TICKET GOES, AND WHY IT MATTERS
// -----------------------------------------
// The ticket travels in an `Authorization: Bearer` header, NOT in the query
// string. A URL is the single leakiest place to put a credential: it lands in
// browser history, in the address bar during a screen share, in `Referer`
// headers, in any reverse-proxy access log, and in every screenshot the user
// ever takes of the camera wall. The header appears in none of those.
//
// MediaMTX forwards it to our /media/auth route as the `token` field, which
// verifies the signature AND re-derives the path the ticket authorises, so a
// valid ticket for one camera cannot open another.

const ICE_GATHER_TIMEOUT_MS = 1500;

/**
 * Wait for ICE gathering, but not forever.
 *
 * On a LAN with no STUN server, `icegatheringstatechange` may never reach
 * "complete". The timeout is not a workaround — host candidates are already
 * gathered by then, and on a shop LAN those are the ones that work. Without it
 * a tile hangs on a black frame with no error to show for it.
 */
const gatherIce = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", onChange);
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    return undefined;
  });

/**
 * Attach a WHEP stream to a <video> element.
 *
 * @returns {{ close: () => void }} always call close() — see below.
 */
export const playWhep = async ({ whepUrl, ticket, videoElement, onState }) => {
  const pc = new RTCPeerConnection({ iceServers: [] });
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    // Order matters: detach the sink first, or Chrome keeps decoding into a
    // detached element for a while and the tile appears to still be live.
    if (videoElement) videoElement.srcObject = null;
    try { pc.close(); } catch { /* already gone */ }
  };

  try {
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (event) => {
      if (videoElement && event.streams[0]) videoElement.srcObject = event.streams[0];
    };
    pc.addEventListener("connectionstatechange", () => {
      onState?.(pc.connectionState);
      // A failed connection holds an encoder open on the host for nothing.
      if (pc.connectionState === "failed") close();
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gatherIce(pc);

    const response = await fetch(whepUrl, {
      method: "POST",
      headers: {
        "content-type": "application/sdp",
        // The ticket. Header, never query string.
        ...(ticket ? { authorization: `Bearer ${ticket}` } : {}),
      },
      body: pc.localDescription.sdp,
    });

    if (!response.ok) {
      close();
      // 401 here means the ticket was rejected — expired, or minted for a
      // different stream. Both are "reopen the stream", not "retry this URL".
      const error = new Error(response.status === 401 ? "ticket-rejected" : `whep-${response.status}`);
      error.status = response.status;
      throw error;
    }

    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    return { close };
  } catch (error) {
    close();
    throw error;
  }
};

/**
 * What the tile should say when there is no picture.
 *
 * Mapped to i18n keys rather than sentences so the Arabic build says something
 * specific too. "Something went wrong" in either language tells an operator
 * nothing about whether to wait, reopen, or call somebody.
 */
export const streamErrorKey = (error) => {
  if (!error) return null;
  if (error.message === "ticket-rejected") return "surveillance.live.errorTicket";
  if (error.status === 503) return "surveillance.live.errorCapacity";
  if (error.status === 429) return "surveillance.live.errorRateLimited";
  if (error.status === 403) return "surveillance.live.errorForbidden";
  return "surveillance.live.errorGeneric";
};
