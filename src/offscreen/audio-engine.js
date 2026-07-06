import { BeatDetector } from "./beat-detector.js";
import { Message } from "../shared/messages.js";

let session = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "offscreen") return;

  if (message.type === Message.START_CAPTURE) {
    startCapture(message).catch((error) => {
      chrome.runtime.sendMessage({
        type: Message.CAPTURE_ERROR,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  if (message.type === Message.STOP) stopCapture("사용자가 중지했습니다.");
});

async function startCapture({ streamId, source = "desktop", sensitivity = 55, playThrough = false }) {
  await stopCapture();

  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: source,
        chromeMediaSourceId: streamId
      }
    },
    video: source === "desktop" ? {
      mandatory: {
        chromeMediaSource: source,
        chromeMediaSourceId: streamId,
        maxFrameRate: 1,
        maxWidth: 320,
        maxHeight: 240
      }
    } : false
  });

  const audioTracks = mediaStream.getAudioTracks();
  if (audioTracks.length === 0) {
    mediaStream.getTracks().forEach((track) => track.stop());
    throw new Error("오디오가 공유되지 않았습니다. ‘오디오 공유’를 체크해 주세요.");
  }

  const audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.resume();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.48;

  const sourceNode = audioContext.createMediaStreamSource(mediaStream);
  const outputGain = audioContext.createGain();
  outputGain.gain.value = playThrough ? 1 : 0;

  sourceNode.connect(analyser);
  analyser.connect(outputGain);
  outputGain.connect(audioContext.destination);

  const detector = new BeatDetector({
    sampleRate: audioContext.sampleRate,
    fftSize: analyser.fftSize
  });
  const timeData = new Uint8Array(analyser.fftSize);
  const frequencyData = new Uint8Array(analyser.frequencyBinCount);

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(frequencyData);
    const frame = detector.analyse(timeData, frequencyData, performance.now(), sensitivity);
    chrome.runtime.sendMessage({ type: Message.AUDIO_FRAME, frame }).catch(() => {});
  }, 34);

  const onEnded = () => stopCapture("오디오 공유가 종료되었습니다.");
  audioTracks[0].addEventListener("ended", onEnded, { once: true });

  session = { mediaStream, audioContext, timer, onEnded, outputGain };
  await chrome.runtime.sendMessage({
    type: Message.CAPTURE_STARTED,
    source,
    audioContextState: audioContext.state,
    audioTrackState: audioTracks[0].readyState
  });
}

async function stopCapture(reason) {
  if (!session) return;
  clearInterval(session.timer);
  session.mediaStream.getTracks().forEach((track) => track.stop());
  await session.audioContext.close().catch(() => {});
  session = null;

  if (reason) {
    await chrome.runtime.sendMessage({ type: Message.AUDIO_STOPPED, reason }).catch(() => {});
  }
}
