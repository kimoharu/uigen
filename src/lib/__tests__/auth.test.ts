import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";

// Mock server-only so it doesn't throw in test environment
vi.mock("server-only", () => ({}));

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

// Cookie store mock shared across tests
const mockCookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

// Import after mocks are set up
const { createSession, getSession, deleteSession, verifySession } = await import("@/lib/auth");

async function makeToken(payload: object, expiresIn = "7d") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe("createSession", () => {
  test("sets an httpOnly cookie named auth-token", async () => {
    await createSession("user-1", "test@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name, , options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  test("cookie value is a valid JWT containing userId and email", async () => {
    await createSession("user-42", "hello@example.com");

    const [, token] = mockCookieStore.set.mock.calls[0];
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, JWT_SECRET);

    expect(payload.userId).toBe("user-42");
    expect(payload.email).toBe("hello@example.com");
  });

  test("cookie expires roughly 7 days from now", async () => {
    const before = Date.now();
    await createSession("user-1", "test@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const expires: Date = options.expires;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------
describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns the session payload for a valid token", async () => {
    const payload = {
      userId: "user-99",
      email: "valid@example.com",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    const token = await makeToken(payload);
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session?.userId).toBe("user-99");
    expect(session?.email).toBe("valid@example.com");
  });

  test("returns null for an expired token", async () => {
    const token = await makeToken({ userId: "u", email: "e@e.com" }, "-1s");
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).toBeNull();
  });

  test("returns null for a tampered token", async () => {
    const token = "invalid.jwt.token";
    mockCookieStore.get.mockReturnValue({ value: token });

    const session = await getSession();
    expect(session).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------
describe("deleteSession", () => {
  test("deletes the auth-token cookie", async () => {
    await deleteSession();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

// ---------------------------------------------------------------------------
// verifySession
// ---------------------------------------------------------------------------
describe("verifySession", () => {
  function makeRequest(token?: string) {
    const url = "http://localhost/api/test";
    const headers: HeadersInit = token ? { cookie: `auth-token=${token}` } : {};
    return new NextRequest(url, { headers });
  }

  test("returns null when no cookie is in the request", async () => {
    const req = makeRequest();
    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns the session payload for a valid token", async () => {
    const token = await makeToken({
      userId: "req-user",
      email: "req@example.com",
      expiresAt: new Date(),
    });
    const req = makeRequest(token);

    const session = await verifySession(req);
    expect(session?.userId).toBe("req-user");
    expect(session?.email).toBe("req@example.com");
  });

  test("returns null for an expired token", async () => {
    const token = await makeToken({ userId: "u", email: "e@e.com" }, "-1s");
    const req = makeRequest(token);

    const session = await verifySession(req);
    expect(session).toBeNull();
  });

  test("returns null for a tampered token", async () => {
    const req = makeRequest("bad.jwt.token");
    const session = await verifySession(req);
    expect(session).toBeNull();
  });
});
