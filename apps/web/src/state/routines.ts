import { createRoutineEnvironmentAtoms } from "@kata-sh/code-client-runtime/state/routines";

import { connectionAtomRuntime } from "../connection/runtime";

export const routineEnvironment = createRoutineEnvironmentAtoms(connectionAtomRuntime);
