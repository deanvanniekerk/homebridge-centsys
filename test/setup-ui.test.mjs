import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Execute the shipped wizard event handlers against a small DOM/Homebridge boundary.
async function wizard(rows, verify, initialGates) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        textContent: "",
        checked: false,
        hidden: false,
        open: false,
        children: [],
        handlers: {},
        addEventListener(name, fn) {
          this.handlers[name] = fn;
        },
        append(child) {
          this.children.push(child);
        },
        replaceChildren() {
          this.children = [];
          this.value = "";
        },
        focus() {},
      });
    return elements.get(id);
  };
  const saved = initialGates ?? [
    {
      name: "Existing",
      serialNumber: "00112233445566778899AABB",
      macAddress: "AA:BB:CC:DD:EE:01",
      enableControl: true,
      controlProfile: "d5-evo-smart-plus",
    },
  ];
  const document = {
    getElementById: element,
    createElement: () => ({}),
    querySelectorAll: () => [],
  };
  let config = [
    { platform: "Centsys", name: "CENTSYS", pollInterval: 20, gates: saved },
  ];
  let writes = 0;
  const homebridge = {
    getPluginConfig: async () => config,
    updatePluginConfig: async (next) => {
      config = next;
    },
    savePluginConfig: async () => {
      writes++;
    },
    request: async (path, input) =>
      path === "/status"
        ? { state: "signed-in", accountSuffix: "0000" }
        : path === "/gate/verify-wifi"
          ? verify(input)
          : path === "/gate/check"
            ? { found: true, state: "closed" }
            : rows,
  };
  vm.runInNewContext(await readFile("homebridge-ui/public/app.js", "utf8"), {
    document,
    window: { homebridge },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  await settle();
  const event = async (id, name, value) => {
    if (value !== undefined) element(id).value = value;
    element(id).handlers[name]({ preventDefault() {} });
    await settle();
  };
  return {
    element,
    event,
    get config() {
      return config;
    },
    get writes() {
      return writes;
    },
  };
}

test("wizard autofills discovered MAC and never carries another gate address or saved control setting", async () => {
  const rows = [
    {
      serialNumber: "00112233445566778899AACC",
      label: "With MAC",
      macAddress: "AA:BB:CC:DD:EE:02",
    },
    { serialNumber: "00112233445566778899AADD", label: "Missing MAC" },
  ];
  const { element: e, event } = await wizard(rows);
  await event("discover", "click");
  await event("discovered", "change", rows[0].serialNumber);
  assert.equal(e("serial").value, rows[0].serialNumber);
  assert.equal(e("mac").value, rows[0].macAddress);
  assert.equal(e("configured").value, "");
  assert.equal(e("enable-control").checked, true);
  await event("discovered", "change", rows[1].serialNumber);
  assert.equal(e("mac").value, "");
  assert.equal(e("manual-help").open, true);
  await event("discovered", "change", rows[0].serialNumber);
  await event("serial", "input", "00112233445566778899AAEE");
  assert.equal(e("mac").value, "");
  assert.equal(e("discovered").value, "");
});

test("wizard preserves a saved address only for the same discovered gate", async () => {
  const rows = [{ serialNumber: "00112233445566778899AABB", label: "Saved" }];
  const { element: e, event } = await wizard(rows);
  await event("discover", "click");
  await event("discovered", "change", rows[0].serialNumber);
  assert.equal(e("configured").value, "0");
  assert.equal(e("mac").value, "AA:BB:CC:DD:EE:01");
  assert.match(e("mac-source").textContent, /saved address/);
});

test("empty and failed discovery expose manual help", async () => {
  for (const result of [[], { failed: true }]) {
    const { element: e, event } = await wizard(result);
    await event("discover", "click");
    assert.equal(e("manual-help").open, true);
  }
});

test("Wi-Fi verification preserves the control choice and invalidates changed addresses", async () => {
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { element: e, event } = await wizard([], async (input) => {
    assert.equal(input.model, "d5-evo-smart-plus");
    assert.equal(input.modelConfirmed, true);
    assert.equal(input.target, undefined);
    return pending;
  });
  e("enable-control").checked = false;
  e("wifi-mac").value = "AA:BB:CC:DD:EE:FE";
  e("wifi-model-confirmed").checked = true;
  await event("verify-wifi", "click");
  resolve({
    serialNumber: e("serial").value,
    macAddress: "00:EF:DD:CC:BB:AA",
    verified: true,
    state: "closed",
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(e("mac").value, "00:EF:DD:CC:BB:AA");
  assert.equal(e("enable-control").checked, false);
  await event("wifi-mac", "input", "AA:BB:CC:DD:EE:00");
  assert.equal(e("mac").value, "");
});

test("Wi-Fi helper never applies a failed or stale response", async () => {
  for (const change of [false, true]) {
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const { element: e, event } = await wizard([], () => pending);
    e("wifi-mac").value = "AA:BB:CC:DD:EE:FE";
    e("wifi-model-confirmed").checked = true;
    await event("verify-wifi", "click");
    if (change) await event("serial", "input", "00112233445566778899AACC");
    resolve(
      change
        ? {
            serialNumber: "00112233445566778899AABB",
            macAddress: "00:EF:DD:CC:BB:AA",
            verified: true,
            state: "closed",
          }
        : { failed: true },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(e("mac").value, change ? "" : "AA:BB:CC:DD:EE:01");
  }
});

test("new Wi-Fi setup defaults control on and saves it without a TRG checkbox", async () => {
  const w = await wizard(
    [],
    async (input) => ({
      verified: true,
      serialNumber: input.serialNumber,
      macAddress: "00:EF:DD:CC:BB:AA",
      state: "closed",
    }),
    [],
  );
  const e = w.element;
  assert.equal(e("enable-control").checked, true);
  assert.equal(e("address-mode").value, "wifi");
  assert.equal(e("protocol-entry").hidden, true);
  await w.event("serial", "input", "00112233445566778899AABB");
  await w.event("wifi-mac", "input", "AA:BB:CC:DD:EE:FE");
  e("wifi-model-confirmed").checked = true;
  await w.event("gate-form", "submit");
  assert.equal(w.writes, 0);
  assert.match(e("notice").textContent, /Verify/);
  await w.event("verify-wifi", "click");
  assert.equal(e("enable-control").checked, true);
  await w.event("gate-form", "submit");
  assert.equal(w.writes, 1);
  assert.equal(w.config[0].gates[0].enableControl, true);
  assert.equal(w.config[0].gates[0].macAddress, "00:EF:DD:CC:BB:AA");
  assert.equal(w.config[0].gates[0].triggerModeConfirmed, undefined);
  const { parseConfig } = await import("../dist/settings.js");
  assert.equal(parseConfig(w.config[0]).gates[0].enableControl, true);
  const reopened = await wizard([], undefined, w.config[0].gates);
  assert.equal(reopened.element("enable-control").checked, true);
});

test("saved control off stays off; enabling it persists through save and reopening", async () => {
  const gate = {
    name: "Gate",
    serialNumber: "00112233445566778899AABB",
    macAddress: "AA:BB:CC:DD:EE:01",
    enableControl: false,
  };
  const w = await wizard([], undefined, [gate]);
  assert.equal(w.element("enable-control").checked, false);
  w.element("enable-control").checked = true;
  await w.event("gate-form", "submit");
  assert.equal(w.writes, 1);
  assert.equal(w.config[0].pollInterval, 20);
  assert.equal(w.config[0].gates[0].enableControl, true);
  const reopened = await wizard([], undefined, w.config[0].gates);
  assert.equal(reopened.element("enable-control").checked, true);
  reopened.element("enable-control").checked = false;
  await reopened.event("gate-form", "submit");
  const offAgain = await wizard([], undefined, reopened.config[0].gates);
  assert.equal(offAgain.element("enable-control").checked, false);
});

test("changing a verified Wi-Fi MAC prevents saving until verified again", async () => {
  const w = await wizard(
    [],
    async (input) => ({
      verified: true,
      serialNumber: input.serialNumber,
      macAddress: "00:EF:DD:CC:BB:AA",
      state: "closed",
    }),
    [],
  );
  await w.event("serial", "input", "00112233445566778899AABB");
  await w.event("wifi-mac", "input", "AA:BB:CC:DD:EE:FE");
  w.element("wifi-model-confirmed").checked = true;
  await w.event("verify-wifi", "click");
  await w.event("wifi-mac", "input", "AA:BB:CC:DD:EE:02");
  await w.event("gate-form", "submit");
  assert.equal(w.writes, 0);
  assert.equal(w.element("mac").value, "");
});
