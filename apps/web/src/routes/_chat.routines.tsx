import { createFileRoute } from "@tanstack/react-router";

import { RoutinesPage } from "../features/routines/RoutinesPage";

export const Route = createFileRoute("/_chat/routines")({
  component: RoutinesPage,
});
