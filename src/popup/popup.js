import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const elements = {
  powerButton: document.querySelector("#powerButton"),
  tabFallback: document.querySelector("#tabFallback"),
  statusBadge: document.querySelector("#statusBadge"),
  statusText: document.querySelector("#statusText"),
  intensityName: document.querySelector("#intensityName"),
  meter: [...document.querySelectorAll(".meter span")],
  intensity: document.querySelector("#intensity"),
  sensitivity: document.querySelector("#sensitivity"),
  beatBoost: document.querySelector("#beatBoost"),
  driftEnabled: document.querySelector("#driftEnabled"),
  restoreOnStop: document.querySelector("#restoreOnStop")
};

let state = { enabled: false, status: "idle", level: 0, error: null };
let saveTimer;

await refresh();
setInterval(refresh, 450);

elements.powerButton.addEventListener("click", async () => {
  if (state.enabled) {
    setBusy("춤을 멈추는 중…");
    await send({ type: Message.STOP });
    await refresh();
    return;
  }

  setBusy("공유할 화면과 오디오를 선택하세요…");
  const browserWindow = await chrome.windows.getCurrent();
  await send({
    type: Message.SAVE_SETTINGS,
    settings: readSettings()
  });
  await chrome.windows.create({
    url: chrome.runtime.getURL(`src/capture/capture.html?windowId=${browserWindow.id}`),
    type: "popup",
    width: 440,
    height: 300,
    focused: true
  });
  window.close();
});

elements.tabFallback.addEventListener("click", async () => {
  setBusy("현재 탭의 사운드에 연결 중…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const response = await send({
      type: Message.START_CAPTURE,
      streamId,
      source: "tab",
      windowId: tab.windowId,
      settings: readSettings()
    });
    showResponse(response);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
  await refresh();
});

for (const input of document.querySelectorAll("input")) {
  input.addEventListener("input", () => {
    syncLabels();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send({
      type: Message.SAVE_SETTINGS,
      settings: readSettings()
    }), 120);
  });
}

async function refresh() {
  const response = await send({ type: Message.GET_STATE });
  if (!response?.ok) return;
  state = response.state;
  if (!document.activeElement?.matches("input")) writeSettings(response.settings);
  renderState();
}

function renderState() {
  const running = state.enabled && ["starting", "running"].includes(state.status);
  elements.powerButton.classList.toggle("running", running);
  elements.powerButton.querySelector("strong").textContent = running ? "STOP" : "START";
  elements.powerButton.querySelector("small").textContent = running
    ? state.source === "tab" ? "현재 탭 사운드" : "모든 탭 사운드"
    : "모든 탭 사운드";
  elements.statusBadge.dataset.state = running ? "running" : "idle";
  elements.statusBadge.querySelector("b").textContent = running ? "LIVE" : "OFF";
  elements.tabFallback.hidden = running;

  if (state.error) {
    showError(state.error);
  } else if (state.status === "running") {
    elements.statusText.classList.remove("error");
    elements.statusText.textContent = "박자 감지 중 — 창이 춤추고 있어요.";
  } else if (state.status === "starting" || state.status === "selecting") {
    setBusy("오디오에 연결 중…");
  } else {
    elements.statusText.classList.remove("error");
    elements.statusText.textContent = "준비 완료 — 음악을 틀어주세요.";
  }

  const activeBars = Math.round((state.level || 0) * elements.meter.length);
  elements.meter.forEach((bar, index) => {
    bar.classList.toggle("active", index < activeBars);
    bar.style.height = `${5 + Math.min(index, activeBars) * 1.4}px`;
  });
}

function readSettings() {
  return normalizeSettings({
    intensity: elements.intensity.value,
    sensitivity: elements.sensitivity.value,
    beatBoost: elements.beatBoost.value,
    driftEnabled: elements.driftEnabled.checked,
    restoreOnStop: elements.restoreOnStop.checked,
    screen: {
      width: window.screen.availWidth,
      height: window.screen.availHeight,
      availLeft: window.screen.availLeft,
      availTop: window.screen.availTop
    }
  });
}

function writeSettings(settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  elements.intensity.value = normalized.intensity;
  elements.sensitivity.value = normalized.sensitivity;
  elements.beatBoost.value = normalized.beatBoost;
  elements.driftEnabled.checked = normalized.driftEnabled;
  elements.restoreOnStop.checked = normalized.restoreOnStop;
  syncLabels();
}

function syncLabels() {
  for (const key of ["intensity", "sensitivity", "beatBoost"]) {
    document.querySelector(`#${key}Value`).textContent = elements[key].value;
  }
  const value = Number(elements.intensity.value);
  elements.intensityName.textContent = value >= 88 ? "OFFSCREEN" : value >= 65 ? "MAYHEM" : value >= 30 ? "BOUNCE" : "TICKLE";
}

function setBusy(text) {
  elements.statusText.classList.remove("error");
  elements.statusText.textContent = text;
}

function showResponse(response) {
  if (response?.ok || response?.cancelled) return;
  showError(response?.error || "시작하지 못했습니다.");
}

function showError(message) {
  elements.statusText.classList.add("error");
  elements.statusText.textContent = message;
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
