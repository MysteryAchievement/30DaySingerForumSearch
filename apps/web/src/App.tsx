import { AppShell, Anchor, Container, Group, Text, Title } from "@mantine/core";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { SearchPage } from "./pages/SearchPage";
import { DiscussionPage } from "./pages/DiscussionPage";
import { ScanPage } from "./pages/ScanPage";

function HeaderLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      style={({ isActive }) => ({
        textDecoration: "none",
        fontWeight: isActive ? 700 : 500,
        color: isActive ? "var(--mantine-color-blue-6)" : "var(--mantine-color-text)"
      })}
    >
      {label}
    </NavLink>
  );
}

export function App() {
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between">
            <Anchor component={Link} to="/" underline="never">
              <Title order={3}>30 Day Singer Forum Search</Title>
            </Anchor>
            <Group gap="lg">
              <HeaderLink to="/" label="Search" />
              <HeaderLink to="/scan" label="Scan" />
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg">
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/discussions/:slug" element={<DiscussionPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route
              path="*"
              element={
                <Text c="dimmed">
                  Page not found. <Anchor component={Link} to="/">Go to search</Anchor>.
                </Text>
              }
            />
          </Routes>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
