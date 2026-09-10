(() => {
  const ui = window.homebridge;
  const el = (id) => document.getElementById(id);
  let configs = [],
    index = -1,
    gates = [],
    challengeId,
    busy = false;
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
  function saved(selected = "") {
    el("configured").replaceChildren();
    option(el("configured"), "", "Add a gate");
    gates.forEach((g, i) =>
      option(el("configured"), String(i), g.name || "Gate"),
    );
    el("configured").value = selected;
    loadGate();
  }
  function loadGate() {
    const selected = el("configured").value;
    const g = selected === "" ? {} : gates[Number(selected)] || {};
    el("gate-name").value = g.name || "Gate";
    el("serial").value = g.serialNumber || "";
    el("mac").value = g.macAddress || "";
    el("enable-control").checked = g.enableControl === true;
    el("trigger-confirmed").checked = g.triggerModeConfirmed === true;
    el("remove-gate").hidden = selected === "";
    el("gate-state").textContent = "";
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
    if (el("discovered").value) el("serial").value = el("discovered").value;
    el("gate-state").textContent = "";
  });
  el("serial").addEventListener("input", () => {
    el("gate-state").textContent = "";
  });
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
        const result = await request("/devices");
        if (result.failed) return;
        el("discovered").replaceChildren();
        option(el("discovered"), "", "Choose a discovered gate");
        result.forEach((g) =>
          option(el("discovered"), g.serialNumber, g.label),
        );
        notify(
          result.length
            ? "Select a gate, check its status and save."
            : "No account gates were returned. You can enter your controller serial manually.",
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
      if (
        enableControl &&
        (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress) ||
          !el("trigger-confirmed").checked)
      ) {
        notify(
          "Control requires the protocol MAC address and confirmation of TRG behaviour.",
        );
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
