const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export function createPeerConnection({ onDataChannel, onSignal, onStateChange }) {
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) onSignal({ candidate });
  };
  peer.onconnectionstatechange = () => onStateChange(peer.connectionState);
  peer.ondatachannel = ({ channel }) => onDataChannel(channel);

  return peer;
}

export async function createOffer(peer) {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  return peer.localDescription;
}

export async function createAnswer(peer) {
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  return peer.localDescription;
}
