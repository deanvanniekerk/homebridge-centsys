import type { Region } from './cloud-protocol.js';

/**
 * CENTSYS runs one backend per regional datacentre; an account and its gates live on one.
 * `Region` selects the datacentre only. It is not a country check: use `za` for any account
 * hosted in South Africa and `au` for Australia and New Zealand.
 */
export interface Datacentre {
  /** HTTPS gateway for OTP, discovery, status and certificates. */
  gateway: string;
  /** MQTT broker IP. Both brokers present CN=CentsysQA from the pinned Centsys CA. */
  mqttHost: string;
  /** Time zone used for controller time sync when the host clock reports UTC. */
  fallbackTimeZone: string;
}

export const datacentres: Readonly<Record<Region, Datacentre>> = {
  za: {
    gateway: 'https://centsys.southafricanorth.cloudapp.azure.com:4445',
    mqttHost: '20.87.192.195',
    fallbackTimeZone: 'Africa/Johannesburg',
  },
  au: {
    gateway: 'https://centsys.australiaeast.cloudapp.azure.com:4445',
    mqttHost: '20.213.185.54',
    fallbackTimeZone: 'Australia/Sydney',
  },
};
