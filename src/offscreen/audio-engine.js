import { BeatDetector } from "./beat-detector.js";
import { Message } from "../shared/messages.js";

let session = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  if (message.type === Message.START_CAPTURE) {
    startCapture(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        const readable = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: readable });
      });
    return true;
  }

  if (message.type === Message.STOP) {
    stopCapture("사용자가 중지했습니다.")
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function startCapture({ streamId, source = "desktop", sensitivity = 55, playThrough = false }) {
  await stopCapture();

  const mediaStream = await requestStream(streamId, source);

  const audioTracks = mediaStream.getAudioTracks();
  if (audioTracks.length === 0) {
    mediaStream.getTracks().forEach((track) => track.stop());
    throw new Error("오디오가 공유되지 않았습니다. ‘오디오 공유’를 체크해 주세요.");
  }

  // 비디오 트랙은 데스크톱 오디오 캡처를 위해서만 요청하며, 분석에는 쓰지 않으므로 즉시 정지한다.
  mediaStream.getVideoTracks().forEach((track) => track.stop());

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

async function requestStream(streamId, source) {
  const audio = {
    mandatory: {
      chromeMediaSource: source,
      chromeMediaSourceId: streamId
    }
  };
  // Chrome은 데스크톱 오디오를 얻으려면 비디오 트랙도 함께 요청하도록 요구한다.
  const video = source === "desktop" ? {
    mandatory: {
      chromeMediaSource: source,
      chromeMediaSourceId: streamId,
      maxFrameRate: 1,
      maxWidth: 320,
      maxHeight: 240
    }
  } : false;

  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video });
  } catch (error) {
    throw new Error(describeCaptureFailure(error, source));
  }
}

function describeCaptureFailure(error, source) {
  const name = error?.name || "";
  const raw = error instanceof Error ? error.message : String(error);

  if (source === "desktop" && (name === "NotAllowedError" || name === "NotReadableError" || /permission|denied|not allowed|screen/i.test(raw))) {
    return "화면·오디오 캡처가 거부되었습니다. macOS의 경우 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 Chrome을 허용한 뒤 Chrome을 재시작해 주세요.";
  }
  if (name === "NotFoundError") {
    return "캡처할 소스를 찾지 못했습니다. 다시 선택해 주세요.";
  }
  return raw || "오디오 캡처를 시작하지 못했습니다.";
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
