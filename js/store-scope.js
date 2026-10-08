/*
 * FEU Canteen POS - multi-store data scoping
 * ------------------------------------------------------------
 * MUST be loaded BEFORE js/app.js (and before any page script).
 *
 * What it does
 *  1. Every store (tenant) gets its own private data. All "feuCanteen*" keys
 *     (inventory, sales, customers, settings, ...) are transparently stored as
 *     "feuStore:<storeId>:<key>" for the logged-in store owner / cashier,
 *     so the existing pages keep working without any change.
 *  2. Users are shared in one global list ("feuCanteenUsers"), but a store
 *     owner only ever sees / edits the users of their own store.
 *  3. Seeds the Superadmin account + a default store, and migrates data from
 *     the old single-store version into "STORE-1" (one-time).
 *
 * Global (never scoped) keys: session, users, stores, migration flag.
 */
(function () {
    "use strict";

    if (window.__feuStoreScope) { return; }

    var SESSION_KEY = "feuCanteenSession";
    var USERS_KEY = "feuCanteenUsers";
    var STORES_KEY = "feuCanteenStores";
    var MIGRATED_KEY = "feuCanteenMultiStoreV1";
    var GLOBAL_KEYS = [SESSION_KEY, USERS_KEY, STORES_KEY, MIGRATED_KEY];
    var PREFIX = "feuCanteen";
    var SCOPE_PREFIX = "feuStore:";
    var DEFAULT_STORE_ID = "STORE-1";

    var ls = window.localStorage;
    var proto = Storage.prototype;
    var rawGet = proto.getItem;
    var rawSet = proto.setItem;
    var rawRemove = proto.removeItem;
    var rawKey = proto.key;

    function rget(key) { return rawGet.call(ls, key); }
    function rset(key, value) { return rawSet.call(ls, key, value); }
    function rremove(key) { return rawRemove.call(ls, key); }

    function lower(value) { return String(value || "").toLowerCase(); }

    function readJSON(key, fallback) {
        try {
            var parsed = JSON.parse(rget(key));
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    }

    function currentMonth() {
        var now = new Date();
        return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    }

    function readSession() {
        return readJSON(SESSION_KEY, null);
    }

    function isSuper(session) { return !!session && lower(session.role) === "superadmin"; }

    /* Store whose data is being used. Superadmin = the store they chose to manage. */
    function activeStoreId() {
        var session = readSession();
        if (!session) { return null; }
        if (isSuper(session)) { return session.viewStoreId || null; }
        return session.storeId || null;
    }

    /* Only a store owner / cashier is limited to the users of their own store. */
    function ownStoreId() {
        var session = readSession();
        if (!session || isSuper(session)) { return null; }
        return session.storeId || null;
    }

    function scopedName(key) {
        var storeId = activeStoreId();
        if (!storeId || typeof key !== "string") { return key; }
        if (key.indexOf(PREFIX) !== 0 || GLOBAL_KEYS.indexOf(key) !== -1) { return key; }
        return SCOPE_PREFIX + storeId + ":" + key;
    }

    /* ---------- one-time seed + migration (runs before the overrides) ---------- */

    function ensureSuperadmin(users) {
        var exists = users.some(function (user) { return lower(user && user.role) === "superadmin"; });
        if (!exists) {
            users.unshift({
                id: "USR-SUPERADMIN",
                name: "School Administrator",
                username: "superadmin",
                password: "superadmin123",
                role: "Superadmin",
                status: "active",
                storeId: null
            });
            return true;
        }
        return false;
    }

    function migrate() {
        var users = readJSON(USERS_KEY, []);
        var stores = readJSON(STORES_KEY, []);
        if (!Array.isArray(users)) { users = []; }
        if (!Array.isArray(stores)) { stores = []; }

        var changed = false;

        if (!rget(MIGRATED_KEY)) {
            /* default store keeps the old single-store data and logins working */
            if (!stores.length) {
                var firstAdmin = users.filter(function (user) { return lower(user && user.role) === "administrator"; })[0];
                stores.push({
                    id: DEFAULT_STORE_ID,
                    name: "FEU Canteen - Store 1",
                    ownerName: (firstAdmin && firstAdmin.name) || "Canteen Owner",
                    monthlyRent: 5000,
                    dueDay: 5,
                    startMonth: currentMonth(),
                    status: "active",
                    createdAt: new Date().toISOString(),
                    payments: []
                });
            }

            if (!users.some(function (user) { return lower(user && user.role) !== "superadmin"; })) {
                users.push(
                    { id: "USR-ADMIN", name: "Canteen Owner", username: "admin", password: "admin123", role: "Administrator", status: "active" },
                    { id: "USR-STAFF", name: "Canteen Staff", username: "staff", password: "staff123", role: "Staff", status: "active" }
                );
            }

            users.forEach(function (user) {
                if (user && lower(user.role) !== "superadmin" && !user.storeId) {
                    user.storeId = stores[0].id;
                }
            });

            /* move the old unscoped data into the default store */
            var legacyKeys = [];
            for (var i = 0; i < ls.length; i++) {
                var name = rawKey.call(ls, i);
                if (name && name.indexOf(PREFIX) === 0 && GLOBAL_KEYS.indexOf(name) === -1) {
                    legacyKeys.push(name);
                }
            }
            legacyKeys.forEach(function (name) {
                var target = SCOPE_PREFIX + stores[0].id + ":" + name;
                if (rget(target) === null) { rset(target, rget(name)); }
                rremove(name);
            });

            rset(STORES_KEY, JSON.stringify(stores));
            rset(MIGRATED_KEY, "1");
            changed = true;
        }

        if (ensureSuperadmin(users)) { changed = true; }

        if (changed) { rset(USERS_KEY, JSON.stringify(users)); }

        /* an already-logged-in session from the old version gets its store id */
        var session = readSession();
        if (session && lower(session.role) !== "superadmin" && !session.storeId) {
            var owner = users.filter(function (user) { return user && user.id === session.id; })[0];
            if (owner && owner.storeId) {
                session.storeId = owner.storeId;
                rset(SESSION_KEY, JSON.stringify(session));
            }
        }
    }

    try { migrate(); } catch (error) { /* never block the page */ }

    /* ---------- storage overrides ---------- */

    proto.getItem = function (key) {
        if (this !== ls) { return rawGet.call(this, key); }

        var storeId = ownStoreId();
        if (storeId && key === USERS_KEY) {
            var all = readJSON(USERS_KEY, []);
            if (!Array.isArray(all)) { all = []; }
            return JSON.stringify(all.filter(function (user) { return user && user.storeId === storeId; }));
        }
        return rawGet.call(this, scopedName(key));
    };

    proto.setItem = function (key, value) {
        if (this !== ls) { return rawSet.call(this, key, value); }

        if (key === USERS_KEY && isSuper(readSession())) {
            /* superadmin manages every account; new store accounts get the store being managed */
            var viewing = activeStoreId();
            try {
                var list = JSON.parse(value);
                if (Array.isArray(list) && viewing) {
                    list.forEach(function (user) {
                        if (user && lower(user.role) !== "superadmin" && !user.storeId) { user.storeId = viewing; }
                    });
                    value = JSON.stringify(list);
                }
            } catch (error) { /* keep value as is */ }
            return rawSet.call(this, USERS_KEY, value);
        }

        var storeId = ownStoreId();
        if (storeId && key === USERS_KEY) {
            var incoming;
            try { incoming = JSON.parse(value); } catch (error) { return; }
            if (!Array.isArray(incoming)) { return; }

            var all = readJSON(USERS_KEY, []);
            if (!Array.isArray(all)) { all = []; }

            var others = all.filter(function (user) { return !(user && user.storeId === storeId); });
            var clean = incoming.filter(Boolean).map(function (user) {
                user.storeId = storeId;
                if (lower(user.role) === "superadmin") { user.role = "Staff"; }
                return user;
            }).filter(function (user) {
                return !others.some(function (other) { return lower(other.username) === lower(user.username); });
            });

            return rawSet.call(this, USERS_KEY, JSON.stringify(others.concat(clean)));
        }
        return rawSet.call(this, scopedName(key), value);
    };

    proto.removeItem = function (key) {
        if (this !== ls) { return rawRemove.call(this, key); }

        /* a store must never be able to wipe the shared user list */
        if (key === USERS_KEY && readSession()) { return; }
        return rawRemove.call(this, scopedName(key));
    };

    /* ---------- small public helpers ---------- */

    window.__feuStoreScope = true;
    window.feuScopedKey = scopedName;
    window.feuUsernameTaken = function (username, excludeId) {
        var all = readJSON(USERS_KEY, []);
        if (!Array.isArray(all)) { return false; }
        return all.some(function (user) {
            return user && lower(user.username) === lower(username) && user.id !== excludeId;
        });
    };
})();
