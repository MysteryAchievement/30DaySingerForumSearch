import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title
} from "@mantine/core";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { fetchDiscussion } from "../api";
import type { DiscussionResponse } from "../types";
import { formatDate, formatNumber, highlightHtml } from "../util";

export function DiscussionPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const q = params.get("q");
  const [data, setData] = useState<DiscussionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchDiscussion(slug, q, controller.signal)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (cancelled || (caught as Error).name === "AbortError") return;
        setError((caught as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug, q]);

  if (loading && !data) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (error) {
    return (
      <Stack>
        <Alert color="red" title="Could not load discussion">
          {error}
        </Alert>
        <Anchor component={Link} to="/">
          Back to search
        </Anchor>
      </Stack>
    );
  }

  if (!data) return null;

  const discussion = data.discussion;
  const matchCount = data.posts.filter((post) => post.isMatch).length;
  const backLink = q ? `/?q=${encodeURIComponent(q)}` : "/";
  const clearLink = `/discussions/${encodeURIComponent(discussion.slug)}`;

  return (
    <Stack gap="lg">
      <div>
        <Anchor component={Link} to={backLink} size="sm">
          ← Back to search
        </Anchor>
        <Group justify="space-between" align="flex-start" mt="xs" wrap="nowrap">
          <div>
            <Title order={2}>{discussion.title}</Title>
            <Group gap="xs" mt={8}>
              {discussion.categoryName && (
                <Badge variant="light">{discussion.categoryName}</Badge>
              )}
              {discussion.deletedAt && <Badge color="red">Deleted on forum</Badge>}
              <Text size="sm" c="dimmed">
                Started {formatDate(discussion.createdAt)} ·{" "}
                {formatNumber(discussion.postCount)} post
                {discussion.postCount === 1 ? "" : "s"}
              </Text>
            </Group>
          </div>
          <Anchor href={discussion.url} target="_blank" rel="noreferrer">
            Open on forum
          </Anchor>
        </Group>
      </div>

      {q && (
        <Alert color="blue" title="Highlighted matches">
          Showing matches for “{q}” ({formatNumber(matchCount)} matching post
          {matchCount === 1 ? "" : "s"}).{" "}
          <Anchor component={Link} to={clearLink}>
            Clear highlights
          </Anchor>
        </Alert>
      )}

      <Stack gap="md">
        {data.posts.map((post) => (
          <Paper
            key={post.id}
            withBorder
            p="md"
            radius="md"
            style={
              post.isMatch
                ? { borderLeft: "4px solid var(--mantine-color-yellow-5)" }
                : undefined
            }
          >
            <Group gap="xs" mb={6}>
              <Text fw={600}>{post.author ?? "Unknown author"}</Text>
              <Text size="sm" c="dimmed">
                {formatDate(post.createdAt)}
              </Text>
              {post.editedAt && (
                <Badge size="xs" variant="light" color="gray">
                  Edited
                </Badge>
              )}
              {post.deletedAt && (
                <Badge size="xs" color="red">
                  Deleted on forum
                </Badge>
              )}
            </Group>
            {post.isMatch && q ? (
              <div
                className="post-body"
                dangerouslySetInnerHTML={{ __html: highlightHtml(post.bodyHtml, q) }}
              />
            ) : (
              <div
                className="post-body"
                dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
              />
            )}
            <Divider mt="sm" />
            <Text size="xs" c="dimmed" mt={4}>
              Post #{post.forumPostId}
            </Text>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
