/* FEU Canteen - shared store & rent helpers
   Data lives in localStorage under "feuCanteenStores".
   Store shape:
   {
     id, name, ownerId, ownerName, ownerUsername,
     rentAmount, dueDay (1-31), createdAt,
     payments: { "YYYY-MM": { paid, paidAt, markedBy, receipts: [ {id,name,type,data,note,reference,uploadedAt} ] } }
   }
*/
(function() {
    const STORES_KEY = "feuCanteenStores";
    const USERS_KEY = "feuCanteenUsers";
    const SESSION_KEY = "feuCanteenSession";
    const MAX_PDF_BYTES = 1200 * 1024;

    function readJSON(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value === null || value === undefined ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function getStores() {
        const stores = readJSON(STORES_KEY, []);
        return Array.isArray(stores) ? stores : [];
    }

    function saveStores(stores) {
        try {
            localStorage.setItem(STORES_KEY, JSON.stringify(stores));
            return true;
        } catch (error) {
            alert("Storage is full. Please remove old receipts or upload a smaller file.");
            return false;
        }
    }

    function getUsers() {
        const users = readJSON(USERS_KEY, []);
        return Array.isArray(users) ? users : [];
    }

    function saveUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function getSession() {
        return readJSON(SESSION_KEY, null);
    }

    function normalizedRole(session) {
        return String((session || {}).role || "").toLowerCase();
    }

    function periodKey(date) {
        const d = date || new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function periodLabel(key) {
        const parts = String(key).split("-");
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
        return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }

    function dueDateFor(store, key) {
        const parts = String(key).split("-");
        const year = Number(parts[0]);
        const month = Number(parts[1]) - 1;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const day = Math.min(Math.max(1, Number(store.dueDay) || 1), lastDay);
        return new Date(year, month, day, 23, 59, 59);
    }

    function formatDate(date) {
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    function formatMoney(value) {
        return "\u20B1" + Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function getPayment(store, key) {
        const payment = (store.payments || {})[key];
        return payment && typeof payment === "object"
            ? { paid: !!payment.paid, paidAt: payment.paidAt || "", markedBy: payment.markedBy || "", receipts: Array.isArray(payment.receipts) ? payment.receipts : [] }
            : { paid: false, paidAt: "", markedBy: "", receipts: [] };
    }

    function ensurePayment(store, key) {
        if (!store.payments || typeof store.payments !== "object") store.payments = {};
        if (!store.payments[key]) store.payments[key] = { paid: false, paidAt: "", markedBy: "", receipts: [] };
        if (!Array.isArray(store.payments[key].receipts)) store.payments[key].receipts = [];
        return store.payments[key];
    }

    /* paid | review | overdue | unpaid */
    function statusFor(store, key) {
        const payment = getPayment(store, key);
        if (payment.paid) return "paid";
        if (new Date() > dueDateFor(store, key)) return "overdue";
        if (payment.receipts.length) return "review";
        return "unpaid";
    }

    function statusLabel(status) {
        return { paid: "Paid", review: "Receipt Submitted", overdue: "Overdue", unpaid: "Unpaid" }[status] || "Unpaid";
    }

    function statusClass(status) {
        return { paid: "good", review: "low", overdue: "out", unpaid: "low" }[status] || "low";
    }

    /* Periods from the store's creation month up to the current month, newest first */
    function periodsFor(store) {
        const list = [];
        const start = store.createdAt ? new Date(store.createdAt) : new Date();
        const cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const first = new Date(start.getFullYear(), start.getMonth(), 1);
        let guard = 0;
        while (cursor >= first && guard < 36) {
            list.push(periodKey(cursor));
            cursor.setMonth(cursor.getMonth() - 1);
            guard++;
        }
        return list.length ? list : [periodKey()];
    }

    function daysUntil(date) {
        return Math.ceil((date.getTime() - Date.now()) / 86400000);
    }

    function escapeHTML(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    async function hashPassword(value) {
        if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) return "plain:" + String(value);
        const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
        return Array.from(new Uint8Array(digest)).map(function(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    }

    function compressImage(file) {
        return new Promise(function(resolve, reject) {
            const reader = new FileReader();
            reader.onerror = function() { reject(new Error("Could not read the file.")); };
            reader.onload = function() {
                const img = new Image();
                img.onerror = function() { reject(new Error("That image could not be opened.")); };
                img.onload = function() {
                    const max = 1100;
                    const scale = Math.min(1, max / Math.max(img.width, img.height));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.round(img.width * scale);
                    canvas.height = Math.round(img.height * scale);
                    const ctx = canvas.getContext("2d");
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/jpeg", 0.8));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    /* Turns a chosen file into a receipt record (images are compressed, PDFs are size-limited) */
    async function fileToReceipt(file, note, reference) {
        if (!file) throw new Error("Please choose a receipt file.");
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const isImage = /^image\//.test(file.type);
        if (!isPdf && !isImage) throw new Error("Please upload an image (JPG/PNG) or a PDF.");

        let data;
        let type;
        if (isPdf) {
            if (file.size > MAX_PDF_BYTES) throw new Error("PDF is too large (max about 1.2 MB). Upload a photo/screenshot instead.");
            data = await new Promise(function(resolve, reject) {
                const reader = new FileReader();
                reader.onerror = function() { reject(new Error("Could not read the file.")); };
                reader.onload = function() { resolve(reader.result); };
                reader.readAsDataURL(file);
            });
            type = "application/pdf";
        } else {
            data = await compressImage(file);
            type = "image/jpeg";
        }

        return {
            id: "RCP-" + Date.now(),
            name: file.name,
            type: type,
            data: data,
            note: String(note || "").trim(),
            reference: String(reference || "").trim(),
            uploadedAt: new Date().toISOString()
        };
    }

    function openDataUrl(dataUrl) {
        try {
            const parts = String(dataUrl).split(",");
            const mime = (parts[0].match(/:(.*?);/) || [])[1] || "application/octet-stream";
            const binary = atob(parts[1]);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
            window.open(url, "_blank");
        } catch (error) {
            window.open(dataUrl, "_blank");
        }
    }

    /* Builds the receipt list HTML used by both the superadmin and admin pages */
    function receiptsHTML(receipts) {
        if (!receipts.length) {
            return '<div class="history-empty">No receipt uploaded for this month.</div>';
        }
        return receipts.slice().reverse().map(function(receipt) {
            const preview = receipt.type === "application/pdf"
                ? '<div class="rent-pdf-preview">PDF receipt</div>'
                : '<img class="rent-receipt-image" src="' + receipt.data + '" alt="Receipt">';
            const uploaded = new Date(receipt.uploadedAt).toLocaleString("en-PH");
            return '<div class="rent-receipt-item">' + preview +
                '<div class="rent-receipt-meta">' +
                '<strong>' + escapeHTML(receipt.name) + '</strong>' +
                '<span>Uploaded ' + escapeHTML(uploaded) + '</span>' +
                (receipt.reference ? '<span>Reference: ' + escapeHTML(receipt.reference) + '</span>' : '') +
                (receipt.note ? '<span>Note: ' + escapeHTML(receipt.note) + '</span>' : '') +
                '<button type="button" class="modal-button modal-cancel" data-open-receipt="' + escapeHTML(receipt.id) + '">Open full size</button>' +
                '</div></div>';
        }).join("");
    }

    window.FeuRent = {
        STORES_KEY: STORES_KEY,
        getStores: getStores,
        saveStores: saveStores,
        getUsers: getUsers,
        saveUsers: saveUsers,
        getSession: getSession,
        normalizedRole: normalizedRole,
        periodKey: periodKey,
        periodLabel: periodLabel,
        periodsFor: periodsFor,
        dueDateFor: dueDateFor,
        formatDate: formatDate,
        formatMoney: formatMoney,
        getPayment: getPayment,
        ensurePayment: ensurePayment,
        statusFor: statusFor,
        statusLabel: statusLabel,
        statusClass: statusClass,
        daysUntil: daysUntil,
        escapeHTML: escapeHTML,
        hashPassword: hashPassword,
        fileToReceipt: fileToReceipt,
        openDataUrl: openDataUrl,
        receiptsHTML: receiptsHTML
    };
})();
