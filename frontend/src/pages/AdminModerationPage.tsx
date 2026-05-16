import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { timestampToMillis } from "@crowdpm/types";
import {
  Badge,
  Box,
  Button,
  Card,
  Dialog,
  Flex,
  Heading,
  Select,
  Separator,
  Table,
  Text,
  TextArea,
} from "@radix-ui/themes";
import {
  getAdminDemoBatch,
  listAdminSubmissions,
  listAdminUsers,
  moderateAdminSubmission,
  setAdminDemoBatch,
  updateAdminUser,
  type AdminSubmissionSummary,
  type AdminUserSummary,
  type BatchVisibility,
  type ModerationState,
  type AdminRole,
} from "../lib/api";
import { decodeBatchKey, encodeBatchKey } from "../lib/batchKeys";
import { useAuth } from "../providers/AuthProvider";
import { clampPageIndex, getPaginationWindow, ResultCountControl } from "../components/PaginationControl";

const NO_DEMO_BATCH_KEY = "__no_demo_batch__";
const ADMIN_QUERY_KEYS = {
  submissions: (params: { moderationState?: ModerationState; visibility?: BatchVisibility; limit: number }) => ["admin", "submissions", params] as const,
  demoBatchOptions: ["admin", "demoBatchOptions"] as const,
  users: (pageToken: string | null) => ["admin", "users", pageToken ?? "first"] as const,
};
const EMPTY_SUBMISSIONS: AdminSubmissionSummary[] = [];
const EMPTY_USERS: AdminUserSummary[] = [];
const EMPTY_DEMO_BATCH_OPTIONS = { batches: EMPTY_SUBMISSIONS, selectedKey: NO_DEMO_BATCH_KEY };
const EMPTY_USER_PAGE = { users: EMPTY_USERS, nextPageToken: null as string | null };

function formatTimestamp(value: string | null): string {
  const ms = timestampToMillis(value);
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
}

function normalizeRoleLabel(role: AdminRole): string {
  return role === "super_admin" ? "Super Admin" : "Moderator";
}

function formatBatchOption(batch: AdminSubmissionSummary): string {
  const device = batch.deviceName || batch.deviceId;
  const count = batch.count ? ` (${batch.count})` : "";
  return `${formatTimestamp(batch.processedAt)} - ${device}${count}`;
}

function mergeDemoBatchOptions(
  batches: AdminSubmissionSummary[],
  current: AdminSubmissionSummary | null,
): AdminSubmissionSummary[] {
  if (!current) return batches;
  const key = encodeBatchKey(current.deviceId, current.batchId);
  if (batches.some((batch) => encodeBatchKey(batch.deviceId, batch.batchId) === key)) {
    return batches;
  }
  return [current, ...batches];
}

type SubmissionFilterState = "all" | ModerationState;
type VisibilityFilterState = "all" | BatchVisibility;

type PendingConfirmation =
  | {
    kind: "submission";
    entry: AdminSubmissionSummary;
    moderationState: ModerationState;
  }
  | {
    kind: "toggleDisabled";
    entry: AdminUserSummary;
    nextDisabled: boolean;
  }
  | {
    kind: "roles";
    entry: AdminUserSummary;
    roles: AdminRole[];
  };

function describeRoles(roles: AdminRole[]): string {
  return roles.length ? roles.map((role) => normalizeRoleLabel(role)).join(", ") : "No admin roles";
}

