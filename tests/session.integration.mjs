import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

test(
  "refresh rotation never extends the absolute session lifetime",
  { skip: !process.env.DATABASE_URL },
  async () => {
    process.env.JWT_SECRET ??= "test_secret_at_least_32_characters_long";
    process.env.CACHE_ENABLED = "false";
    process.env.RATE_LIMIT_STORE = "memory";
    const { app } = await import("../dist/app.js");
    const { prisma } = await import("../dist/config/prisma.js");
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const email = `lifetime_${randomUUID()}@example.test`;
    const lifetimes = async (raw) => {
      const token = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: createHash("sha256").update(raw).digest("hex") },
        include: { family: true },
      });
      return {
        family: token.family.expiresAt - token.createdAt,
        token: token.expiresAt - token.createdAt,
        familyExpiresAt: token.family.expiresAt.getTime(),
        familyId: token.familyId,
      };
    };
    const day = 86400000;
    try {
      assert.equal(
        (
          await post("/api/auth/register", {
            email,
            password: "strong-pass-123",
          })
        ).status,
        201,
      );
      const login = await post("/api/auth/login", {
        email,
        password: "strong-pass-123",
      });
      assert.equal(login.status, 200);
      const first = (await login.json()).data.refreshToken;
      const issued = await lifetimes(first);
      assert.ok(Math.abs(issued.family - 90 * day) < 60000);
      assert.ok(Math.abs(issued.token - 30 * day) < 60000);
      const rotated = await post("/api/auth/refresh", { refreshToken: first });
      assert.equal(rotated.status, 200);
      const second = (await rotated.json()).data.refreshToken;
      const after = await lifetimes(second);
      assert.equal(after.familyExpiresAt, issued.familyExpiresAt);
      await prisma.refreshFamily.update({
        where: { id: after.familyId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await post("/api/auth/refresh", { refreshToken: second });
      assert.equal(expired.status, 401);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await prisma.user.deleteMany({ where: { email } });
      await prisma.$disconnect();
    }
  },
);
