import { create } from 'zustand';
import type { Alert } from '../types/domainTypes.js';

interface AlertStoreState {
  alerts: Map<string, Alert>;
  setAlerts: (alerts: Alert[]) => void;
  acknowledge: (alertId: string) => void;
}

export const useAlertStore = create<AlertStoreState>((set) => ({
  alerts: new Map(),
  setAlerts: (alerts) => set(() => {
    const map = new Map<string, Alert>();
    for (const alert of alerts) {
      map.set(alert.id, alert);
    }
    return { alerts: map };
  }),
  acknowledge: (alertId) => set((s) => {
    const alerts = new Map(s.alerts);
    const alert = alerts.get(alertId);
    if (alert) {
      alerts.set(alertId, { ...alert, acknowledgedAt: new Date().toISOString() });
    }
    return { alerts };
  }),
}));

export function getAlertsBySession(alerts: Map<string, Alert>, sessionId: string): Alert[] {
  return [...alerts.values()].filter((a) => a.sessionId === sessionId && !a.acknowledgedAt);
}

export function getActiveAlerts(alerts: Map<string, Alert>): Alert[] {
  return [...alerts.values()].filter((a) => !a.acknowledgedAt);
}

export function getAlertCount(alerts: Map<string, Alert>): number {
  let count = 0;
  for (const a of alerts.values()) {
    if (!a.acknowledgedAt) count++;
  }
  return count;
}
