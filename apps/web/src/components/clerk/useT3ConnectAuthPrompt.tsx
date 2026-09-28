import { useClerk } from "@clerk/react";

import { isElectron } from "../../env";
import { openT3ConnectEarlyAccess, openT3ConnectSignIn } from "./earlyAccess";

export function useT3ConnectAuthPrompt() {
  const clerk = useClerk();
  return {
    openEarlyAccess: () => openT3ConnectEarlyAccess(clerk),
    openSignIn: () => openT3ConnectSignIn(clerk, window.location.href, isElectron),
  };
}
