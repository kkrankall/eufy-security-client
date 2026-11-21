import { SmartSafe } from "../device";
import { HTTPApi } from "../api";
import { DeviceListResponse } from "../models";
import { Station } from "../station";
import { DeviceProperties, DeviceType, PropertyMetadataNumeric, PropertyName } from "../types";
import { SmartSafeEvent } from "../../push/types";
import { PushMessage } from "../../push/models";

const SERIAL = "T7400P0000000000";
const EVENT_DURATION_SECONDS = 10;

const createSafe = async (): Promise<SmartSafe> => {
  const rawDevice = {
    device_sn: SERIAL,
    station_sn: SERIAL,
    device_type: DeviceType.SMART_SAFE_7400,
    device_name: "Safe",
  } as unknown as DeviceListResponse;
  const safe = await SmartSafe.getInstance({} as HTTPApi, rawDevice, {});
  safe.initialize();
  return safe;
};

const lockStatusPush = (action: number, type: number): PushMessage =>
  ({
    name: "Safe",
    event_time: Date.now(),
    type: DeviceType.SMART_SAFE_7400,
    station_sn: SERIAL,
    device_sn: SERIAL,
    event_type: SmartSafeEvent.LOCK_STATUS,
    event_value: { type: type, action: action, figure_id: 0, user_id: 0 },
  }) as PushMessage;

describe("SmartSafe lock event origin", () => {
  let safe: SmartSafe;

  beforeEach(async () => {
    jest.useFakeTimers();
    safe = await createSafe();
  });

  afterEach(() => {
    safe.destroy();
    jest.useRealTimers();
  });

  test("is registered for every smart safe model with the safe's own states", () => {
    for (const type of [
      DeviceType.SMART_SAFE_7400,
      DeviceType.SMART_SAFE_7401,
      DeviceType.SMART_SAFE_7402,
      DeviceType.SMART_SAFE_7403,
    ]) {
      const metadata = DeviceProperties[type][PropertyName.DeviceLockEventOrigin] as PropertyMetadataNumeric;
      expect(metadata).toBeDefined();
      expect(metadata.key).toBe("custom_lockEventOrigin");
      expect(metadata.writeable).toBe(false);
      expect(metadata.states).toEqual({
        0: "None",
        1: "PIN",
        2: "Fingerprint",
        3: "Key",
        4: "App",
        5: "Dual Unlock",
      });
    }
  });

  test("defaults to None", () => {
    expect(safe.hasProperty(PropertyName.DeviceLockEventOrigin)).toBe(true);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(0);
  });

  test.each([
    [1, "PIN"],
    [2, "Fingerprint"],
    [3, "Key"],
    [4, "App"],
    [5, "Dual Unlock"],
  ])("unlock push with type %i sets origin to %s, then resets after the event duration", (type) => {
    const changes: Array<[string, unknown]> = [];
    safe.on("property changed", (_device, name, value) => changes.push([name, value]));

    safe.processPushNotification({} as Station, lockStatusPush(0, type), EVENT_DURATION_SECONDS);

    expect(safe.getPropertyValue(PropertyName.DeviceLocked)).toBe(false);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(type);
    expect(changes).toContainEqual([PropertyName.DeviceLockEventOrigin, type]);

    jest.advanceTimersByTime(EVENT_DURATION_SECONDS * 1000 - 1);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(type);

    jest.advanceTimersByTime(1);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(0);
  });

  test("a second unlock restarts the reset timer", () => {
    safe.processPushNotification({} as Station, lockStatusPush(0, 1), EVENT_DURATION_SECONDS);
    jest.advanceTimersByTime(EVENT_DURATION_SECONDS * 500);
    safe.processPushNotification({} as Station, lockStatusPush(0, 4), EVENT_DURATION_SECONDS);
    jest.advanceTimersByTime(EVENT_DURATION_SECONDS * 500);

    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(4);

    jest.advanceTimersByTime(EVENT_DURATION_SECONDS * 500);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(0);
  });

  test.each([0, 6, 99])("unlock push with unknown type %i leaves origin at None", (type) => {
    safe.processPushNotification({} as Station, lockStatusPush(0, type), EVENT_DURATION_SECONDS);

    expect(safe.getPropertyValue(PropertyName.DeviceLocked)).toBe(false);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(0);
  });

  test("lock push does not set an origin", () => {
    safe.processPushNotification({} as Station, lockStatusPush(1, 3), EVENT_DURATION_SECONDS);

    expect(safe.getPropertyValue(PropertyName.DeviceLocked)).toBe(true);
    expect(safe.getPropertyValue(PropertyName.DeviceLockEventOrigin)).toBe(0);
  });
});
