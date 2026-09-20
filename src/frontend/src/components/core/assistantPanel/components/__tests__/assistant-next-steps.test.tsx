import { fireEvent, render, screen } from "@testing-library/react";
import type { NextStep } from "../../helpers/next-steps";
import { AssistantNextSteps } from "../assistant-next-steps";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const steps: NextStep[] = [
  {
    id: "shorter",
    label: "Make it shorter",
    action: { type: "prefill", mode: "prompt", text: "Make it shorter." },
  },
  {
    id: "test-flow",
    label: "Test flow",
    action: { type: "test_flow" },
  },
];

describe("AssistantNextSteps", () => {
  it("renders nothing when there is no suggestion", () => {
    const { container } = render(
      <AssistantNextSteps steps={[]} onSelect={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one button per step", () => {
    render(<AssistantNextSteps steps={steps} onSelect={jest.fn()} />);
    expect(screen.getByTestId("assistant-next-steps")).toBeInTheDocument();
    expect(screen.getByText("Make it shorter")).toBeInTheDocument();
    expect(screen.getByText("Test flow")).toBeInTheDocument();
  });

  it("hands the clicked step back", () => {
    const onSelect = jest.fn();
    render(<AssistantNextSteps steps={steps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("assistant-next-step-test-flow"));
    expect(onSelect).toHaveBeenCalledWith(steps[1]);
  });
});
