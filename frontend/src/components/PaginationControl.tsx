import { ChevronDownIcon, ChevronUpIcon } from "@radix-ui/react-icons";
import { Flex, IconButton, Text } from "@radix-ui/themes";

export const MIN_VISIBLE_RESULTS = 1;
export const DEFAULT_VISIBLE_RESULTS = 10;

export function clampVisibleResults(total: number, requested: number) {
  if (total <= 0) return 0;
  return Math.min(Math.max(requested, MIN_VISIBLE_RESULTS), Math.min(DEFAULT_VISIBLE_RESULTS, total));
}

type ResultCountControlProps = {
  itemLabelSingular: string;
  itemLabelPlural: string;
  visibleCount: number;
  totalCount: number;
  onShowLess: () => void;
  onShowMore: () => void;
};

export function ResultCountControl({
  itemLabelSingular,
  itemLabelPlural,
  visibleCount,
  totalCount,
  onShowLess,
  onShowMore,
}: ResultCountControlProps) {
  if (totalCount <= 1) return null;

  const maxVisibleCount = Math.min(DEFAULT_VISIBLE_RESULTS, totalCount);
  const noun = totalCount === 1 ? itemLabelSingular : itemLabelPlural;
  const summary = visibleCount < totalCount
    ? `Showing first ${visibleCount} of ${totalCount} ${noun}`
    : `Showing ${visibleCount} ${noun}`;

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Text size="2" color="gray">{summary}</Text>
      <IconButton
        type="button"
        variant="soft"
        size="1"
        aria-label={`Show fewer ${itemLabelPlural}`}
        onClick={onShowLess}
        disabled={visibleCount <= MIN_VISIBLE_RESULTS}
      >
        <ChevronUpIcon />
      </IconButton>
      <IconButton
        type="button"
        variant="soft"
        size="1"
        aria-label={`Show more ${itemLabelPlural}`}
        onClick={onShowMore}
        disabled={visibleCount >= maxVisibleCount}
      >
        <ChevronDownIcon />
      </IconButton>
    </Flex>
  );
}
