import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyPageCommunity } from "../empty-page";

interface ButtonProps {
  children?: React.ReactNode;
  onClick?: () => void;
  "data-testid"?: string;
  [key: string]: unknown;
}

interface IconProps {
  name: string;
  [key: string]: unknown;
}

interface WrapperProps {
  children: React.ReactNode;
  [key: string]: unknown;
}

jest.mock("@/assets/logo_dark.png", () => "logo_dark.png");
jest.mock("@/assets/logo_light.png", () => "logo_light.png");

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: jest.fn() },
}));

jest.mock("react-icons/fa", () => ({
  FaGithub: () => <div data-testid="icon-github" />,
  FaDiscord: () => <div data-testid="icon-discord" />,
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  ForwardedIconComponent: ({ name }: IconProps) => (
    <div data-testid={`icon-${name}`}>{name}</div>
  ),
}));

jest.mock("@/components/core/cardsWrapComponent", () => ({
  __esModule: true,
  default: ({ children }: WrapperProps) => <div>{children}</div>,
}));

jest.mock("@/components/ui/dot-background", () => ({
  DotBackgroundDemo: ({ children }: WrapperProps) => <div>{children}</div>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    "data-testid": testId,
    ...props
  }: ButtonProps) => (
    <button onClick={onClick} data-testid={testId} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("@/controllers/API/queries/auth", () => ({
  useGetUserData: () => ({ mutate: jest.fn() }),
  useUpdateUser: () => ({ mutate: jest.fn() }),
}));

jest.mock("@/stores/authStore", () => ({
  __esModule: true,
  default: () => ({ id: "user-1", optins: {} }),
}));

jest.mock("@/stores/darkStore", () => ({
  useDarkStore: (
    selector: (s: { stars: number; discordCount: number }) => unknown,
  ) => selector({ stars: 149000, discordCount: 25000 }),
}));

jest.mock("@/stores/foldersStore", () => ({
  useFolderStore: (selector: (s: { folders: unknown[] }) => unknown) =>
    selector({ folders: [] }),
}));

jest.mock("../../hooks/use-on-file-drop", () => ({
  __esModule: true,
  default: () => jest.fn(),
}));

describe("EmptyPageCommunity - Create first flow behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should_open_templates_modal_when_create_first_flow_clicked", () => {
    const setOpenModal = jest.fn();
    render(<EmptyPageCommunity setOpenModal={setOpenModal} />);

    fireEvent.click(screen.getByTestId("new_project_btn_empty_page"));

    // Same as the "New Flow" button shown once the user has flows: pick a
    // template or a blank flow in the templates modal.
    expect(setOpenModal).toHaveBeenCalledTimes(1);
    expect(setOpenModal).toHaveBeenCalledWith(true);
  });
});