function confirmationCopy(action: PendingConfirmation | null): {
  title: string;
  description: string;
  confirmLabel: string;
  confirmColor?: "tomato" | "green";
} {
  if (!action) {
    return {
      title: "Confirm action",
      description: "Review this administrative change before continuing.",
      confirmLabel: "Confirm",
    };
  }
  if (action.kind === "submission") {
    return {
      title: action.moderationState === "quarantined" ? "Quarantine submission" : "Approve submission",
      description: `${action.moderationState === "quarantined" ? "Quarantine" : "Approve"} batch ${action.entry.batchId} from ${action.entry.deviceName || action.entry.deviceId}.`,
      confirmLabel: action.moderationState === "quarantined" ? "Quarantine" : "Approve",
      confirmColor: action.moderationState === "quarantined" ? "tomato" : "green",
    };
  }
  if (action.kind === "toggleDisabled") {
    return {
      title: action.nextDisabled ? "Disable user" : "Enable user",
      description: `${action.nextDisabled ? "Disable" : "Enable"} ${action.entry.email ?? action.entry.uid}. Disabling revokes the user's refresh tokens and device tokens.`,
      confirmLabel: action.nextDisabled ? "Disable user" : "Enable user",
      confirmColor: action.nextDisabled ? "tomato" : "green",
    };
  }
  return {
    title: "Change admin roles",
    description: `Set roles for ${action.entry.email ?? action.entry.uid} to: ${describeRoles(action.roles)}.`,
    confirmLabel: "Update roles",
  };
}

