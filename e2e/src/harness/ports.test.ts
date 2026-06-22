import { describe, expect, it } from "vitest";

import { portPairForOffset } from "./ports.ts";

describe("portPairForOffset", () => {
  it("maps the default dev offset to the standard Kata Code ports", () => {
    expect(portPairForOffset(0)).toEqual({
      serverPort: 13773,
      webPort: 5733,
    });
  });

  it("increments server and web ports together", () => {
    expect(portPairForOffset(5)).toEqual({
      serverPort: 13778,
      webPort: 5738,
    });
  });
});
