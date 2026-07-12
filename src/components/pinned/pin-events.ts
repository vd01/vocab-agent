'use client';

const PIN_CHANGE_EVENT = 'pin-change';

export function notifyPinChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PIN_CHANGE_EVENT));
  }
}

export function usePinChangeListener(callback: () => void) {
  if (typeof window === 'undefined') return;
  window.addEventListener(PIN_CHANGE_EVENT, callback);
  return () => window.removeEventListener(PIN_CHANGE_EVENT, callback);
}
