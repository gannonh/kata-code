import { createFileRoute, redirect } from "@tanstack/react-router";

import { SidebarV2PlaygroundPage } from "../components/sidebar/SidebarV2PlaygroundPage";

export const Route = createFileRoute("/playground/sidebar")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw redirect({ to: "/" });
    }
  },
  component: SidebarV2PlaygroundPage,
});
