import { readAssistantMode, writeAssistantMode } from "../mode-storage";

const STORAGE_KEY = "langflow-assistant-mode";

describe("mode-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should_default_to_component_when_nothing_is_stored", () => {
    expect(readAssistantMode()).toBe("component");
  });

  it.each(["component", "prompt", "ask"] as const)(
    "should_round_trip_%s",
    (mode) => {
      writeAssistantMode(mode);

      expect(localStorage.getItem(STORAGE_KEY)).toBe(mode);
      expect(readAssistantMode()).toBe(mode);
    },
  );

  it("should_read_a_stored_build_as_component", () => {
    // "build" was the mode before the panel split into three.
    localStorage.setItem(STORAGE_KEY, "build");

    expect(readAssistantMode()).toBe("component");
  });

  it("should_fall_back_to_component_for_an_unknown_stored_value", () => {
    localStorage.setItem(STORAGE_KEY, "chat");

    expect(readAssistantMode()).toBe("component");
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

    expect(readAssistantMode()).toBe("component");
    expect(() => writeAssistantMode("ask")).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