export default function AdminModerationPage() {
  const { isSuperAdmin, canAccessAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [demoBatchSaving, setDemoBatchSaving] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [submissionActionError, setSubmissionActionError] = useState<string | null>(null);
  const [demoBatchActionError, setDemoBatchActionError] = useState<string | null>(null);
  const [demoBatchMessage, setDemoBatchMessage] = useState<string | null>(null);
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [usersPageTokenInput, setUsersPageTokenInput] = useState<string | null>(null);

  const [moderationFilter, setModerationFilter] = useState<SubmissionFilterState>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilterState>("all");
  const [submissionPageIndexInput, setSubmissionPageIndexInput] = useState(0);
  const [userPageIndexInput, setUserPageIndexInput] = useState(0);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [confirmationReason, setConfirmationReason] = useState("");

  const canManageUsers = canAccessAdmin && isSuperAdmin;

  const submissionParams = useMemo(() => ({
    moderationState: moderationFilter === "all" ? undefined : moderationFilter,
    visibility: visibilityFilter === "all" ? undefined : visibilityFilter,
    limit: 100,
  }), [moderationFilter, visibilityFilter]);
  const submissionsQueryKey = useMemo(() => ADMIN_QUERY_KEYS.submissions(submissionParams), [submissionParams]);
  const usersQueryKey = useMemo(() => ADMIN_QUERY_KEYS.users(usersPageTokenInput), [usersPageTokenInput]);
  const submissionsQuery = useQuery<AdminSubmissionSummary[]>({
    queryKey: submissionsQueryKey,
    enabled: canAccessAdmin,
    queryFn: () => listAdminSubmissions(submissionParams),
    placeholderData: EMPTY_SUBMISSIONS,
  });
  const demoBatchOptionsQuery = useQuery({
    queryKey: ADMIN_QUERY_KEYS.demoBatchOptions,
    enabled: canAccessAdmin,
    queryFn: async () => {
      const [setting, batches] = await Promise.all([
        getAdminDemoBatch(),
        listAdminSubmissions({ moderationState: "approved", visibility: "public", limit: 200 }),
      ]);
      return {
        batches: mergeDemoBatchOptions(batches, setting?.summary ?? null),
        selectedKey: setting ? encodeBatchKey(setting.deviceId, setting.batchId) : NO_DEMO_BATCH_KEY,
      };
    },
    placeholderData: EMPTY_DEMO_BATCH_OPTIONS,
  });
  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    enabled: canManageUsers,
    queryFn: () => listAdminUsers({ limit: 100, pageToken: usersPageTokenInput ?? undefined }),
    placeholderData: EMPTY_USER_PAGE,
  });
  const submissions = submissionsQuery.data ?? EMPTY_SUBMISSIONS;
  const demoBatches = demoBatchOptionsQuery.data?.batches ?? EMPTY_SUBMISSIONS;
  const demoBatchKey = demoBatchOptionsQuery.data?.selectedKey ?? NO_DEMO_BATCH_KEY;
  const users = usersQuery.data?.users ?? EMPTY_USERS;
  const usersPageToken = usersQuery.data?.nextPageToken ?? null;
  const submissionsLoading = submissionsQuery.isFetching;
  const demoBatchLoading = demoBatchOptionsQuery.isFetching;
  const usersLoading = usersQuery.isFetching;
  const submissionError = submissionActionError
    ?? (submissionsQuery.error instanceof Error ? submissionsQuery.error.message : null);
  const demoBatchError = demoBatchActionError
    ?? (demoBatchOptionsQuery.error instanceof Error ? demoBatchOptionsQuery.error.message : null);
  const userError = userActionError
    ?? (usersQuery.error instanceof Error ? usersQuery.error.message : null);
  const submissionPageIndex = clampPageIndex(submissions.length, submissionPageIndexInput);
  const userPageIndex = clampPageIndex(users.length, userPageIndexInput);
  const submissionPagination = useMemo(
    () => getPaginationWindow(submissions.length, submissionPageIndex),
    [submissionPageIndex, submissions.length],
  );
  const visibleSubmissions = useMemo(
    () => submissions.slice(submissionPagination.pageStart, submissionPagination.pageEnd),
    [submissionPagination.pageEnd, submissionPagination.pageStart, submissions],
  );
  const userPagination = useMemo(
    () => getPaginationWindow(users.length, userPageIndex),
    [userPageIndex, users.length],
  );
  const visibleUsers = useMemo(
    () => users.slice(userPagination.pageStart, userPagination.pageEnd),
    [userPagination.pageEnd, userPagination.pageStart, users],
  );

  const refreshSubmissions = useCallback(async () => {
    if (!canAccessAdmin) return;
    setSubmissionActionError(null);
    await submissionsQuery.refetch();
  }, [canAccessAdmin, submissionsQuery]);

  const refreshDemoBatchOptions = useCallback(async () => {
    if (!canAccessAdmin) return;
    setDemoBatchActionError(null);
    await demoBatchOptionsQuery.refetch();
  }, [canAccessAdmin, demoBatchOptionsQuery]);

  const refreshUsers = useCallback(async (nextPageToken?: string | null) => {
    if (!canManageUsers) return;
    setUserActionError(null);
    const nextToken = nextPageToken ?? null;
    if (nextToken !== usersPageTokenInput) {
      setUsersPageTokenInput(nextToken);
      setUserPageIndexInput(0);
      return;
    }
    await usersQuery.refetch();
  }, [canManageUsers, usersPageTokenInput, usersQuery]);

  const handleModerationChange = useCallback((entry: AdminSubmissionSummary, moderationState: ModerationState) => {
    if (!canAccessAdmin) return;
    setPendingConfirmation({ kind: "submission", entry, moderationState });
    setConfirmationReason(moderationState === "quarantined" ? entry.moderationReason ?? "" : "");
  }, [canAccessAdmin]);

  const handleToggleDisabled = useCallback((entry: AdminUserSummary) => {
    if (!canManageUsers) return;
    setPendingConfirmation({ kind: "toggleDisabled", entry, nextDisabled: !entry.disabled });
    setConfirmationReason("");
  }, [canManageUsers]);

  const handleSetRoles = useCallback((entry: AdminUserSummary, roles: AdminRole[]) => {
    if (!canManageUsers) return;
    setPendingConfirmation({ kind: "roles", entry, roles });
    setConfirmationReason("");
  }, [canManageUsers]);

  const handleCancelConfirmation = useCallback(() => {
    setPendingConfirmation(null);
    setConfirmationReason("");
  }, []);

  const handleConfirmAction = useCallback(async () => {
    const action = pendingConfirmation;
    if (!action) return;
    const reason = confirmationReason.trim();
    const normalizedReason = reason.length ? reason : undefined;
    setPendingConfirmation(null);
    setConfirmationReason("");

    if (action.kind === "submission") {
      setActionBusyId(`submission:${action.entry.deviceId}:${action.entry.batchId}`);
      setSubmissionActionError(null);
      try {
        await moderateAdminSubmission(action.entry.deviceId, action.entry.batchId, {
          moderationState: action.moderationState,
          reason: normalizedReason,
        });
        await refreshSubmissions();
      }
      catch (err) {
        setSubmissionActionError(err instanceof Error ? err.message : "Unable to update submission moderation.");
      }
      finally {
        setActionBusyId(null);
      }
      return;
    }

    if (action.kind === "toggleDisabled") {
      setActionBusyId(`user:${action.entry.uid}:disabled`);
      setUserActionError(null);
      try {
        await updateAdminUser(action.entry.uid, { disabled: action.nextDisabled, reason: normalizedReason });
        await refreshUsers();
      }
      catch (err) {
        setUserActionError(err instanceof Error ? err.message : "Unable to update user status.");
      }
      finally {
        setActionBusyId(null);
      }
      return;
    }

    setActionBusyId(`user:${action.entry.uid}:roles`);
    setUserActionError(null);
    try {
      await updateAdminUser(action.entry.uid, { roles: action.roles, reason: normalizedReason });
      await refreshUsers();
    }
    catch (err) {
      setUserActionError(err instanceof Error ? err.message : "Unable to update user roles.");
    }
    finally {
      setActionBusyId(null);
    }
  }, [confirmationReason, pendingConfirmation, refreshSubmissions, refreshUsers]);

  const handleDemoBatchChange = useCallback(async (value: string) => {
    if (value === NO_DEMO_BATCH_KEY) return;
    const parsed = decodeBatchKey(value);
    if (!parsed) return;

    setDemoBatchSaving(true);
    setDemoBatchActionError(null);
    setDemoBatchMessage(null);
    try {
      const setting = await setAdminDemoBatch(parsed.deviceId, parsed.batchId);
      queryClient.setQueryData(ADMIN_QUERY_KEYS.demoBatchOptions, {
        batches: demoBatches,
        selectedKey: encodeBatchKey(setting.deviceId, setting.batchId),
      });
      setDemoBatchMessage("Front page demo data updated.");
    }
    catch (err) {
      setDemoBatchActionError(err instanceof Error ? err.message : "Unable to update demo batch.");
    }
    finally {
      setDemoBatchSaving(false);
    }
  }, [demoBatches, queryClient]);

  if (!canAccessAdmin) {
    return (
      <Card>
        <Flex direction="column" gap="2">
          <Heading as="h3" size="4">Admin moderation</Heading>
          <Text color="gray">Moderator access is required.</Text>
        </Flex>
      </Card>
    );
  }

  const confirmCopy = confirmationCopy(pendingConfirmation);

  return (
    <>
      <Dialog.Root open={Boolean(pendingConfirmation)} onOpenChange={(open) => { if (!open) handleCancelConfirmation(); }}>
        <Dialog.Content
          size="3"
          style={{
            width: "min(520px, 96vw)",
            maxWidth: "520px",
          }}
        >
          <Dialog.Title>{confirmCopy.title}</Dialog.Title>
          <Dialog.Description>
            {confirmCopy.description}
          </Dialog.Description>
          <Flex direction="column" gap="2" mt="4">
            <Text as="label" size="2" weight="medium" htmlFor="admin-confirmation-reason">
              Audit reason
            </Text>
            <TextArea
              id="admin-confirmation-reason"
              value={confirmationReason}
              maxLength={500}
              rows={4}
              placeholder="Optional but recommended for audit review."
              onChange={(event) => setConfirmationReason(event.currentTarget.value)}
            />
            <Text size="1" color={confirmationReason.length > 450 ? "tomato" : "gray"}>
              {confirmationReason.length}/500 characters
            </Text>
          </Flex>
          <Flex justify="end" gap="3" mt="5">
            <Dialog.Close>
              <Button variant="soft" color="gray">Cancel</Button>
            </Dialog.Close>
            <Button
              color={confirmCopy.confirmColor}
              onClick={() => { void handleConfirmAction(); }}
            >
              {confirmCopy.confirmLabel}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      <Flex direction="column" gap="5">
      <Card>
        <Flex direction="column" gap="3">
          <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
            <Box>
              <Heading as="h3" size="5">Front Page Demo Data</Heading>
              <Text size="2" color="gray">Choose the approved public batch opened by See Demo Data.</Text>
            </Box>
            <Button onClick={() => { void refreshDemoBatchOptions(); }} disabled={demoBatchLoading || demoBatchSaving}>
              {demoBatchLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </Flex>
          <Box maxWidth="520px">
            <Text size="2" color="gray">Current demo batch</Text>
            <Select.Root
              value={demoBatchKey}
              onValueChange={(value) => { void handleDemoBatchChange(value); }}
              disabled={demoBatchLoading || demoBatchSaving || demoBatches.length === 0}
            >
              <Select.Trigger placeholder="Select demo batch" />
              <Select.Content>
                <Select.Item value={NO_DEMO_BATCH_KEY} disabled>
                  {demoBatches.length ? "Select demo batch" : "No approved public batches"}
                </Select.Item>
                {demoBatches.map((batch) => {
                  const key = encodeBatchKey(batch.deviceId, batch.batchId);
                  return (
                    <Select.Item key={key} value={key}>
                      {formatBatchOption(batch)}
                    </Select.Item>
                  );
                })}
              </Select.Content>
            </Select.Root>
          </Box>
          {demoBatchError ? <Text color="tomato">{demoBatchError}</Text> : null}
          {demoBatchMessage ? <Text color="green">{demoBatchMessage}</Text> : null}
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
            <Heading as="h3" size="5">Submission moderation</Heading>
            <ResultCountControl
              itemLabelSingular="submission"
              itemLabelPlural="submissions"
              pageStart={submissionPagination.pageStart}
              pageEnd={submissionPagination.pageEnd}
              totalCount={submissions.length}
              onShowLess={() => setSubmissionPageIndexInput((current) => current - 1)}
              onShowMore={() => setSubmissionPageIndexInput((current) => current + 1)}
            />
          </Flex>
          <Flex gap="3" wrap="wrap" align="end">
            <Box>
              <Text size="2" color="gray">State</Text>
              <Select.Root value={moderationFilter} onValueChange={(value) => setModerationFilter(value as SubmissionFilterState)}>
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="all">All</Select.Item>
                  <Select.Item value="approved">Approved</Select.Item>
                  <Select.Item value="quarantined">Quarantined</Select.Item>
                </Select.Content>
              </Select.Root>
            </Box>
            <Box>
              <Text size="2" color="gray">Visibility</Text>
              <Select.Root value={visibilityFilter} onValueChange={(value) => setVisibilityFilter(value as VisibilityFilterState)}>
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="all">All</Select.Item>
                  <Select.Item value="public">Public</Select.Item>
                  <Select.Item value="private">Private</Select.Item>
                </Select.Content>
              </Select.Root>
            </Box>
            <Button onClick={() => { void refreshSubmissions(); }} disabled={submissionsLoading}>
              {submissionsLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </Flex>
          {submissionError ? <Text color="tomato">{submissionError}</Text> : null}
          <Separator size="4" />
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Processed</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Device</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Batch</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Visibility</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>State</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visibleSubmissions.map((entry) => {
                const busy = actionBusyId === `submission:${entry.deviceId}:${entry.batchId}`;
                return (
                  <Table.Row key={`${entry.deviceId}:${entry.batchId}`}>
                    <Table.Cell>{formatTimestamp(entry.processedAt)}</Table.Cell>
                    <Table.Cell>{entry.deviceName || entry.deviceId}</Table.Cell>
                    <Table.Cell><Text style={{ fontFamily: "monospace" }}>{entry.batchId}</Text></Table.Cell>
                    <Table.Cell>{entry.visibility}</Table.Cell>
                    <Table.Cell>
                      <Badge color={entry.moderationState === "quarantined" ? "red" : "green"}>
                        {entry.moderationState}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Flex gap="2" wrap="wrap">
                        <Button
                          size="1"
                          variant="soft"
                          disabled={busy || entry.moderationState === "approved"}
                          onClick={() => { void handleModerationChange(entry, "approved"); }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="1"
                          color="tomato"
                          variant="soft"
                          disabled={busy || entry.moderationState === "quarantined"}
                          onClick={() => { void handleModerationChange(entry, "quarantined"); }}
                        >
                          Quarantine
                        </Button>
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
          {!submissions.length && !submissionsLoading ? (
            <Text color="gray">No submissions matched your filter.</Text>
          ) : null}
        </Flex>
      </Card>

      {canManageUsers ? (
        <Card>
          <Flex direction="column" gap="3">
            <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
              <Heading as="h3" size="5">User moderation</Heading>
              <ResultCountControl
                itemLabelSingular="user"
                itemLabelPlural="users"
                pageStart={userPagination.pageStart}
                pageEnd={userPagination.pageEnd}
                totalCount={users.length}
                onShowLess={() => setUserPageIndexInput((current) => current - 1)}
                onShowMore={() => setUserPageIndexInput((current) => current + 1)}
              />
            </Flex>
            <Flex gap="3" wrap="wrap" align="center">
              <Button onClick={() => { void refreshUsers(); }} disabled={usersLoading}>
                {usersLoading ? "Refreshing..." : "Refresh"}
              </Button>
              {usersPageToken ? (
                <Button
                  variant="soft"
                  onClick={() => { void refreshUsers(usersPageToken); }}
                  disabled={usersLoading}
                >
                  Next page
                </Button>
              ) : null}
            </Flex>
            {userError ? <Text color="tomato">{userError}</Text> : null}
            <Separator size="4" />
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>UID</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Roles</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {visibleUsers.map((entry) => {
                  const busyDisabled = actionBusyId === `user:${entry.uid}:disabled`;
                  const busyRoles = actionBusyId === `user:${entry.uid}:roles`;
                  return (
                    <Table.Row key={entry.uid}>
                      <Table.Cell>{entry.email ?? "—"}</Table.Cell>
                      <Table.Cell><Text style={{ fontFamily: "monospace" }}>{entry.uid}</Text></Table.Cell>
                      <Table.Cell>
                        <Flex gap="2" wrap="wrap">
                          {entry.roles.length ? entry.roles.map((role) => (
                            <Badge key={`${entry.uid}:${role}`} color={role === "super_admin" ? "orange" : "blue"}>
                              {normalizeRoleLabel(role)}
                            </Badge>
                          )) : <Text color="gray">None</Text>}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={entry.disabled ? "red" : "green"}>{entry.disabled ? "Disabled" : "Active"}</Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Flex gap="2" wrap="wrap">
                          <Button
                            size="1"
                            variant="soft"
                            color={entry.disabled ? "green" : "tomato"}
                            disabled={busyDisabled}
                            onClick={() => { void handleToggleDisabled(entry); }}
                          >
                            {entry.disabled ? "Enable" : "Disable"}
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            disabled={busyRoles}
                            onClick={() => { void handleSetRoles(entry, ["moderator"]); }}
                          >
                            Set Moderator
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            disabled={busyRoles}
                            onClick={() => { void handleSetRoles(entry, ["super_admin"]); }}
                          >
                            Set Super Admin
                          </Button>
                          <Button
                            size="1"
                            variant="ghost"
                            disabled={busyRoles}
                            onClick={() => { void handleSetRoles(entry, []); }}
                          >
                            Clear Roles
                          </Button>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
            {!users.length && !usersLoading ? (
              <Text color="gray">No users returned from Firebase Auth.</Text>
            ) : null}
          </Flex>
        </Card>
      ) : null}
      </Flex>
    </>
  );
}
