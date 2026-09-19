import { purgeLegacyAssistantStorage } from "../legacy-storage";

describe("purgeLegacyAssistantStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should_remove_the_keys_of_removed_features", () => {
    localStorage.setItem("langflow-assistant-skip-all", "true");
    localStorage.setItem("langflow-assistant-skip-all-set", "true");
    localStorage.setItem("langflow-assistant-history-limit", "10");
    localStorage.setItem("langflow-assistant-iterations-limit", "50");

    purgeLegacyAssistantStorage();

    expect(localStorage.getItem("langflow-assistant-skip-all")).toBeNull();
    expect(localStorage.getItem("langflow-assistant-skip-all-set")).toBeNull();
    expect(localStorage.getItem("langflow-assistant-history-limit")).toBeNull();
    expect(
      localStorage.getItem("langflow-assistant-iterations-limit"),
    ).toBeNull();
  });

  it("should_keep_the_settings_that_still_exist", () => {
    localStorage.setItem("langflow-assistant-mode", "ask");
    localStorage.setItem("langflow-assistant-docked", "true");

    purgeLegacyAssistantStorage();

    expect(localStorage.getItem("langflow-assistant-mode")).toBe("ask");
    expect(localStorage.getItem("langflow-assistant-docked")).toBe("true");
  });

  it("should_not_throw_when_storage_is_unavailable", () => {
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => purgeLegacyAssistantStorage()).not.toThrow();
  });
});
