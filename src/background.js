import {
  CONTEXT_MENU_ID,
  getContextMenuDefinition,
  getUiWindowOptions
} from "./background-logic.js";

let uiWindowId = null;

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
  }
});
