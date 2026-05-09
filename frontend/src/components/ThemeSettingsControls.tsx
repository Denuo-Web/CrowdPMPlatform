import { Flex, Select, SegmentedControl, Text } from "@radix-ui/themes";
import type {
  UserThemeAccentColor,
  UserThemeAppearance,
  UserThemeGrayColor,
  UserThemePanelBackground,
  UserThemeRadius,
  UserThemeScaling,
  UserThemeSettings,
} from "@crowdpm/types";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";

const APPEARANCES = ["light", "dark"] as const satisfies readonly UserThemeAppearance[];
const ACCENT_COLORS = [
  "gray",
  "gold",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "lime",
  "mint",
  "sky",
] as const satisfies readonly UserThemeAccentColor[];
const GRAY_COLORS = ["auto", "gray", "mauve", "slate", "sage", "olive", "sand"] as const satisfies readonly UserThemeGrayColor[];
const PANEL_BACKGROUNDS = ["solid", "translucent"] as const satisfies readonly UserThemePanelBackground[];
const RADII = ["none", "small", "medium", "large", "full"] as const satisfies readonly UserThemeRadius[];
const SCALINGS = ["90%", "95%", "100%", "105%", "110%"] as const satisfies readonly UserThemeScaling[];

type ThemeSettingsControlsProps = {
  disabled?: boolean;
  onError?: (message: string | null) => void;
  onMessage?: (message: string | null) => void;
};

function labelFor(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ThemeSettingsControls({ disabled = false, onError, onMessage }: ThemeSettingsControlsProps) {
  const { user } = useAuth();
  const { settings, isLoading, isSaving, updateSettings } = useUserSettings();
  const controlsDisabled = disabled || isLoading || isSaving || !user;

  const saveTheme = async (nextTheme: UserThemeSettings) => {
    if (!user) {
      onMessage?.(null);
      onError?.("Sign in to save theme preferences.");
      return;
    }
    if (JSON.stringify(nextTheme) === JSON.stringify(settings.theme)) return;

    onMessage?.(null);
    onError?.(null);
    try {
      await updateSettings({ theme: nextTheme });
      onMessage?.("Theme preferences saved.");
    }
    catch (err) {
      onError?.(err instanceof Error ? err.message : "Unable to update theme preferences.");
    }
  };

  const updateTheme = (patch: Partial<UserThemeSettings>) => {
    void saveTheme({ ...settings.theme, ...patch });
  };

  return (
    <Flex direction="column" gap="3">
      <Text size="2" color="gray">Theme appearance</Text>
      <SegmentedControl.Root
        value={settings.theme.appearance}
        onValueChange={(value) => updateTheme({ appearance: value as UserThemeAppearance })}
        disabled={controlsDisabled}
      >
        {APPEARANCES.map((value) => (
          <SegmentedControl.Item key={value} value={value}>{labelFor(value)}</SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>

      <Flex direction={{ initial: "column", sm: "row" }} gap="3">
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Accent color</Text>
          <Select.Root
            value={settings.theme.accentColor}
            onValueChange={(value) => updateTheme({ accentColor: value as UserThemeAccentColor })}
            disabled={controlsDisabled}
          >
            <Select.Trigger />
            <Select.Content>
              {ACCENT_COLORS.map((value) => (
                <Select.Item key={value} value={value}>{labelFor(value)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Gray color</Text>
          <Select.Root
            value={settings.theme.grayColor}
            onValueChange={(value) => updateTheme({ grayColor: value as UserThemeGrayColor })}
            disabled={controlsDisabled}
          >
            <Select.Trigger />
            <Select.Content>
              {GRAY_COLORS.map((value) => (
                <Select.Item key={value} value={value}>{labelFor(value)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>

      <Flex direction={{ initial: "column", sm: "row" }} gap="3">
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Radius</Text>
          <Select.Root
            value={settings.theme.radius}
            onValueChange={(value) => updateTheme({ radius: value as UserThemeRadius })}
            disabled={controlsDisabled}
          >
            <Select.Trigger />
            <Select.Content>
              {RADII.map((value) => (
                <Select.Item key={value} value={value}>{labelFor(value)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Scaling</Text>
          <Select.Root
            value={settings.theme.scaling}
            onValueChange={(value) => updateTheme({ scaling: value as UserThemeScaling })}
            disabled={controlsDisabled}
          >
            <Select.Trigger />
            <Select.Content>
              {SCALINGS.map((value) => (
                <Select.Item key={value} value={value}>{value}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>

      <Text size="2" color="gray">Panel background</Text>
      <SegmentedControl.Root
        value={settings.theme.panelBackground}
        onValueChange={(value) => updateTheme({ panelBackground: value as UserThemePanelBackground })}
        disabled={controlsDisabled}
      >
        {PANEL_BACKGROUNDS.map((value) => (
          <SegmentedControl.Item key={value} value={value}>{labelFor(value)}</SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
    </Flex>
  );
}
