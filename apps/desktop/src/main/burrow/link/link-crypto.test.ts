import { describe, expect, it } from "vitest";
import { channelFor, deriveKeys, newIdentity, open, qrText, seal } from "./link-crypto.js";

// The shared test vector the iOS and Android apps also pass (gente-mobile-proof).
const vector = {
  phonePub: "E75P6uryBMf9M1j8nAByGIHRdCeBKCJ-xnTzf3_pe20",
  deskPriv: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk",
  deskPub: "V9tLNZ8jrl4Ubk4lEgVnBHIlBjSMFQwUdT0Mkz0E1CE",
  secret: "AwMDAwMDAwMDAwMDAwMDAw",
  channel: "UGc4KUkZ0ciLlDPeQEOJi7",
  code: "6488",
  plain:
    '{"type":"sync.chat","id":"c1","title":"From the desktop","updatedAt":1795000000000,"messages":[{"id":"m1","role":"user","text":"hola desde la compu","createdAt":1795000000000,"ranOn":"desktop"}]}',
  envelope: {
    v: 1 as const,
    from: "desktop" as const,
    seq: 5,
    n: "AQEBAQEBAQEBAQEB",
    ct: "Z8MueWiJsQGTf0sj-c2uZIbD7NA7gWQx10jaaMuGfbFy-wWt52Doq7GpDZ_Zzt5g_c3-m7fpwc2Mg06QuU5RnBxlQ9FbNvZ1MTiGZiSyHWp_KTwn7w2QAb5eYdw5lvkw52n8U9IofafOBzk04btGYuVt2TTcB-oONmkMdlcxWJ12lCxxbax0eaw7d_pbvkJW26SquEA6s2vgma0buKygOXNPW9tbmHPXO0v4fHn6cCcMyxWHM8sNHVVtfIjLcRpLng8TJY58pX3QlVUV9f3KyGec8Q",
  },
};

describe("Gente Link v1 (desktop)", () => {
  it("matches the shared test vector: channel, safety code and a sealed envelope byte for byte", () => {
    const identity = {
      privateKey: vector.deskPriv,
      publicKey: vector.deskPub,
      secret: vector.secret,
      desktopId: "mac-x",
    };
    expect(channelFor(vector.secret)).toBe(vector.channel);
    const keys = deriveKeys(identity, vector.phonePub);
    expect(keys.code).toBe(vector.code);
    const sealed = seal(
      keys.d2p,
      vector.channel,
      5,
      JSON.parse(vector.plain),
      Buffer.from(vector.envelope.n, "base64url"),
    );
    expect(sealed).toEqual(vector.envelope);
  });

  it("refuses a tampered envelope", () => {
    const identity = {
      privateKey: vector.deskPriv,
      publicKey: vector.deskPub,
      secret: vector.secret,
      desktopId: "mac-x",
    };
    const keys = deriveKeys(identity, vector.phonePub);
    const bad = { ...vector.envelope, seq: 6 };
    expect(() => open(keys.d2p, vector.channel, bad)).toThrow();
    expect(open(keys.d2p, vector.channel, vector.envelope)).toMatchObject({
      type: "sync.chat",
      id: "c1",
    });
  });

  it("makes a fresh identity and the QR text the phones read", () => {
    const id = newIdentity();
    expect(Buffer.from(id.publicKey, "base64url")).toHaveLength(32);
    expect(qrText(id, "Santi's Mac")).toMatch(
      /^gente:\/\/link\?v=1&id=mac-[0-9a-f]{8}&name=Santi's%20Mac&pk=[\w-]{43}&s=[\w-]{22}$/,
    );
  });
});
