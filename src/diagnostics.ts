import type { Device, Overview } from "./protocol.js";

/** Explicit allowlist: never forwards serials, MACs, names, account data or raw JSON. */
export function diagnosticReport(
  devices: readonly Device[],
  overviews: readonly Overview[],
  receivedAt: Date,
) {
  const bySerial = new Map(overviews.map((row) => [row.serialNumber, row]));
  return {
    schemaVersion: 1,
    source: "https-cloud-overview",
    receivedAt: receivedAt.toISOString(),
    deviceMeasurementTimeKnown: false,
    note: "Cloud-reported data may be cached. This is not a live MQTT stream or proof of current physical position.",
    devices: devices.map((device, index) => {
      const overview = bySerial.get(device.serialNumber);
      return {
        device: `gate-${index + 1}`,
        productCode: device.productCode,
        productType: device.productType,
        isWifiDevice: device.isWifiDevice,
        onlineAtDiscovery: device.online,
        overviewReceived: overview !== undefined,
        cloudReportedState: overview?.state ?? "unknown",
        stateCode: overview?.stateCode ?? null,
        powerSupplyCode: overview?.powerSupplyCode ?? null,
        closingBeamCode: overview?.closingBeamCode ?? null,
        openingBeamCode: overview?.openingBeamCode ?? null,
        theftAlarmCode: overview?.theftAlarmCode ?? null,
      };
    }),
  };
}
