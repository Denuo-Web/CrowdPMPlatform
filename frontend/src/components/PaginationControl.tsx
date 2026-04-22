import { ChevronDownIcon, ChevronUpIcon } from "@radix-ui/react-icons";
import { Flex, IconButton, Text } from "@radix-ui/themes";

export const RESULTS_PER_PAGE = 10;

function getPageCount(total: number, pageSize = RESULTS_PER_PAGE) {
  if (total <= 0) return 0;
  return Math.ceil(total / pageSize);
}

export function clampPageIndex(total: number, requested: number, pageSize = RESULTS_PER_PAGE) {
  const pageCount = getPageCount(total, pageSize);
  if (pageCount === 0) return 0;
  return Math.min(Math.max(requested, 0), pageCount - 1);
}

export function getPaginationWindow(total: number, pageIndex: number, pageSize = RESULTS_PER_PAGE) {
  if (total <= 0) {
    return {
      pageStart: 0,
      pageEnd: 0,
    };
  }

  const nextPageIndex = clampPageIndex(total, pageIndex, pageSize);
  const pageStart = nextPageIndex * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, total);

  return {
    pageStart,
    pageEnd,
  };
}

type ResultCountControlProps = {
  itemLabelSingular: string;
  itemLabelPlural: string;
  pageStart: number;
  pageEnd: number;
  totalCount: number;
  onShowLess: () => void;
  onShowMore: () => void;
};

export function ResultCountControl(props: ResultCountControlProps) {
  const {
    itemLabelSingular,
    itemLabelPlural,
    pageStart,
    pageEnd,
    totalCount,
    onShowLess,
    onShowMore,
  } = props;

  if (totalCount <= 1) return null;

  const noun = totalCount === 1 ? itemLabelSingular : itemLabelPlural;
  const summary = `Showing ${pageStart + 1}-${pageEnd} of ${totalCount} ${noun}`;

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Text size="2" color="gray">{summary}</Text>
      <IconButton
        type="button"
        variant="soft"
        size="1"
        aria-label={`Show fewer ${itemLabelPlural}`}
        onClick={onShowLess}
        disabled={pageStart === 0}
      >
        <ChevronUpIcon />
      </IconButton>
      <IconButton
        type="button"
        variant="soft"
        size="1"
        aria-label={`Show more ${itemLabelPlural}`}
        onClick={onShowMore}
        disabled={pageEnd >= totalCount}
      >
        <ChevronDownIcon />
      </IconButton>
    </Flex>
  );
}
