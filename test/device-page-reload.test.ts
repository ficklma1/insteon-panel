import { beforeEach, describe, expect, it, vi } from "vitest";
import { showAlertDialog } from "@ha/dialogs/generic/show-dialog-box";

vi.mock("@ha/layouts/hass-tabs-subpage", () => ({}));
vi.mock("@ha/components/ha-button", () => ({}));
vi.mock("@ha/components/ha-button-menu", () => ({}));
vi.mock("@ha/components/ha-fab", () => ({}));
vi.mock("@ha/components/ha-icon-button", () => ({}));
vi.mock("@ha/components/ha-list-item", () => ({}));
vi.mock("@ha/components/ha-spinner", () => ({}));
vi.mock("@ha/resources/styles", () => ({ haStyle: [] }));
vi.mock("@ha/common/navigate", () => ({ navigate: vi.fn() }));
vi.mock("@ha/util/file_download", () => ({ fileDownload: vi.fn() }));
vi.mock("@ha/dialogs/generic/show-dialog-box", () => ({
  showAlertDialog: vi.fn(),
  showConfirmationDialog: vi.fn(async () => true),
}));
vi.mock("../src/device/insteon-device-header", () => ({}));
vi.mock("../src/device/delete-device", () => ({ confirmDeleteDevice: vi.fn() }));
vi.mock("../src/device/aldb/insteon-aldb-data-table", () => ({}));
vi.mock("../src/device/aldb/show-dialog-insteon-aldb-record", () => ({
  showInsteonALDBRecordDialog: vi.fn(),
}));
vi.mock("../src/device/properties/insteon-properties-data-table", () => ({}));
vi.mock("../src/device/properties/show-dialog-insteon-property", () => ({
  showInsteonPropertyDialog: vi.fn(),
}));

import "../src/device/aldb/insteon-device-aldb-page";
import "../src/device/properties/insteon-device-properties-page";

const deviceFor: Record<string, object> = {
  "dev-1": { name: "First", address: "11.11.11", is_battery: false, aldb_status: "loaded" },
  "dev-2": { name: "Second", address: "22.22.22", is_battery: false, aldb_status: "loaded" },
};

type Deferred = { resolve: (value: unknown) => void; promise: Promise<unknown> };

const deferred = (): Deferred => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};

const makeHass = (hold?: Record<string, Deferred>, fail: string[] = []) => ({
  localize: (key: string) => key,
  userData: { showAdvanced: false },
  callWS: vi.fn(async (msg: { type: string; device_id?: string; device_address?: string }) => {
    if (msg.type === "insteon/device/get") {
      return deviceFor[msg.device_id!];
    }
    const address = msg.device_address!;
    const pending = hold?.[address];
    if (pending) {
      await pending.promise;
    }
    if (fail.includes(msg.type)) {
      throw new Error("failed " + msg.type);
    }
    if (msg.type === "insteon/properties/load" || msg.type === "insteon/properties/write") {
      return undefined;
    }
    if (msg.type === "insteon/properties/get") {
      return {
        properties: [{ name: `prop_${address}`, value: 1, modified: false }],
        schema: {},
      };
    }
    if (msg.type === "insteon/aldb/get") {
      return [{ mem_addr: 4095, in_use: true, dirty: false, target: address }];
    }
    throw new Error("unexpected " + msg.type);
  }),
  connection: { subscribeMessage: vi.fn(async () => async () => {}) },
});

