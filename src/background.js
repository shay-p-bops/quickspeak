import {
  CONTEXT_MENU_ID,
  getContextMenuDefinition,
  getUiWindowOptions
} from "./background-logic.js";
import {
  DEFAULT_LLM_SETTINGS,
  LLM_SETTINGS_STORAGE_KEY,
  normalizeLlmSettings,
  requestLlm
} from "./llm.js";
import { EncryptedSecretStore } from "./secret-store.js";

let uiWindowId = null;
const secretStore = new EncryptedSecretStore();
const activeLlmRequests = new Map();

function formatError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The LLM request was cancelled.";
  }
  return error instanceof Error ? error.message : String(error);
}

function storageCall(method, ...args) {
  return new Promise((resolve, reject) => {
    chrome.storage.local[method](...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function getSavedLlmSettings() {
  const result = await storageCall("get", LLM_SETTINGS_STORAGE_KEY);
  return normalizeLlmSettings(result?.[LLM_SETTINGS_STORAGE_KEY] ?? DEFAULT_LLM_SETTINGS);
}

async function saveLlmSettings(settings) {
  const normalized = normalizeLlmSettings(settings);
  await storageCall("set", { [LLM_SETTINGS_STORAGE_KEY]: normalized });
  return normalized;
}

function abortAllLlmRequests() {
  for (const controller of activeLlmRequests.values()) {
    controller.abort();
  }
  activeLlmRequests.clear();
}

async function handleLlmMessage(message) {
  if (message.type === "llm:get-settings") {
    const settings = await getSavedLlmSettings();
    return {
      settings,
      hasApiKey: await secretStore.has()
    };
  }

  if (message.type === "llm:save-settings") {
    const settings = await saveLlmSettings(message.settings);
    const apiKey = typeof message.apiKey === "string" ? message.apiKey.trim() : "";
    if (apiKey) {
      await secretStore.save(apiKey);
    }
    return {
      settings,
      hasApiKey: await secretStore.has()
    };
  }

  if (message.type === "llm:delete-api-key") {
    await secretStore.clear();
    return { hasApiKey: false };
  }

  if (message.type === "llm:cancel") {
    const controller = activeLlmRequests.get(message.requestId);
    controller?.abort();
    activeLlmRequests.delete(message.requestId);
    return { cancelled: Boolean(controller) };
  }

  if (message.type === "llm:request") {
    const requestId = String(message.requestId ?? "");
    if (!requestId) {
      throw new Error("The LLM request ID is missing.");
    }
    if (activeLlmRequests.has(requestId)) {
      throw new Error("This LLM request is already running.");
    }

    const settings = normalizeLlmSettings(message.settings);
    const controller = new AbortController();
    activeLlmRequests.set(requestId, controller);
    try {
      const text = await secretStore.use((apiKey) => requestLlm({
        vendor: settings.vendor,
        model: settings.model,
        input: message.input,
        apiKey,
        signal: controller.signal
      }));
      return { text };
    } finally {
      activeLlmRequests.delete(requestId);
    }
  }

  throw new Error("Unknown LLM message.");
}

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(getContextMenuDefinition(), () => {
      // Reading lastError prevents an unchecked runtime error in development.
      void chrome.runtime.lastError;
    });
  });
}

async function openQuickspeak() {
  if (uiWindowId !== null) {
    try {
      await chrome.windows.update(uiWindowId, { focused: true });
      return;
    } catch {
      uiWindowId = null;
    }
  }

  const createdWindow = await chrome.windows.create(
    getUiWindowOptions(chrome.runtime.getURL("ui.html"))
  );
  uiWindowId = createdWindow?.id ?? null;
}

chrome.runtime.onInstalled.addListener(createContextMenu);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type?.startsWith("llm:")) {
    return undefined;
  }

  void handleLlmMessage(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: formatError(error) })
  );
  return true;
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    void openQuickspeak();
  }
});

chrome.action.onClicked.addListener(() => {
  void openQuickspeak();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === uiWindowId) {
    uiWindowId = null;
    abortAllLlmRequests();
  }
});

chrome.runtime.onSuspend.addListener(abortAllLlmRequests);
