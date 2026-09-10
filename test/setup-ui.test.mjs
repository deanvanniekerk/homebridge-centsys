import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Execute the shipped wizard event handlers against a small DOM/Homebridge boundary.
async function wizard(rows) {
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
  const saved = [
    {
      name: "Existing",
      serialNumber: "00112233445566778899AABB",
      macAddress: "AA:BB:CC:DD:EE:01",
      enableControl: true,
      triggerModeConfirmed: true,
    },
  ];
  const document = {
    getElementById: element,
    createElement: () => ({}),
    querySelectorAll: () => [],
  };
  const homebridge = {
    getPluginConfig: async () => [{ platform: "Centsys", gates: saved }],
    request: async (path) =>
      path === "/status" ? { state: "signed-in", accountSuffix: "0000" } : rows,
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
  return { element, event };
}

test("wizard autofills discovered MAC and never carries another gate address or control consent", async () => {
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
  assert.equal(e("enable-control").checked, false);
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
