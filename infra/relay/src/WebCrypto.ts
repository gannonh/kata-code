import * as Context from "effect/Context";

export class WebCrypto extends Context.Service<WebCrypto, { readonly subtle: SubtleCrypto }>()(
  "kata-code-relay/WebCrypto",
) {}
