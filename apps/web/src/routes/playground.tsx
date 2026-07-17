import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

function PlaygroundLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/playground")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/" });
    }
  },
  component: PlaygroundLayout,
});
