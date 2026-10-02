/* Leaving the app for WhatsApp (cash-at-stores FR-026). A navigation, not
   a pop-up: the link is known only after the receipt is fetched, and a
   phone's browser blocks a window opened after an await. One function so
   the component tests can see where the app went without leaving. */
export function openExternal(url: string): void {
  window.location.assign(url);
}
