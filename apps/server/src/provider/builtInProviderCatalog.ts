import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
} from "@kata-sh/code-contracts";
import type * as Stream from "effect/Stream";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";

export type ProviderSnapshotSource = {
  /**
   * Routing key — uniquely identifies this instance in the aggregated
   * snapshot list. Two different snapshot sources may share the same
   * driver kind (multiple instances of the same driver).
   */
  readonly instanceId: ProviderInstanceId;
  /** Driver implementation kind. */
  readonly driverKind: ProviderDriverKind;
  /**
   * Project driver/adapter-derived capability fields onto a raw snapshot.
   * `getSnapshot`, `refresh`, and `streamChanges` already apply it; consumers
   * that read raw values off `subscribeChanges` must apply it themselves.
   */
  readonly augment: (snapshot: ServerProvider) => ServerProvider;
  readonly getSnapshot: ServerProviderShape["getSnapshot"];
  readonly refresh: ServerProviderShape["refresh"];
  readonly streamChanges: Stream.Stream<ServerProvider>;
  readonly subscribeChanges: ServerProviderShape["subscribeChanges"];
};
