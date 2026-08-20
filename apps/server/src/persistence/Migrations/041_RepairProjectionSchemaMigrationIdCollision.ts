import * as Effect from "effect/Effect";

import Migration0033 from "./033_ProjectionThreadsSettled.ts";
import Migration0034 from "./034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./036_ProjectionThreadsPinned.ts";
import Migration0037 from "./037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./040_ProjectionProjectFaviconPath.ts";

// Migration IDs 033-040 were previously used by a different schema history,
// so some existing databases recorded those IDs without the current columns.
export default Effect.gen(function* () {
  yield* Migration0033;
  yield* Migration0034;
  yield* Migration0035;
  yield* Migration0036;
  yield* Migration0037;
  yield* Migration0038;
  yield* Migration0039;
  yield* Migration0040;
});
