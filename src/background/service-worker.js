import { MotionEngine } from "./motion-engine.js";
import { Message } from "../shared/messages.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings.js";

const engine = new MotionEngine();
let state = {
  enabled: false,
  status: "idle",
  source: null,
  error: null,
  level: 0
};
let settings = normalizeSettings(DEFAULT_SETTINGS);
let creatingOffscreen = null;
let moving = false;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get("settings");
  if (!stored.settings) await chrome.storage.local.set({ settings });
  await setBadge(false);
});

chrome.runtime.onStartup.addListener(() => setBadge(false));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: readableError(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case Message.GET_STATE: {
      const stored = await chrome.storage.local.get("settings");
      settings = normalizeSettings(stored.settings ?? settings);
      return { ok: true, state, settings };
    }

    case Message.SAVE_SETTINGS:
      settings = normalizeSettings(message.settings);
      engine.updateSettings(settings);
      await chrome.storage.local.set({ settings });
      return { ok: true, settings };

    case Message.START_CAPTURE:
      return start(message);

    case Message.CAPTURE_STARTED:
      state = { enabled: true, status: "running", source: message.source, error: null, level: 0 };
      await setBadge(true);
      return { ok: true };

    case Message.CAPTURE_ERROR:
      await stop({ restore: true, error: message.error });
      return { ok: false, error: message.error };

    case Message.AUDIO_FRAME:
      await moveWindow(message.frame);
      return { ok: true };

    case Message.AUDIO_STOPPED:
      await stop({ restore: true, error: null });
      return { ok: true };

    case Message.STOP:
      await stop({ restore: true, notifyOffscreen: true });
      return { ok: true, state };

    default:
      return { ok: false, error: "알 수 없는 메시지입니다." };
  }
}

async function start(message) {
  await stop({ restore: true, notifyOffscreen: true });
  settings = normalizeSettings(message.settings ?? settings);
  await chrome.storage.local.set({ settings });

  let browserWindow = await chrome.windows.get(message.windowId);
  if (browserWindow.state !== "normal") {
    await chrome.windows.update(browserWindow.id, { state: "normal" });
    browserWindow = await chrome.windows.get(browserWindow.id);
  }

  engine.start(browserWindow, settings);
  state = { enabled: true, status: "starting", source: message.source, error: null, level: 0 };
  await ensureOffscreenDocument();

  const result = await sendToOffscreen({
    target: "offscreen",
    type: Message.START_CAPTURE,
    streamId: message.streamId,
    source: message.source,
    sensitivity: settings.sensitivity,
    playThrough: message.source === "tab"
  });

  if (!result?.ok) {
    const error = result?.error || "오디오 캡처를 시작하지 못했습니다.";
    await stop({ restore: true, error });
    return { ok: false, error };
  }

  return { ok: true, state };
}

// 새로 만든 오프스크린 문서의 리스너가 아직 등록되지 않았을 수 있어 짧게 재시도한다.
async function sendToOffscreen(payload, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch (error) {
      if (attempt === attempts - 1) return { ok: false, error: readableError(error) };
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
}

async function stop({ restore = false, notifyOffscreen = false, error = null } = {}) {
  if (notifyOffscreen) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: Message.STOP }).catch(() => {});
  }

  const restoreOperation = restore && settings.restoreOnStop ? engine.getRestoreOperation() : null;
  engine.reset();

  if (restoreOperation) {
    const { windowId, ...bounds } = restoreOperation;
    await chrome.windows.update(windowId, bounds).catch(() => {});
  }

  state = {
    enabled: false,
    status: error ? "error" : "idle",
    source: null,
    error: error || null,
    level: 0
  };
  await setBadge(false);
}

async function moveWindow(frame) {
  if (!state.enabled || moving) return;
  state.level = Math.max(Number(frame?.energy) || 0, Number(frame?.bass) || 0);
  const operation = engine.step(frame);
  if (!operation) return;

  moving = true;
  const { windowId, ...position } = operation;
  try {
    await chrome.windows.update(windowId, position);
  } catch (error) {
    await stop({ restore: false, error: readableError(error) });
  } finally {
    moving = false;
  }
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL("src/offscreen/offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "사용자가 공유한 오디오의 음량과 박자를 분석합니다."
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
}

async function setBadge(running) {
  await chrome.action.setBadgeBackgroundColor({ color: running ? "#ff2d7a" : "#4a4b61" });
  await chrome.action.setBadgeText({ text: running ? "ON" : "" });
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}
