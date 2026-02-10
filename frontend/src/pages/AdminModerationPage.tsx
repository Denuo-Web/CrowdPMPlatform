import { useCallback, useEffect, useMemo, useState } from "react";
import { timestampToMillis } from "@crowdpm/types";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Separator,
  Table,
  Text,
} from "@radix-ui/themes";
import {
  listAdminSubmissions,
  listAdminUsers,
  moderateAdminSubmission,
  updateAdminUser,
  type AdminSubmissionSummary,
  type AdminUserSummary,
  type BatchVisibility,
  type ModerationState,
  type AdminRole,
} from "../lib/api";
import { useAuth } from "../providers/AuthProvider";

function formatTimestamp(value: string | null): string {
  const ms = timestampToMillis(value);
  if (ms === null) return "—";
  return new Date(ms).toLocaleString();
}

function normalizeRoleLabel(role: AdminRole): string {
  return role === "super_admin" ? "Super Admin" : "Moderator";
}

type SubmissionFilterState = "all" | ModerationState;
type VisibilityFilterState = "all" | BatchVisibility;

export default function AdminModerationPage() {
  const { user, isModerator, isSuperAdmin } = useAuth();

  const [submissions, setSubmissions] = useState<AdminSubmissionSummary[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [usersPageToken, setUsersPageToken] = useState<string | null>(null);

  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  const [moderationFilter, setModerationFilter] = useState<SubmissionFilterState>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilterState>("all");

  const canAccess = Boolean(user) && isModerator;

  const submissionParams = useMemo(() => ({
    moderationState: moderationFilter === "all" ? undefined : moderationFilter,
    visibility: visibilityFilter === "all" ? undefined : visibilityFilter,
    limit: 100,
  }), [moderationFilter, visibilityFilter]);

  const refreshSubmissions = useCallback(async () => {
    if (!canAccess) return;
    setSubmissionsLoading(true);
    setSubmissionError(null);
    try {
      const list = await listAdminSubmissions(submissionParams);
      setSubmissions(list);
    }
    catch (err) {
      setSubmissionError(err instanceof Error ? err.message : "Unable to load submissions.");
      setSubmissions([]);
    }
    finally {
      setSubmissionsLoading(false);
    }
  }, [canAccess, submissionParams]);

  const refreshUsers = useCallback(async (nextPageToken?: string | null) => {
    if (!canAccess) return;
    setUsersLoading(true);
    setUserError(null);
    try {
      const response = await listAdminUsers({ limit: 100, pageToken: nextPageToken ?? undefined });
      setUsers(response.users);
      setUsersPageToken(response.nextPageToken);
    }
    catch (err) {
      setUserError(err instanceof Error ? err.message : "Unable to load users.");
      setUsers([]);
      setUsersPageToken(null);
    }
    finally {
      setUsersLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess) return;
    void refreshSubmissions();
  }, [canAccess, refreshSubmissions]);

  useEffect(() => {
    if (!canAccess) return;
    void refreshUsers();
  }, [canAccess, refreshUsers]);

  const handleModerationChange = useCallback(async (entry: AdminSubmissionSummary, moderationState: ModerationState) => {
    if (!canAccess) return;
    const reason = moderationState === "quarantined"
      ? window.prompt("Optional moderation reason", entry.moderationReason ?? "")
      : "";
    setActionBusyId(`submission:${entry.deviceId}:${entry.batchId}`);
    setSubmissionError(null);
    try {
      await moderateAdminSubmission(entry.deviceId, entry.batchId, {
        moderationState,
        reason: reason ?? undefined,
      });
      await refreshSubmissions();
    }
    catch (err) {
      setSubmissionError(err instanceof Error ? err.message : "Unable to update submission moderation.");
    }
    finally {
      setActionBusyId(null);
    }
  }, [canAccess, refreshSubmissions]);

  const handleToggleDisabled = useCallback(async (entry: AdminUserSummary) => {
    if (!canAccess) return;
    const nextDisabled = !entry.disabled;
    const reason = window.prompt("Optional moderation reason", "");
    setActionBusyId(`user:${entry.uid}:disabled`);
    setUserError(null);
    try {
      await updateAdminUser(entry.uid, { disabled: nextDisabled, reason: reason ?? undefined });
      await refreshUsers();
    }
    catch (err) {
      setUserError(err instanceof Error ? err.message : "Unable to update user status.");
    }
    finally {
      setActionBusyId(null);
    }
  }, [canAccess, refreshUsers]);

  const handleSetRoles = useCallback(async (entry: AdminUserSummary, roles: AdminRole[]) => {
    if (!canAccess || !isSuperAdmin) return;
    const reason = window.prompt("Optional role change reason", "");
    setActionBusyId(`user:${entry.uid}:roles`);
    setUserError(null);
    try {
      await updateAdminUser(entry.uid, { roles, reason: reason ?? undefined });
      await refreshUsers();
    }
    catch (err) {
      setUserError(err instanceof Error ? err.message : "Unable to update user roles.");
    }
    finally {
      setActionBusyId(null);
    }
  }, [canAccess, isSuperAdmin, refreshUsers]);

  if (!canAccess) {
    return (
      <Card>
        <Flex direction="column" gap="2">
          <Heading as="h3" size="4">Admin moderation</Heading>
          <Text color="gray">Moderator access is required.</Text>
        </Flex>
      </Card>
    );
  }

  return (
    <Flex direction="column" gap="5">
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h3" size="5">Submission moderation</Heading>
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
              {submissions.map((entry) => {
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

      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h3" size="5">User moderation</Heading>
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
              {users.map((entry) => {
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
                        {isSuperAdmin ? (
                          <>
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
                          </>
                        ) : null}
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
    </Flex>
  );
}
