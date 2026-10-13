"use strict";

// Forme observée sur GET /v1/billing?format=credits du proxy utilisé par Grok Build.
// Chaque usagePercent est une part du même pool (ils s'additionnent au total).

var DEFAULT_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
var DEFAULT_CLIENT_VERSION = "1.0.52";

var BUCKETS = [
    { id: "chat", label: "Chat" },
    { id: "build", label: "Build" },
    { id: "other", label: "Autres" },
];

var normalizeCredits = function normalizeCredits(payload) {
    const config = payload && payload.config && typeof payload.config === "object"
        ? payload.config
        : payload;
    if (!config || typeof config !== "object" || Array.isArray(config))
        return { ok: false, error: "Réponse de facturation vide." };

    const period = config.currentPeriod && typeof config.currentPeriod === "object"
        ? config.currentPeriod
        : {};
    const periodType = typeof period.type === "string" ? period.type : "";
    let periodKind = "unknown";
    if (periodType.indexOf("WEEKLY") !== -1)
        periodKind = "weekly";
    else if (periodType.indexOf("MONTHLY") !== -1)
        periodKind = "monthly";

    const sums = { chat: 0, build: 0, other: 0 };
    const details = [];
    const products = Array.isArray(config.productUsage) ? config.productUsage : [];
    const reportedEarly = finiteNumber(config.creditUsagePercent);
    const hasSignal = reportedEarly != null
        || products.length > 0
        || periodType.length > 0
        || typeof config.billingPeriodEnd === "string";
    if (!hasSignal)
        return { ok: false, error: "Réponse de facturation vide." };
    for (let i = 0; i < products.length; i++) {
        const item = products[i];
        if (!item || typeof item.product !== "string" || !item.product.trim())
            continue;
        const product = item.product.trim();
        const percent = finiteNumber(item.usagePercent);
        const bucket = bucketFor(product);
        const value = percent == null ? 0 : percent;
        sums[bucket] += value;
        details.push({
            product,
            label: labelForProduct(product),
            bucket,
            percent: round1(value),
        });
    }

    const reported = reportedEarly;
    const summed = sums.chat + sums.build + sums.other;
    const total = reported == null ? summed : reported;
    const buckets = BUCKETS.map(bucket => ({
        id: bucket.id,
        label: bucket.label,
        percent: round1(sums[bucket.id]),
    }));

    return {
        ok: true,
        periodKind,
        periodLabel: periodLabel(periodKind),
        periodStart: stringOr(period.start, config.billingPeriodStart),
        periodEnd: stringOr(period.end, config.billingPeriodEnd),
        totalPercent: round1(total),
        buckets,
        details,
        prepaidCents: centValue(config.prepaidBalance),
        onDemandCapCents: centValue(config.onDemandCap),
        onDemandUsedCents: centValue(config.onDemandUsed),
        plan: null,
    };
};

var applySettings = function applySettings(snapshot, settings) {
    if (!snapshot || !snapshot.ok)
        return snapshot;
    const plan = settings && typeof settings.subscription_tier_display === "string"
        ? settings.subscription_tier_display.trim()
        : "";
    return Object.assign({}, snapshot, { plan: plan || null });
};

var billingUrl = function billingUrl(base) {
    return `${stripBase(base)}/billing?format=credits`;
};

var settingsUrl = function settingsUrl(base) {
    return `${stripBase(base)}/settings`;
};

var requestHeaders = function requestHeaders(token, version) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-version": version || DEFAULT_CLIENT_VERSION,
        "x-grok-client-surface": "grok-build",
    };
};

function bucketFor(product) {
    if (product === "GrokChat" || product === "Chat")
        return "chat";
    if (product === "GrokBuild" || product === "Build")
        return "build";
    const lower = product.toLowerCase();
    if (lower.indexOf("chat") !== -1)
        return "chat";
    if (lower.indexOf("build") !== -1)
        return "build";
    return "other";
}

function labelForProduct(product) {
    const known = {
        GrokChat: "Grok Chat",
        GrokBuild: "Grok Build",
        GrokImagine: "Imagine",
        GrokTasks: "Tâches",
        Api: "API",
    };
    if (known[product])
        return known[product];
    return product.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function periodLabel(kind) {
    if (kind === "weekly")
        return "Hebdomadaire";
    if (kind === "monthly")
        return "Mensuel";
    return "Période en cours";
}

function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function centValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (value && typeof value === "object" && finiteNumber(value.val) != null)
        return value.val;
    return null;
}

function stringOr(primary, fallback) {
    if (typeof primary === "string" && primary)
        return primary;
    if (typeof fallback === "string" && fallback)
        return fallback;
    return null;
}

function round1(value) {
    return Math.round(value * 10) / 10;
}

function stripBase(base) {
    const raw = typeof base === "string" && base.trim() ? base.trim() : DEFAULT_BASE_URL;
    return raw.replace(/\/+$/, "");
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DEFAULT_BASE_URL,
        DEFAULT_CLIENT_VERSION,
        BUCKETS,
        normalizeCredits,
        applySettings,
        billingUrl,
        settingsUrl,
        requestHeaders,
    };
}
