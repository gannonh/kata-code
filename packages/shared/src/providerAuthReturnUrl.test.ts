import { describe, expect, it } from "vite-plus/test";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each(["katacode", "katacode-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it("returns to the hosted Kata Code web app", () =>
    expect(providerAuthReturnUrl("https://app.kata.sh/welcome?code=secret")).toBe(
      "https://app.kata.sh/welcome",
    ));
  it.each([
    "katacode://attacker/welcome",
    "katacode://app:123/welcome",
    "katacode://app/auth/callback",
    "katacode://user@ app/welcome",
    "katacode://app/welcome/../evil",
    "https://attacker.example/welcome",
    "t3code://app/welcome",
    "https://app.t3.codes/welcome",
    "file:///welcome",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
