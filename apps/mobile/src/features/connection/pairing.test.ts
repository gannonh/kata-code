import { describe, expect, it } from "vite-plus/test";

import { buildPairingUrl, extractPairingUrlFromQrPayload, parsePairingUrl } from "./pairing";

describe("extractPairingUrlFromQrPayload", () => {
  it("trims raw pairing urls from qr payloads", () => {
    expect(
      extractPairingUrlFromQrPayload("  https://remote.example.com/pair#token=pairing-token  "),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });

  it("unwraps mobile deep links that carry an encoded pairing url", () => {
    expect(
      extractPairingUrlFromQrPayload(
        "katacode://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
      ),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });

  it("rejects empty qr payloads", () => {
    expect(() => extractPairingUrlFromQrPayload("   ")).toThrow(
      "Scanned QR code did not contain a pairing URL.",
    );
  });
});

describe("buildPairingUrl", () => {
  it("defaults loopback hosts to http for local katacode serve", () => {
    expect(buildPairingUrl("localhost:3773", "PAIRCODE")).toBe(
      "http://localhost:3773/#token=PAIRCODE",
    );
    expect(buildPairingUrl("127.0.0.1:3773", "PAIRCODE")).toBe(
      "http://127.0.0.1:3773/#token=PAIRCODE",
    );
  });

  it("keeps explicit remote schemes and uses https for non-loopback hosts", () => {
    expect(buildPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/#token=PAIRCODE",
    );
    expect(buildPairingUrl("desktop.example.com:8443", "PAIRCODE")).toBe(
      "https://desktop.example.com:8443/#token=PAIRCODE",
    );
  });
});

describe("parsePairingUrl", () => {
  it("reads hosted pairing links into backend host fields", () => {
    expect(
      parsePairingUrl(
        "https://app.kata.sh/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=pairing-token",
      ),
    ).toEqual({
      host: "https://desktop.tailnet.ts.net",
      code: "pairing-token",
    });
  });
});
