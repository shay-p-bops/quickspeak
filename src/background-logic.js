export const CONTEXT_MENU_ID = "quickspeak";

export function getContextMenuDefinition() {
  return {
    id: CONTEXT_MENU_ID,
    title: "quickspeak",
    contexts: ["all"]
  };
}

export function getUiWindowOptions(url) {
  return {
    url,
    type: "popup",
    width: 560,
    height: 720,
    focused: true
  };
}
