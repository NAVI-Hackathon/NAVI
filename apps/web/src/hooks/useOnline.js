import { useSyncExternalStore } from 'react';

// The browser's own connection state. "online" only means a network is there, not that NAVI answers;
// failed requests still say what went wrong.
const subscribe = notify => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify); };
};

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
