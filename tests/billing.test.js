"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { selectCredential, readClientVersion } = require("../lib/auth");
const {
    normalizeCredits,
    applySettings,
    billingUrl,
    requestHeaders,
    DEFAULT_BASE_URL,
} = require("../lib/billing");
const {
    formatPercent,
    formatRemaining,
    panelText,
    renderText,
    severity,
} = require("../lib/format");

const mixed = JSON.parse(fs.readFileSync(
    path.join(__dirname, "fixtures", "credits-mixed.json"),
    "utf8"));

test("répartit le pool entre chat, build et le reste", () => {
    const snapshot = normalizeCredits({
        config: {
            currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-10-14T15:33:53Z" },
            creditUsagePercent: 46,
            productUsage: [
                { product: "GrokBuild", usagePercent: 24 },
                { product: "GrokChat", usagePercent: 16 },
                { product: "GrokImagine", usagePercent: 4 },
                { product: "Api", usagePercent: 2 },
            ],
        },
    });
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.periodKind, "weekly");
    assert.equal(snapshot.totalPercent, 46);
    assert.deepEqual(snapshot.buckets.map(bucket => [bucket.id, bucket.percent]), [
        ["chat", 16],
        ["build", 24],
        ["other", 6],
    ]);
    assert.deepEqual(
        snapshot.details.filter(row => row.bucket === "other").map(row => row.label),
        ["Imagine", "API"]);
});

test("le total annoncé prime sur la somme des produits", () => {
    const snapshot = normalizeCredits(mixed);
    assert.equal(snapshot.totalPercent, 40);
    assert.equal(snapshot.buckets.find(bucket => bucket.id === "build").percent, 24);
    assert.equal(snapshot.buckets.find(bucket => bucket.id === "chat").percent, 16);
    assert.equal(snapshot.buckets.find(bucket => bucket.id === "other").percent, 0);
});

test("sans pourcentage global, les produits sont additionnés", () => {
    const snapshot = normalizeCredits({
        config: {
            productUsage: [
                { product: "GrokChat", usagePercent: 3.2 },
                { product: "GrokBuild" },
            ],
        },
    });
    assert.equal(snapshot.totalPercent, 3.2);
    assert.equal(snapshot.buckets.find(bucket => bucket.id === "build").percent, 0);
    assert.equal(snapshot.periodKind, "unknown");
});

test("une réponse vide est refusée", () => {
    assert.equal(normalizeCredits(null).ok, false);
    assert.equal(normalizeCredits({}).ok, false);
    assert.equal(normalizeCredits({ config: {} }).ok, false);
    const quiet = normalizeCredits({
        config: { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-10-14T00:00:00Z" } },
    });
    assert.equal(quiet.ok, true);
    assert.equal(quiet.totalPercent, 0);
});

test("le nom du forfait vient des réglages", () => {
    const snapshot = applySettings(normalizeCredits(mixed), {
        subscription_tier_display: "SuperGrok",
    });
    assert.equal(snapshot.plan, "SuperGrok");
});

test("la session auth.x.ai la plus récente est choisie", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const credential = selectCredential({
        "https://accounts.x.ai/sign-in": {
            key: "legacy",
            expires_at: "2026-10-20T00:00:00Z",
            email: "legacy@example.com",
        },
        "https://auth.x.ai::old": {
            key: "old",
            expires_at: "2026-10-14T00:00:00Z",
            email: "old@example.com",
        },
        "https://auth.x.ai::new": {
            key: "new",
            expires_at: "2026-10-18T00:00:00Z",
            email: "new@example.com",
            principal_type: "User",
        },
        "sans-jeton": { email: "nope@example.com" },
    }, now);
    assert.equal(credential.token, "new");
    assert.equal(credential.email, "new@example.com");
    assert.equal(credential.expired, false);
    assert.equal(credential.principalType, "User");
});

test("un jeton expiré est signalé et n'est pas confondu avec une absence de session", () => {
    const credential = selectCredential({
        "https://auth.x.ai::client": {
            key: "expired-token",
            expires_at: "2026-10-01T00:00:00Z",
        },
    }, new Date("2026-10-13T12:00:00Z"));
    assert.equal(credential.expired, true);
    assert.equal(selectCredential({}, new Date()), null);
});

test("la version client vient du fichier local", () => {
    assert.equal(readClientVersion({ version: " 1.2.3 " }, "0"), "1.2.3");
    assert.equal(readClientVersion({}, "1.0.52"), "1.0.52");
});

test("l'URL et les en-têtes visent le proxy CLI", () => {
    assert.equal(billingUrl(""), `${DEFAULT_BASE_URL}/billing?format=credits`);
    assert.equal(
        billingUrl("https://proxy.example/v1/"),
        "https://proxy.example/v1/billing?format=credits");
    const headers = requestHeaders("secret", "9.9.9");
    assert.equal(headers.Authorization, "Bearer secret");
    assert.equal(headers["x-xai-token-auth"], "xai-grok-cli");
    assert.equal(headers["x-grok-client-version"], "9.9.9");
    assert.equal(headers["x-grok-client-surface"], "grok-build");
});

test("le texte distingue chat, build et autres", () => {
    const snapshot = applySettings(normalizeCredits(mixed), {
        subscription_tier_display: "SuperGrok",
    });
    const text = renderText(snapshot, {
        email: "ada@example.com",
        now: new Date("2026-10-13T15:00:00Z"),
        fetchedAt: new Date("2026-10-13T15:00:00Z"),
    });
    assert.match(text, /SuperGrok/);
    assert.match(text, /Chat : 16 %/);
    assert.match(text, /Build : 24 %/);
    assert.match(text, /Autres : 0 %/);
    assert.match(text, /Renouvellement/);
    assert.equal(panelText(snapshot), "40%");
    assert.equal(formatPercent(16.5), "16,5 %");
    assert.equal(severity(40, 70, 90), "ok");
    assert.equal(severity(75, 70, 90), "warn");
    assert.equal(severity(95, 70, 90), "critical");
    assert.equal(formatRemaining("2026-10-14T15:33:53Z", new Date("2026-10-13T15:00:00Z")), "dans 24 h 34 min");
    assert.equal(formatRemaining("2026-10-16T18:00:00Z", new Date("2026-10-13T15:00:00Z")), "dans 3 j 3 h");
});
