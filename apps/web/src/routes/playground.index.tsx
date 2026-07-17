import { createFileRoute } from "@tanstack/react-router";

import { PlaygroundIndexPage } from "../components/playground/PlaygroundIndexPage";

export const Route = createFileRoute("/playground/")({
  component: PlaygroundIndexPage,
});
