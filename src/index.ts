import type { API } from "homebridge";
import { CentsysPlatform } from "./platform.js";
import { PLUGIN_NAME, PLATFORM_NAME } from "./settings.js";
export default function register(api: API): void {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, CentsysPlatform);
}
