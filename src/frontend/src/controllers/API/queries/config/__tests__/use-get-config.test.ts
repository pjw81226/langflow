import { act, renderHook } from "@testing-library/react";
import { EventDeliveryType } from "@/constants/enums";
import { useUtilityStore } from "@/stores/utilityStore";

const mockApiGet = jest.fn();
let mockQueryFn: (() => Promise<unknown>) | undefined;

jest.mock("@/controllers/API/api", () => ({
  api: { get: mockApiGet },
}));

jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: () => ({
    query: (_key: string[], queryFn: () => Promise<unknown>) => {
      mockQueryFn = queryFn;
      return {};
    },
  }),
}));

jest.mock("@/stores/flowStore", () => ({
  recomputeComponentsToUpdateIfNeeded: jest.fn(),
}));

import { useGetConfig } from "../use-get-config";

describe("useGetConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryFn = undefined;
    useUtilityStore.setState({
      catalogGovernanceEnabled: false,
      substituteOutdatedComponentCode: true,
    });
  });

  it("stores component-policy and catalog flags from public config", async () => {
    mockApiGet.mockResolvedValue({
      data: {
        type: "public",
        frontend_timeout: 30,
        max_file_size_upload: 100,
        event_delivery: EventDeliveryType.STREAMING,
        voice_mode_available: false,
        allow_custom_components: true,
        substitute_outdated_component_code: false,
        catalog_governance_enabled: true,
        mcp_base_url: "",
        enable_extension_reload: false,
      },
    });

    renderHook(() => useGetConfig());

    await act(async () => {
      await mockQueryFn?.();
    });

    expect(useUtilityStore.getState().catalogGovernanceEnabled).toBe(true);
    expect(useUtilityStore.getState().substituteOutdatedComponentCode).toBe(
      false,
    );
  });

  it("defaults trusted outdated-component substitution on for older config responses", async () => {
    useUtilityStore.setState({ substituteOutdatedComponentCode: false });
    mockApiGet.mockResolvedValue({
      data: {
        type: "public",
        frontend_timeout: 30,
        max_file_size_upload: 100,
        event_delivery: EventDeliveryType.STREAMING,
        voice_mode_available: false,
        allow_custom_components: false,
        catalog_governance_enabled: false,
        mcp_base_url: "",
        enable_extension_reload: false,
      },
    });

    renderHook(() => useGetConfig());

    await act(async () => {
      await mockQueryFn?.();
    });

    expect(useUtilityStore.getState().substituteOutdatedComponentCode).toBe(
      true,
    );
  });

  // The assistant fields ride on the authenticated ("full") config: an
  // anonymous caller has no editor, so no panel to configure.
  const baseConfig = {
    type: "full",
    frontend_timeout: 30,
    max_file_size_upload: 100,
    event_delivery: EventDeliveryType.STREAMING,
    voice_mode_available: false,
    allow_custom_components: true,
    catalog_governance_enabled: false,
    mcp_base_url: "",
    enable_extension_reload: false,
  };

  it("stores the assistant panel defaults the deployment configured", async () => {
    mockApiGet.mockResolvedValue({
      data: {
        ...baseConfig,
        assistant_default_model: "OpenAI:gpt-5.4",
        assistant_auto_apply_default: true,
        assistant_dock_default: true,
      },
    });

    renderHook(() => useGetConfig());
    await act(async () => {
      await mockQueryFn?.();
    });

    const state = useUtilityStore.getState();
    expect(state.assistantDefaultModel).toBe("OpenAI:gpt-5.4");
    expect(state.assistantAutoApplyDefault).toBe(true);
    expect(state.assistantDockDefault).toBe(true);
  });

  it("keeps the built-in assistant behaviour for servers without those fields", async () => {
    useUtilityStore.setState({
      assistantDefaultModel: "OpenAI:gpt-5.4",
      assistantAutoApplyDefault: true,
      assistantDockDefault: true,
    });
    mockApiGet.mockResolvedValue({ data: baseConfig });

    renderHook(() => useGetConfig());
    await act(async () => {
      await mockQueryFn?.();
    });

    const state = useUtilityStore.getState();
    expect(state.assistantDefaultModel).toBe("");
    expect(state.assistantAutoApplyDefault).toBe(false);
    expect(state.assistantDockDefault).toBe(false);
  });
});
