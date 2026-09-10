import {
  HomebridgePluginUiServer,
  RequestError,
} from "@homebridge/plugin-ui-utils";
import { SetupService } from "./setup.js";
import { storageDirectory } from "./settings.js";
import { CentsysError } from "./errors.js";

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const root = this.homebridgeStoragePath;
    const service = root
      ? new SetupService({ directory: storageDirectory(root) })
      : undefined;
    const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
      "/status": () => service!.status(),
      "/auth/send": (data) => service!.sendCode(data),
      "/auth/verify": (data) => service!.verifyCode(data),
      "/auth/logout": () => service!.logout(),
      "/devices": () => service!.devices(),
      "/gate/check": (data) => service!.checkGate(data),
      "/gate/verify-wifi": (data) => service!.verifyWifiAddress(data),
    };
    for (const [path, handler] of Object.entries(handlers))
      this.onRequest(path, async (input) => {
        try {
          if (!service) throw new CentsysError("configuration");
          return (await handler(input)) as Record<string, unknown>;
        } catch (error) {
          const safe =
            error instanceof CentsysError
              ? error
              : new CentsysError("local-storage");
          throw new RequestError(safe.message, { code: safe.code });
        }
      });
    this.ready();
  }
}
new UiServer();
