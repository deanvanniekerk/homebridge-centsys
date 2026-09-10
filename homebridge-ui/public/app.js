(() => {
  const ui = window.homebridge;
  const el = (id) => document.getElementById(id);
  let configs = [],
    index = -1,
    gates = [],
    discovered = [],
    challengeId,
    busy = false,
    identityRevision = 0,
    wifiVerified = false;
  const notify = (message) => {
    el("notice").textContent = message;
  };
  async function task(fn) {
    if (busy) return;
    busy = true;
    document.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
    try {
      await fn();
    } catch {
      notify(
        "The request did not complete. Check sign-in, inputs and connection, then try again.",
      );
    } finally {
      busy = false;
      document.querySelectorAll("button").forEach((b) => {
        b.disabled = false;
      });
    }
  }
  async function request(path, data = {}) {
    try {
      return await ui.request(path, data);
    } catch (error) {
      const messages = {
        authentication: "Sign-in is required. Request a new code.",
        "otp-rejected":
          "That code was rejected or the login attempt expired. Check the code, or request another.",
        "rate-limited":
          "Please wait before trying again. Code requests must be at least one minute apart.",
        busy: "Another gate session is active. Wait for it to finish, then retry verification.",
        "gate-authentication":
          "The controller rejected this candidate address. Check the serial, Wi-Fi MAC and model; no gate command was sent.",
        timeout:
          "Verification timed out. Leave the gate Wi-Fi on, close the official apps and allow reconnection time before trying again.",
        "control-disabled":
          "This Wi-Fi address helper supports D5 Evo SMART+ in South Africa only.",
        "state-unavailable":
          "No usable live status was verified. The candidate address was not applied.",
        configuration:
          "Check the phone number, serial number and selected options.",
        "local-storage":
          "Homebridge could not access its private sign-in storage. Check the volume and file permissions.",
      };
      notify(
        messages[error?.error?.code] ||
          "The service could not complete the request. Please try again later.",
      );
      // Keep the fixed, user-facing error visible without forwarding server payloads.
      return { failed: true };
    }
  }
  async function account() {
    const result = await request("/status");
    if (result.failed) {
      el("account-state").textContent = "Sign-in could not be checked.";
      return;
    }
    el("account-state").textContent =
      result.state === "signed-in"
        ? `Signed in — account ending ${result.accountSuffix}.`
        : result.state === "sign-in-required"
          ? "Sign-in required. Your saved session was rejected."
          : "Not signed in.";
    el("logout").hidden = result.state === "signed-out";
  }
  function option(select, value, label) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    select.append(node);
  }
  function clearDiscovery() {
    discovered = [];
    el("discovered").replaceChildren();
    option(el("discovered"), "", "Choose a discovered gate");
  }
  function saved(selected = "") {
    el("configured").replaceChildren();
    option(el("configured"), "", "Add a gate");
    gates.forEach((g, i) =>
      option(el("configured"), String(i), g.name || "Gate"),
    );
    el("configured").value = selected;
    loadGate();
  }
  function invalidateWifiCheck() {
    identityRevision++;
    if (wifiVerified) {
      el("mac").value = "";
      el("mac-source").textContent =
        "Details changed. Verify the Wi-Fi address again.";
      el("enable-control").checked = false;
      el("trigger-confirmed").checked = false;
    }
    wifiVerified = false;
  }
  function loadGate() {
    invalidateWifiCheck();
    el("wifi-mac").value = "";
    el("wifi-model-confirmed").checked = false;
    const selected = el("configured").value;
    const g = selected === "" ? {} : gates[Number(selected)] || {};
    el("gate-name").value = g.name || "Gate";
    el("serial").value = g.serialNumber || "";
    el("mac").value = g.macAddress || "";
    el("enable-control").checked = g.enableControl === true;
    el("trigger-confirmed").checked = g.triggerModeConfirmed === true;
    el("remove-gate").hidden = selected === "";
    el("gate-state").textContent = "";
    el("discovered").value = "";
    el("mac-source").textContent = g.macAddress
      ? "Saved address for this gate."
      : "";
  }
  async function saveConfig(nextGates) {
    const next = [...configs];
    const block = {
      ...(index < 0 ? {} : configs[index]),
      platform: "Centsys",
      name: "CENTSYS",
      gates: nextGates,
    };
    if (index < 0) next.push(block);
    else next[index] = block;
    await ui.updatePluginConfig(next);
    await ui.savePluginConfig();
    configs = next;
    index = next.indexOf(block);
    gates = nextGates;
  }
  el("configured").addEventListener("change", loadGate);
  el("discovered").addEventListener("change", () => {
    const device = discovered.find(
      (g) => g.serialNumber === el("discovered").value,
    );
    if (!device) return;
    // A new selection must never inherit another gate's identity or control consent.
    const existing = gates.findIndex(
      (g) => g.serialNumber === device.serialNumber,
    );
    el("configured").value = existing < 0 ? "" : String(existing);
    loadGate();
    el("discovered").value = device.serialNumber;
    el("serial").value = device.serialNumber;
    // Preserve an explicitly saved address for the same gate when discovery omits it.
    if (device.macAddress) el("mac").value = device.macAddress;
    el("mac-source").textContent = device.macAddress
      ? "Protocol MAC supplied by account discovery."
      : el("mac").value
        ? "Discovery omitted the MAC; using this gate's saved address."
        : "Discovery did not supply a protocol MAC. See manual setup help below.";
    if (!el("mac").value) el("manual-help").open = true;
    el("gate-state").textContent = "";
  });
  el("serial").addEventListener("input", () => {
    invalidateWifiCheck();
    el("gate-state").textContent = "";
    el("discovered").value = "";
    el("mac").value = "";
    el("mac-source").textContent =
      "Serial changed. Enter the address for this gate.";
    el("enable-control").checked = false;
    el("trigger-confirmed").checked = false;
  });
  el("mac").addEventListener("input", () => {
    identityRevision++;
    wifiVerified = false;
    el("mac-source").textContent =
      "Manually entered address; cloud status does not validate it.";
  });
  el("wifi-mac").addEventListener("input", invalidateWifiCheck);
  el("wifi-model-confirmed").addEventListener("change", invalidateWifiCheck);
  el("verify-wifi").addEventListener(
    "click",
    () =>
      void task(async () => {
        const serialNumber = el("serial").value.trim().toUpperCase();
        const wifiMacAddress = el("wifi-mac").value.trim().toUpperCase();
        if (
          !el("wifi-model-confirmed").checked ||
          !/^[0-9A-F]{24}$/.test(serialNumber) ||
          !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(wifiMacAddress)
        ) {
          notify(
            "Enter the full controller serial and Wi-Fi MAC from Pro, and confirm D5 Evo SMART+.",
          );
          return;
        }
        const revision = identityRevision;
        notify(
          "Verifying one candidate address and waiting for live status. This can take up to 30 seconds. No open/close command is sent.",
        );
        const result = await request("/gate/verify-wifi", {
          serialNumber,
          wifiMacAddress,
          model: "d5-evo-smart-plus",
          modelConfirmed: true,
        });
        if (result.failed) return;
        if (
          revision !== identityRevision ||
          serialNumber !== el("serial").value.trim().toUpperCase() ||
          wifiMacAddress !== el("wifi-mac").value.trim().toUpperCase()
        ) {
          notify(
            "The gate details changed during verification. Verify the current details again.",
          );
          return;
        }
        if (
          result.verified !== true ||
          result.serialNumber !== serialNumber ||
          !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(result.macAddress)
        ) {
          notify(
            "No verified address was returned. The address field was left unchanged.",
          );
          return;
        }
        el("mac").value = result.macAddress;
        wifiVerified = true;
        el("enable-control").checked = false;
        el("trigger-confirmed").checked = false;
        el("mac-source").textContent =
          "Candidate verified by controller identity and fresh live status.";
        el("gate-state").textContent =
          `Live state at verification: ${result.state}.`;
        notify(
          "Address verified and filled in. Review the gate and save; open/close control remains off.",
        );
      }),
  );
  el("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void task(async () => {
      challengeId = undefined;
      el("code").value = "";
      el("code-form").hidden = true;
      const result = await request("/auth/send", {
        mobileNumber: el("phone").value.trim(),
        region: el("region").value,
        channel: el("channel").value,
      });
      if (result.failed) return;
      challengeId = result.challengeId;
      el("code-form").hidden = false;
      el("code").focus();
      notify("Code requested. Enter it below when it arrives.");
    });
  });
  el("code-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void task(async () => {
      const code = el("code").value.trim();
      el("code").value = "";
      const result = await request("/auth/verify", { challengeId, code });
      if (result.failed) return;
      challengeId = undefined;
      clearDiscovery();
      el("phone").value = "";
      el("code-form").hidden = true;
      await account();
      notify(
        "Signed in. Choose your gate below, then restart the plugin after saving.",
      );
    });
  });
  el("logout").addEventListener(
    "click",
    () =>
      void task(async () => {
        const result = await request("/auth/logout");
        if (result.failed) return;
        challengeId = undefined;
        clearDiscovery();
        el("code").value = "";
        el("phone").value = "";
        el("code-form").hidden = true;
        await account();
        notify("Signed out of this Homebridge. The official app is unchanged.");
      }),
  );
  el("discover").addEventListener(
    "click",
    () =>
      void task(async () => {
        discovered = [];
        el("discovered").replaceChildren();
        const result = await request("/devices");
        if (result.failed) {
          el("manual-help").open = true;
          return;
        }
        discovered = result;
        option(el("discovered"), "", "Choose a discovered gate");
        result.forEach((g) =>
          option(el("discovered"), g.serialNumber, g.label),
        );
        if (!result.length) el("manual-help").open = true;
        notify(
          result.length
            ? "Select a gate to fill its serial and available protocol MAC, then check its status."
            : "No account gates were returned. Follow the manual setup help below; an empty list does not mean your gate is offline.",
        );
      }),
  );
  el("check-gate").addEventListener(
    "click",
    () =>
      void task(async () => {
        const result = await request("/gate/check", {
          serialNumber: el("serial").value.trim(),
        });
        if (result.failed) return;
        el("gate-state").textContent = result.found
          ? `Cloud-reported state: ${result.state}.`
          : "No overview returned for this serial. Check it against Pro.";
      }),
  );
  el("gate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void task(async () => {
      const serialNumber = el("serial").value.trim().toUpperCase();
      const enableControl = el("enable-control").checked;
      const macAddress = el("mac").value.trim().toUpperCase();
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress)) {
        notify("Live monitoring requires the gate protocol MAC address.");
        return;
      }
      if (enableControl && !el("trigger-confirmed").checked) {
        notify("Control requires confirmation of TRG behaviour.");
        return;
      }
      const checked = await request("/gate/check", { serialNumber });
      if (checked.failed) return;
      if (!checked.found) {
        notify(
          "No status was returned. Check the serial and sign-in before adding this gate.",
        );
        return;
      }
      const selected = el("configured").value;
      if (
        gates.some(
          (g, i) => g.serialNumber === serialNumber && String(i) !== selected,
        )
      ) {
        notify("This gate is already saved. Select it from Saved gates.");
        return;
      }
      if (selected === "" && gates.length >= 10) {
        notify("This version supports up to ten gates.");
        return;
      }
      const gate = {
        name: el("gate-name").value.trim(),
        serialNumber,
        enableControl,
        ...(macAddress ? { macAddress } : {}),
        ...(enableControl
          ? { controlProfile: "d5-evo-smart-plus", triggerModeConfirmed: true }
          : {}),
      };
      const next = [...gates];
      const target = selected === "" ? next.length : Number(selected);
      next[target] = gate;
      await saveConfig(next);
      saved(String(target));
      notify("Gate saved. Restart the plugin or Homebridge to apply it.");
    });
  });
  el("remove-gate").addEventListener(
    "click",
    () =>
      void task(async () => {
        const selected = el("configured").value;
        if (selected === "") return;
        await saveConfig(gates.filter((_, i) => String(i) !== selected));
        saved();
        notify(
          "Removed from this plugin configuration. Restart to remove its HomeKit accessory.",
        );
      }),
  );
  void task(async () => {
    configs = await ui.getPluginConfig();
    index = configs.findIndex((c) => c.platform === "Centsys");
    gates =
      index >= 0 && Array.isArray(configs[index].gates)
        ? configs[index].gates
        : [];
    saved(gates.length ? "0" : "");
    await account();
  });
})();
