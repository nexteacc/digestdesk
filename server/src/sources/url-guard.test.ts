import { describe, it, expect } from "vitest";
import { assertPublicUrl } from "./url-guard.js";

/**
 * These cases use IP literals and `localhost`, which are checked WITHOUT a DNS
 * lookup, so the tests are deterministic and never touch the network.
 */
describe("assertPublicUrl", () => {
  it("rejects loopback IPv4", async () => {
    await expect(assertPublicUrl("http://127.0.0.1")).rejects.toThrow();
  });

  it("rejects the cloud metadata address", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow();
  });

  it("rejects the 10.0.0.0/8 private range", async () => {
    await expect(assertPublicUrl("http://10.0.0.1")).rejects.toThrow();
  });

  it("rejects the 172.16.0.0/12 private range", async () => {
    await expect(assertPublicUrl("http://172.16.0.1")).rejects.toThrow();
  });

  it("rejects the 192.168.0.0/16 private range", async () => {
    await expect(assertPublicUrl("http://192.168.1.1")).rejects.toThrow();
  });

  it("rejects IPv6 loopback", async () => {
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
  });

  it("rejects the full IPv6 link-local range", async () => {
    await expect(assertPublicUrl("http://[fe90::1]/")).rejects.toThrow();
    await expect(assertPublicUrl("http://[febf::1]/")).rejects.toThrow();
  });

  it("rejects normalized hexadecimal IPv4-mapped IPv6 loopback", async () => {
    await expect(assertPublicUrl("http://[::ffff:7f00:1]/")).rejects.toThrow();
  });

  it("rejects alternate IPv4 loopback URL notation after URL normalization", async () => {
    await expect(assertPublicUrl("http://2130706433/")).rejects.toThrow();
    await expect(assertPublicUrl("http://0x7f000001/")).rejects.toThrow();
  });

  it("rejects the localhost hostname", async () => {
    await expect(assertPublicUrl("http://localhost:3000")).rejects.toThrow();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicUrl("ftp://example.com")).rejects.toThrow();
  });

  it("rejects malformed URLs", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toThrow();
  });

  it("allows a public IPv4 literal and returns the parsed URL", async () => {
    const url = await assertPublicUrl("http://8.8.8.8/feed");
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe("8.8.8.8");
  });

  it("allows a public IPv4 literal over https", async () => {
    await expect(assertPublicUrl("https://1.1.1.1")).resolves.toBeInstanceOf(URL);
  });
});
