import { readAssistantMode, writeAssistantMode } from "../mode-storage";

const STORAGE_KEY = "langflow-assistant-mode";

describe("mode-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should_default_to_build_when_nothing_is_stored", () => {
    expect(readAssistantMode()).toBe("build");
  });

  it("should_round_trip_the_chosen_mode", () => {
    writeAssistantMode("ask");

    expect(localStorage.getItem(STORAGE_KEY)).toBe("ask");
    expect(readAssistantMode()).toBe("ask");
  });

  it("should_fall_back_to_build_for_an_unknown_stored_value", () => {
    localStorage.setItem(STORAGE_KEY, "chat");

    expect(readAssistantMode()).toBe("build");
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

    expect(readAssistantMode()).toBe("build");
    expect(() => writeAssistantMode("ask")).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
