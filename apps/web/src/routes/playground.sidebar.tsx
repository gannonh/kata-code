import { createFileRoute } from "@tanstack/react-router";

import { SidebarV2PlaygroundPage } from "../components/sidebar/SidebarV2PlaygroundPage";

export const Route = createFileRoute("/playground/sidebar")({
  component: SidebarV2PlaygroundPage,
});
