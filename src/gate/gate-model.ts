export const LIVE_REFRESH_MS = 20_000;
export const LIVE_EXPIRY_MS = 45_000;

export type GateState =
  | 'unknown'
  | 'open'
  | 'closed'
  | 'partly-open'
  | 'partly-closed'
  | 'opening'
  | 'closing';

export interface Device {
  /** Protocol address from the cloud listing, never derived from a Wi-Fi address. */
  macAddress?: string;
  serialNumber: string;
  productCode: number | null;
  productType: number | null;
  isWifiDevice: boolean | null;
  online: boolean | null;
}

export interface Overview {
  /** Local receipt of independently verified live controller telemetry, never HTTPS receipt. */
  liveVerifiedAt?: number;
  serialNumber: string;
  state: GateState;
  stateCode: number | null;
  powerSupplyCode: number | null;
  closingBeamCode: number | null;
  openingBeamCode: number | null;
  theftAlarmCode: number | null;
}
