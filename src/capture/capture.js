import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const messageElement = document.querySelector("#message");
const chooseButton = document.querySelector("#chooseButton");
const targetWindowId = Number(new URLSearchParams(location.search).get("windowId"));

chooseButton.addEventListener("click", chooseAndStart);

if (Number.isInteger(targetWindowId)) {
  chooseAndStart();
} else {
  showError("움직일 Chrome 창을 찾지 못했습니다. 창을 닫고 다시 시도해 주세요.");
}

async function chooseAndStart() {
  chooseButton.disabled = true;
  chooseButton.textContent = "선택 창 여는 중…";
  messageElement.className = "";
  messageElement.innerHTML = "공유 창에서 <b>전체 화면</b>과 <b>오디오 공유</b>를 선택하세요.";

  const selection = await chooseDesktopMedia();
  if (selection.error) {
    showError(selection.error);
    return;
  }
  if (!selection.streamId) {
    showError("선택이 취소되었습니다. 다시 시도할 수 있습니다.");
    return;
  }
  if (!selection.canRequestAudioTrack) {
    showError("오디오가 공유되지 않았습니다. ‘오디오 공유’를 체크해 주세요.");
    return;
  }

  const stored = await chrome.storage.local.get("settings");
  const response = await chrome.runtime.sendMessage({
    type: Message.START_CAPTURE,
    streamId: selection.streamId,
    source: "desktop",
    windowId: targetWindowId,
    settings: normalizeSettings(stored.settings ?? DEFAULT_SETTINGS)
  });

  if (!response?.ok) {
    showError(response?.error || "오디오 연결을 시작하지 못했습니다.");
    return;
  }

  messageElement.className = "success";
  messageElement.textContent = "연결 완료! Chrome 창이 음악에 맞춰 움직입니다.";
  chooseButton.hidden = true;
  setTimeout(() => window.close(), 650);
}

function chooseDesktopMedia() {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(
      ["screen", "tab", "window", "audio"],
      (streamId, options = {}) => {
        const error = chrome.runtime.lastError?.message;
        resolve({
          streamId: streamId || "",
          canRequestAudioTrack: Boolean(options.canRequestAudioTrack),
          error: error || null
        });
      }
    );
  });
}

function showError(message) {
  messageElement.className = "error";
  messageElement.textContent = message;
  chooseButton.disabled = false;
  chooseButton.textContent = "다시 선택";
}
