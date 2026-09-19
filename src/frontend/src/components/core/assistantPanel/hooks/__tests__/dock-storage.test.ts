import {
  clampDockWidth,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  readDockPreference,
  readDockWidth,
  writeDockPreference,
  writeDockWidth,
} from "../dock-storage";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("dock-storage", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportWidth(1920);
  });

  it("should_report_no_preference_until_the_user_chooses", () => {
    // null is what lets the deployment default apply.
    expect(readDockPreference()).toBeNull();
  });

  it("should_round_trip_both_choices", () => {
    writeDockPreference(true);
    expect(readDockPreference()).toBe(true);

    writeDockPreference(false);
    expect(readDockPreference()).toBe(false);
  });

  it("should_treat_a_corrupted_preference_as_no_preference", () => {
    localStorage.setItem("langflow-assistant-docked", "yes");

    expect(readDockPreference()).toBeNull();
  });

  it("should_default_the_width_and_round_trip_a_chosen_one", () => {
    expect(readDockWidth()).toBe(DOCK_DEFAULT_WIDTH);

    writeDockWidth(600);

    expect(readDockWidth()).toBe(600);
  });

  it("should_clamp_the_width_to_its_floor_and_ceiling", () => {
    expect(clampDockWidth(100)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(5000)).toBe(DOCK_MAX_WIDTH);
  });

  it("should_never_take_more_than_half_of_the_viewport", () => {
    setViewportWidth(1200);

    expect(clampDockWidth(900)).toBe(600);
  });

  it("should_keep_the_floor_even_when_half_the_viewport_is_smaller", () => {
    setViewportWidth(800);

    expect(clampDockWidth(900)).toBe(DOCK_MIN_WIDTH);
  });

  it("should_survive_localStorage_throwing", () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(readDockPreference()).toBeNull();
    expect(readDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
    expect(() => writeDockPreference(true)).not.toThrow();
    expect(() => writeDockWidth(500)).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
