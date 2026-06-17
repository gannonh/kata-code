import { Redirect, useLocalSearchParams } from "expo-router";
import type { EnvironmentId, ThreadId } from "@kata-sh/code-contracts";

export default function ReviewRoute() {
  const { environmentId, threadId } = useLocalSearchParams<{
    environmentId: EnvironmentId;
    threadId: ThreadId;
  }>();

  return (
    <Redirect
      href={{
        pathname: "/threads/[environmentId]/[threadId]/review",
        params: { environmentId, threadId },
      }}
    />
  );
}
