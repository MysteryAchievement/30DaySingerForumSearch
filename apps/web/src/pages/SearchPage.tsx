import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Center,
  Divider,
  Group,
  Highlight,
  Loader,
  Pagination,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { Link, useSearchParams } from "react-router-dom";
import { searchDiscussions } from "../api";
import type { SearchResponse, SearchScope } from "../types";
import { formatDate, formatNumber, highlightTerms } from "../util";

const PAGE_SIZE = 20;

function scopeFromParams(value: string | null): SearchScope {
  return value === "title" || value === "body" ? value : "both";
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const scope = scopeFromParams(params.get("scope"));
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const [input, setInput] = useState(q);
  const [debouncedInput] = useDebouncedValue(input, 350);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateParams = (patch: Record<string, string | null>) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true }
    );
  };

  useEffect(() => {
    const trimmed = debouncedInput.trim();
    if (trimmed === q) return;
    updateParams({ q: trimmed || null, page: "1" });
    // Only react to typing, not to URL changes caused by navigation.
  }, [debouncedInput]);

  useEffect(() => {
    if (!q.trim()) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    searchDiscussions(q, scope, page, PAGE_SIZE, controller.signal)
      .then((result) => {
        if (!cancelled) setResponse(result);
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
  }, [q, scope, page]);

  const terms = useMemo(() => highlightTerms(q), [q]);
  const totalPages = response ? Math.ceil(response.total / response.pageSize) : 0;

  const renderResults = () => {
    if (!q.trim()) {
      return (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed">
            Search discussion titles and post bodies. Supports quoted phrases,{" "}
            <code>or</code>, and <code>-excluded</code> terms.
          </Text>
        </Paper>
      );
    }

    if (loading && !response) {
      return (
        <Center py="xl">
          <Loader />
        </Center>
      );
    }

    if (error) {
      return (
        <Alert color="red" title="Search failed">
          {error}
        </Alert>
      );
    }

    if (response && response.results.length === 0) {
      return (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed">No discussions matched “{response.query}”.</Text>
        </Paper>
      );
    }

    if (!response) return null;

    return (
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {formatNumber(response.total)} discussion
            {response.total === 1 ? "" : "s"} found
          </Text>
          {loading && <Loader size="xs" />}
        </Group>

        {response.results.map((result) => {
          const discussion = result.discussion;
          const discussionLink = `/discussions/${encodeURIComponent(
            discussion.slug
          )}?q=${encodeURIComponent(response.query)}`;

          return (
            <Paper key={discussion.id} withBorder p="md" radius="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div>
                  <Anchor
                    component={Link}
                    to={discussionLink}
                    size="lg"
                    fw={600}
                    underline="hover"
                  >
                    <Highlight highlight={terms}>{discussion.title}</Highlight>
                  </Anchor>
                  <Group gap="xs" mt={6}>
                    {discussion.categoryName && (
                      <Badge variant="light">{discussion.categoryName}</Badge>
                    )}
                    {discussion.deletedAt && <Badge color="red">Deleted on forum</Badge>}
                    <Text size="xs" c="dimmed">
                      Started {formatDate(discussion.createdAt)} ·{" "}
                      {formatNumber(discussion.postCount)} post
                      {discussion.postCount === 1 ? "" : "s"}
                    </Text>
                  </Group>
                </div>
                <Anchor href={discussion.url} target="_blank" rel="noreferrer" size="sm">
                  Original
                </Anchor>
              </Group>

              {result.matches.length > 0 && (
                <>
                  <Divider my="sm" />
                  <Stack gap="sm">
                    {result.matches.map((match) => (
                      <div key={match.postId}>
                        <Text size="xs" c="dimmed" mb={2}>
                          {match.author ?? "Unknown author"} · {formatDate(match.createdAt)}
                        </Text>
                        <div
                          className="snippet"
                          dangerouslySetInnerHTML={{ __html: match.snippet }}
                        />
                      </div>
                    ))}
                  </Stack>
                </>
              )}

              {result.moreCount > 0 && (
                <Anchor component={Link} to={discussionLink} size="sm" mt="xs" display="block">
                  {formatNumber(result.moreCount)} more matching post
                  {result.moreCount === 1 ? "" : "s"}
                </Anchor>
              )}
            </Paper>
          );
        })}

        {totalPages > 1 && (
          <Group justify="center" mt="md">
            <Pagination
              total={totalPages}
              value={page}
              onChange={(nextPage) => updateParams({ page: String(nextPage) })}
            />
          </Group>
        )}
      </Stack>
    );
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Search</Title>
        <Text c="dimmed">Find terms in discussion titles and post bodies.</Text>
      </div>

      <Group align="flex-end" wrap="wrap">
        <TextInput
          label="Search terms"
          placeholder='e.g. vibrato, "breath support", or -beginner'
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const trimmed = event.currentTarget.value.trim();
              updateParams({ q: trimmed || null, page: "1" });
            }
          }}
          style={{ flex: "1 1 320px" }}
        />
        <SegmentedControl
          value={scope}
          onChange={(value) => updateParams({ scope: value, page: "1" })}
          data={[
            { label: "Title + body", value: "both" },
            { label: "Title only", value: "title" },
            { label: "Body only", value: "body" }
          ]}
        />
      </Group>

      {renderResults()}
    </Stack>
  );
}
