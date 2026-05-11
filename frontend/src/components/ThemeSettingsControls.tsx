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
  value: UserThemeSettings;
  onChange: (next: UserThemeSettings) => void;
};

function labelFor(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ThemeSettingsControls({ disabled = false, value, onChange }: ThemeSettingsControlsProps) {
  const updateTheme = (patch: Partial<UserThemeSettings>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <Flex direction="column" gap="3">
      <Text size="2" color="gray">Theme appearance</Text>
      <SegmentedControl.Root
        value={value.appearance}
        onValueChange={(next) => updateTheme({ appearance: next as UserThemeAppearance })}
        disabled={disabled}
      >
        {APPEARANCES.map((entry) => (
          <SegmentedControl.Item key={entry} value={entry}>{labelFor(entry)}</SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>

      <Flex direction={{ initial: "column", sm: "row" }} gap="3">
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Accent color</Text>
          <Select.Root
            value={value.accentColor}
            onValueChange={(next) => updateTheme({ accentColor: next as UserThemeAccentColor })}
            disabled={disabled}
          >
            <Select.Trigger />
            <Select.Content>
              {ACCENT_COLORS.map((entry) => (
                <Select.Item key={entry} value={entry}>{labelFor(entry)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Gray color</Text>
          <Select.Root
            value={value.grayColor}
            onValueChange={(next) => updateTheme({ grayColor: next as UserThemeGrayColor })}
            disabled={disabled}
          >
            <Select.Trigger />
            <Select.Content>
              {GRAY_COLORS.map((entry) => (
                <Select.Item key={entry} value={entry}>{labelFor(entry)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>

      <Flex direction={{ initial: "column", sm: "row" }} gap="3">
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Radius</Text>
          <Select.Root
            value={value.radius}
            onValueChange={(next) => updateTheme({ radius: next as UserThemeRadius })}
            disabled={disabled}
          >
            <Select.Trigger />
            <Select.Content>
              {RADII.map((entry) => (
                <Select.Item key={entry} value={entry}>{labelFor(entry)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="2" flexGrow="1">
          <Text size="2" color="gray">Scaling</Text>
          <Select.Root
            value={value.scaling}
            onValueChange={(next) => updateTheme({ scaling: next as UserThemeScaling })}
            disabled={disabled}
          >
            <Select.Trigger />
            <Select.Content>
              {SCALINGS.map((entry) => (
                <Select.Item key={entry} value={entry}>{entry}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Flex>

      <Text size="2" color="gray">Panel background</Text>
      <SegmentedControl.Root
        value={value.panelBackground}
        onValueChange={(next) => updateTheme({ panelBackground: next as UserThemePanelBackground })}
        disabled={disabled}
      >
        {PANEL_BACKGROUNDS.map((entry) => (
          <SegmentedControl.Item key={entry} value={entry}>{labelFor(entry)}</SegmentedControl.Item>
        ))}
      </SegmentedControl.Root>
    </Flex>
  );
}
