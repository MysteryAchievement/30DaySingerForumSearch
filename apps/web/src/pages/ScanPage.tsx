import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title
} from "@mantine/core";
import { Link } from "react-router-dom";
import { fetchScanProgress, fetchScanStatus, startScan } from "../api";
import type { ScanProgress, ScanRunRow, ScanStatusResponse } from "../types";
import { formatDate, formatNumber } from "../util";

function statusColor(status: ScanRunRow["status"]): string {
  if (status === "succeeded") return "green";
  if (status === "failed") return "red";
  return "blue";
}

function progressValue(progress: ScanProgress): number {
  if (progress.phase === "finished") return 100;
  if (progress.phase === "index" && progress.pagesTotal) {
    return Math.min(100, (progress.pagesFetched / progress.pagesTotal) * 100);
  }
  if (progress.threadsTotal > 0) {
    return Math.min(100, (progress.threadsDone / progress.threadsTotal) * 100);
  }
  return 0;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text size="xl" fw={700}>
        {typeof value === "number" ? formatNumber(value) : value}
      </Text>
    </Card>
  );
}

export function ScanPage() {
  const [status, setStatus] = useState<ScanStatusResponse | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await fetchScanStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchScanStatus(), fetchScanProgress()])
      .then(([nextStatus, nextProgress]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setProgress(nextProgress);
        if (nextProgress.running) setPolling(true);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const nextProgress = await fetchScanProgress();
        if (cancelled) return;
        setProgress(nextProgress);
        if (!nextProgress.running) {
          setPolling(false);
          await refreshStatus();
        }
      } catch (caught: unknown) {
        if (!cancelled) setError((caught as Error).message);
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [polling, refreshStatus]);

  const busy =
    starting ||
    polling ||
    Boolean(progress?.running) ||
    status?.lastRun?.status === "running";

  const onScan = async () => {
    setStarting(true);
    setError(null);
    try {
      await startScan();
      setPolling(true);
      setProgress(await fetchScanProgress());
    } catch (caught: unknown) {
      setError((caught as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const lastRun = status?.lastRun ?? null;
  const latestPost = status?.latestPost ?? null;
  const activeKind = progress?.running ? progress.kind : lastRun?.kind;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Scan</Title>
          <Text c="dimmed">
            Check the forum index for new discussions, replies, edits, and deletions.
          </Text>
        </div>
        <Button onClick={() => void onScan()} loading={starting} disabled={busy}>
          Scan for new posts
        </Button>
      </Group>

      {error && (
        <Alert color="red" title="Scan error" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {(progress?.running || (lastRun?.status === "running" && !progress?.running)) && (
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb={6}>
            <Text fw={600}>
              {activeKind === "full" ? "Full crawl" : "Quick scan"} running
            </Text>
            <Text size="sm" c="dimmed">
              {progress?.message ?? "Scan in progress"}
            </Text>
          </Group>
          <Progress
            value={progress?.running ? progressValue(progress) : 100}
            animated
            striped={!progress?.running}
          />
          {progress?.running && (
            <Group gap="lg" mt="sm">
              <Text size="sm">
                Index pages: {progress.pagesFetched}
                {progress.pagesTotal ? ` / ${progress.pagesTotal}` : ""}
              </Text>
              <Text size="sm">
                Threads: {formatNumber(progress.threadsDone)} /{" "}
                {formatNumber(progress.threadsTotal)}
              </Text>
              <Text size="sm">New posts: {formatNumber(progress.postsNew)}</Text>
            </Group>
          )}
        </Paper>
      )}

      {progress?.phase === "failed" && progress.error && (
        <Alert color="red" title="Last scan failed">
          {progress.error}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Discussions" value={status?.totals.discussions ?? 0} />
        <Stat label="Posts" value={status?.totals.posts ?? 0} />
        <Stat label="Categories" value={status?.totals.categories ?? 0} />
        <Stat
          label="Deleted on forum"
          value={
            (status?.totals.deletedDiscussions ?? 0) + (status?.totals.deletedPosts ?? 0)
          }
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="sm">
            Latest post
          </Title>
          {latestPost ? (
            <Stack gap={4}>
              <Text>
                Post #{latestPost.forumPostId} by {latestPost.author ?? "unknown author"}
              </Text>
              <Text size="sm" c="dimmed">
                {formatDate(latestPost.createdAt)}
              </Text>
              <Anchor
                component={Link}
                to={`/discussions/${encodeURIComponent(latestPost.discussionSlug)}`}
              >
                {latestPost.discussionTitle}
              </Anchor>
              <Anchor href={latestPost.url} target="_blank" rel="noreferrer" size="sm">
                Open thread on forum
              </Anchor>
            </Stack>
          ) : (
            <Text c="dimmed">No posts crawled yet.</Text>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Title order={4} mb="sm">
            Last scan
          </Title>
          {lastRun ? (
            <Stack gap={4}>
              <Group gap="xs">
                <Badge color={statusColor(lastRun.status)}>{lastRun.status}</Badge>
                <Badge variant="light">{lastRun.kind}</Badge>
              </Group>
              <Text size="sm">Started {formatDate(lastRun.startedAt)}</Text>
              <Text size="sm">Finished {formatDate(lastRun.finishedAt)}</Text>
              <Text size="sm">
                New discussions {formatNumber(lastRun.discussionsNew)} · updated{" "}
                {formatNumber(lastRun.discussionsUpdated)} · posts new{" "}
                {formatNumber(lastRun.postsNew)} · edited{" "}
                {formatNumber(lastRun.postsEdited)} · deleted{" "}
                {formatNumber(lastRun.postsDeleted)}
              </Text>
              {lastRun.error && (
                <Text size="sm" c="red">
                  {lastRun.error}
                </Text>
              )}
            </Stack>
          ) : (
            <Text c="dimmed">No scans have run yet.</Text>
          )}
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">
          Posts found in the latest scan
        </Title>
        {status && status.latestScanPosts.length > 0 ? (
          <Table.ScrollContainer minWidth={640}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Post</Table.Th>
                  <Table.Th>Author</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Discussion</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {status.latestScanPosts.map((post) => (
                  <Table.Tr key={post.id}>
                    <Table.Td>#{post.forumPostId}</Table.Td>
                    <Table.Td>{post.author ?? "unknown"}</Table.Td>
                    <Table.Td>{formatDate(post.createdAt)}</Table.Td>
                    <Table.Td>
                      <Anchor
                        component={Link}
                        to={`/discussions/${encodeURIComponent(post.discussionSlug)}`}
                      >
                        {post.discussionTitle}
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text c="dimmed">No new posts recorded in the latest scan.</Text>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">
          Scan history
        </Title>
        {status && status.history.length > 0 ? (
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Pages</Table.Th>
                  <Table.Th>New discussions</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th>Posts +</Table.Th>
                  <Table.Th>Posts edited</Table.Th>
                  <Table.Th>Posts deleted</Table.Th>
                  <Table.Th>Max post ID</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {status.history.map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>{formatDate(run.startedAt)}</Table.Td>
                    <Table.Td>{run.kind}</Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(run.status)}>{run.status}</Badge>
                    </Table.Td>
                    <Table.Td>{formatNumber(run.pagesFetched)}</Table.Td>
                    <Table.Td>{formatNumber(run.discussionsNew)}</Table.Td>
                    <Table.Td>{formatNumber(run.discussionsUpdated)}</Table.Td>
                    <Table.Td>{formatNumber(run.postsNew)}</Table.Td>
                    <Table.Td>{formatNumber(run.postsEdited)}</Table.Td>
                    <Table.Td>{formatNumber(run.postsDeleted)}</Table.Td>
                    <Table.Td>
                      {run.maxForumPostId === null ? "—" : formatNumber(run.maxForumPostId)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text c="dimmed">No scans have run yet.</Text>
        )}
      </Paper>
    </Stack>
  );
}