const settle = async (el: any) => {
  for (let i = 0; i < 6; i += 1) {
    await el.updateComplete;
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const mount = async (tag: string, hass: ReturnType<typeof makeHass>) => {
  const el = document.createElement(tag) as any;
  el.hass = hass;
  el.insteon = { localize: (key: string) => key };
  el.route = { prefix: "/insteon/device", path: "/dev-1" };
  el.deviceId = "dev-1";
  document.body.appendChild(el);
  await settle(el);
  return el;
};

const tabPaths = (el: HTMLElement) => {
  const subpage = el.shadowRoot!.querySelector("hass-tabs-subpage") as HTMLElement & {
    tabs: { path: string }[];
  };
  return subpage.tabs.map((tab) => tab.path);
};

describe("device pages reload when the router reuses them", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("properties page loads the newly selected device", async () => {
    const el = await mount("insteon-device-properties-page", makeHass());
    expect(el._properties.map((p: any) => p.name)).toEqual(["prop_11.11.11"]);
    el.deviceId = "dev-2";
    await settle(el);
    expect(el._device.address).toBe("22.22.22");
    expect(el._properties.map((p: any) => p.name)).toEqual(["prop_22.22.22"]);
    expect(tabPaths(el)).toEqual([
      "/insteon/device/overview/dev-2",
      "/insteon/device/properties/dev-2",
      "/insteon/device/aldb/dev-2",
    ]);
  });

  it("properties page ignores a late response for the previous device", async () => {
    const hold = { "11.11.11": deferred() };
    const el = await mount("insteon-device-properties-page", makeHass(hold));
    el.deviceId = "dev-2";
    await settle(el);
    hold["11.11.11"].resolve(undefined);
    await settle(el);
    expect(el._properties.map((p: any) => p.name)).toEqual(["prop_22.22.22"]);
  });

  it("ALDB page loads the newly selected device", async () => {
    const el = await mount("insteon-device-aldb-page", makeHass());
    expect(el._records.map((r: any) => r.target)).toEqual(["11.11.11"]);
    el.deviceId = "dev-2";
    await settle(el);
    expect(el._device.address).toBe("22.22.22");
    expect(el._records.map((r: any) => r.target)).toEqual(["22.22.22"]);
    expect(tabPaths(el)).toEqual([
      "/insteon/device/overview/dev-2",
      "/insteon/device/properties/dev-2",
      "/insteon/device/aldb/dev-2",
    ]);
  });

  it("ALDB page ignores a late response for the previous device", async () => {
    const hold = { "11.11.11": deferred() };
    const el = await mount("insteon-device-aldb-page", makeHass(hold));
    el.deviceId = "dev-2";
    await settle(el);
    hold["11.11.11"].resolve(undefined);
    await settle(el);
    expect(el._records.map((r: any) => r.target)).toEqual(["22.22.22"]);
  });
});

const wsCalls = (hass: ReturnType<typeof makeHass>, type: string, address?: string) =>
  hass.callWS.mock.calls.filter(
    ([msg]) => msg.type === type && (address === undefined || msg.device_address === address),
  ).length;

describe("work started for one device does not leak into the next", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(showAlertDialog).mockClear();
  });

  it("ALDB page ignores loading messages for the previous device", async () => {
    const hass = makeHass();
    const el = await mount("insteon-device-aldb-page", hass);
    el._subscribe();
    const [[notify, request]] = hass.connection.subscribeMessage.mock.calls as any;
    expect(request.device_address).toBe("11.11.11");

    el.deviceId = "dev-2";
    await settle(el);
    const aldbGets = wsCalls(hass, "insteon/aldb/get");
    const deviceGets = wsCalls(hass, "insteon/device/get");

    notify({ type: "record_loaded" });
    notify({ type: "status_changed", is_loading: true });
    await settle(el);

    expect(wsCalls(hass, "insteon/aldb/get")).toBe(aldbGets);
    expect(wsCalls(hass, "insteon/device/get")).toBe(deviceGets);
    expect(el._isLoading).toBe(false);
    expect(el._device.address).toBe("22.22.22");
    expect(el._records.map((r: any) => r.target)).toEqual(["22.22.22"]);
  });

  it("ALDB page replaces, rather than stacks, its loading subscription", async () => {
    const unsub = vi.fn(async () => {});
    const hass = makeHass();
    hass.connection.subscribeMessage.mockImplementation(async () => unsub);
    const el = await mount("insteon-device-aldb-page", hass);
    el._subscribe();
    el._subscribe();
    await settle(el);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("properties page clears the wait spinner and skips the refresh after a late write", async () => {
    const hold: Record<string, Deferred> = {};
    const hass = makeHass(hold);
    const el = await mount("insteon-device-properties-page", hass);
    hold["11.11.11"] = deferred();
    const writing = el._write();
    await settle(el);
    expect(el._showWait).toBe(true);

    el.deviceId = "dev-2";
    await settle(el);
    expect(el._showWait).toBe(false);
    const oldGets = wsCalls(hass, "insteon/properties/get", "11.11.11");

    hold["11.11.11"].resolve(undefined);
    await writing;
    await settle(el);

    expect(wsCalls(hass, "insteon/properties/get", "11.11.11")).toBe(oldGets);
    expect(el._showWait).toBe(false);
    expect(el._properties.map((p: any) => p.name)).toEqual(["prop_22.22.22"]);
  });

  it("properties page does not report a failed load for the previous device", async () => {
    const hold: Record<string, Deferred> = {};
    const hass = makeHass(hold, ["insteon/properties/load"]);
    const el = await mount("insteon-device-properties-page", hass);
    hold["11.11.11"] = deferred();
    const loading = el._load();
    await settle(el);

    el.deviceId = "dev-2";
    await settle(el);
    hold["11.11.11"].resolve(undefined);
    await loading;
    await settle(el);

    expect(showAlertDialog).not.toHaveBeenCalled();
    expect(el._showWait).toBe(false);
  });
});
