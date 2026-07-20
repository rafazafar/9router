import { describe, expect, it } from "vitest";
import { pickVerifiedOidcEmail } from "@/lib/auth/oidc.js";

describe("multi-user OIDC invitations", () => {
  it("accepts only explicitly verified invite email claims", () => {
    expect(pickVerifiedOidcEmail({ email: "member@example.com", email_verified: true })).toBe("member@example.com");
    expect(pickVerifiedOidcEmail({ email: "member@example.com", email_verified: false })).toBe("");
    expect(pickVerifiedOidcEmail({ email: "member@example.com" })).toBe("");
  });
});
