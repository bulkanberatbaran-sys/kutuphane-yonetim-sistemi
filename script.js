let booksData = [];
let membersData = [];
let loansData = [];
let useLocalStorageMode = false;
const STORAGE_KEY = "kutuphane_veritabani_v1";

document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    setupForms();
    setupSearch();
    setupBackupButtons();
    loadAllData();
});

function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn[data-tab]");
    const contents = document.querySelectorAll(".tab-content");

    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            buttons.forEach((b) => b.classList.remove("active"));
            contents.forEach((c) => c.classList.remove("active"));

            btn.classList.add("active");
            const target = document.getElementById(`tab-${btn.dataset.tab}`);
            if (target) target.classList.add("active");
        });
    });
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast ${type}`;
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 3200);
}

function getDefaultLocalDB() {
    const today = new Date().toISOString().split("T")[0];
    const due = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
    return {
        books: [
            { id: 1, title: "Suç ve Ceza", author: "Fyodor Dostoyevski", isbn: "9789750719387", category: "Roman", stock: 3 },
            { id: 2, title: "Kürk Mantolu Madonna", author: "Sabahattin Ali", isbn: "9789753638029", category: "Edebiyat", stock: 4 },
            { id: 3, title: "Saatleri Ayarlama Enstitüsü", author: "Ahmet Hamdi Tanpınar", isbn: "9789759955762", category: "Roman", stock: 2 },
            { id: 4, title: "1984", author: "George Orwell", isbn: "9789750718533", category: "Distopya", stock: 3 },
            { id: 5, title: "Simyacı", author: "Paulo Coelho", isbn: "9789750726439", category: "Felsefe / Roman", stock: 2 },
            { id: 6, title: "İnce Memed 1", author: "Yaşar Kemal", isbn: "9789750807145", category: "Edebiyat", stock: 2 },
        ],
        members: [
            { id: 1, full_name: "Ahmet Yılmaz", phone: "0532 111 22 33", email: "ahmet@ornek.com" },
            { id: 2, full_name: "Ayşe Demir", phone: "0544 222 33 44", email: "ayse@ornek.com" },
            { id: 3, full_name: "Mehmet Kaya", phone: "0555 333 44 55", email: "mehmet@ornek.com" },
        ],
        loans: [
            { id: 1, book_id: 1, member_id: 1, loan_date: today, due_date: due, return_date: null, status: "active" },
        ],
    };
}

function getLocalDB() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        const initial = getDefaultLocalDB();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
    }
    try {
        return JSON.parse(raw);
    } catch {
        const initial = getDefaultLocalDB();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
    }
}

function saveLocalDB(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function handleLocalApi(url, method = "GET", body = null) {
    const db = getLocalDB();
    const today = new Date().toISOString().split("T")[0];

    if (url === "/api/summary" && method === "GET") {
        const total_books = db.books.reduce((acc, b) => acc + Number(b.stock || 0), 0);
        const book_titles = db.books.length;
        const total_members = db.members.length;
        const active_loans = db.loans.filter((l) => l.status === "active").length;
        const overdue_loans = db.loans.filter((l) => l.status === "active" && l.due_date < today).length;
        return { total_books, book_titles, total_members, active_loans, overdue_loans };
    }

    if (url === "/api/books" && method === "GET") {
        return [...db.books]
            .sort((a, b) => b.id - a.id)
            .map((b) => {
                const loaned_count = db.loans.filter((l) => l.book_id === b.id && l.status === "active").length;
                return { ...b, loaned_count, available: Math.max(0, b.stock - loaned_count) };
            });
    }

    if (url === "/api/members" && method === "GET") {
        return [...db.members]
            .sort((a, b) => b.id - a.id)
            .map((m) => {
                const active_loans = db.loans.filter((l) => l.member_id === m.id && l.status === "active").length;
                return { ...m, active_loans };
            });
    }

    if (url === "/api/loans" && method === "GET") {
        return [...db.loans]
            .map((l) => {
                const book = db.books.find((b) => b.id === l.book_id) || { title: "Silinmiş Kitap", author: "" };
                const member = db.members.find((m) => m.id === l.member_id) || { full_name: "Silinmiş Üye", phone: "" };
                return {
                    ...l,
                    book_title: book.title,
                    book_author: book.author,
                    member_name: member.full_name,
                    member_phone: member.phone,
                };
            })
            .sort((a, b) => {
                if (a.status === "active" && b.status !== "active") return -1;
                if (a.status !== "active" && b.status === "active") return 1;
                return b.id - a.id;
            });
    }

    if (url === "/api/books" && method === "POST") {
        const title = (body.title || "").trim();
        const author = (body.author || "").trim();
        if (!title || !author) throw new Error("Kitap adı ve yazar zorunludur.");
        const nextId = db.books.reduce((max, b) => Math.max(max, b.id), 0) + 1;
        db.books.push({
            id: nextId,
            title,
            author,
            isbn: (body.isbn || "").trim(),
            category: (body.category || "Genel").trim() || "Genel",
            stock: Math.max(1, Number(body.stock) || 1),
        });
        saveLocalDB(db);
        return { message: "Kitap başarıyla eklendi." };
    }

    if (url === "/api/members" && method === "POST") {
        const full_name = (body.full_name || "").trim();
        if (!full_name) throw new Error("Üye adı soyadı zorunludur.");
        const nextId = db.members.reduce((max, m) => Math.max(max, m.id), 0) + 1;
        db.members.push({
            id: nextId,
            full_name,
            phone: (body.phone || "").trim(),
            email: (body.email || "").trim(),
        });
        saveLocalDB(db);
        return { message: "Üye başarıyla eklendi." };
    }

    if (url === "/api/loans" && method === "POST") {
        const book_id = Number(body.book_id);
        const member_id = Number(body.member_id);
        const days = Number(body.days || 14);
        const book = db.books.find((b) => b.id === book_id);
        if (!book) throw new Error("Kitap bulunamadı.");
        const loaned = db.loans.filter((l) => l.book_id === book_id && l.status === "active").length;
        if (book.stock - loaned <= 0) throw new Error("Bu kitabın mevcut stoğu tükenmiş.");

        const due_date = new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
        const nextId = db.loans.reduce((max, l) => Math.max(max, l.id), 0) + 1;
        db.loans.push({
            id: nextId,
            book_id,
            member_id,
            loan_date: today,
            due_date,
            return_date: null,
            status: "active",
        });
        saveLocalDB(db);
        return { message: "Kitap ödünç verildi." };
    }

    if (url.startsWith("/api/loans/") && url.endsWith("/return") && method === "POST") {
        const loanId = Number(url.split("/")[3]);
        const loan = db.loans.find((l) => l.id === loanId);
        if (loan) {
            loan.status = "returned";
            loan.return_date = today;
            saveLocalDB(db);
        }
        return { message: "Kitap iade alındı." };
    }

    if (url.startsWith("/api/books/") && method === "DELETE") {
        const bookId = Number(url.split("/")[3]);
        const active = db.loans.some((l) => l.book_id === bookId && l.status === "active");
        if (active) throw new Error("Ödünçte olan bir kitap silinemez. Önce iade alın.");
        db.books = db.books.filter((b) => b.id !== bookId);
        db.loans = db.loans.filter((l) => l.book_id !== bookId);
        saveLocalDB(db);
        return { message: "Kitap silindi." };
    }

    if (url.startsWith("/api/members/") && method === "DELETE") {
        const memberId = Number(url.split("/")[3]);
        const active = db.loans.some((l) => l.member_id === memberId && l.status === "active");
        if (active) throw new Error("Üzerinde kitap bulunan üye silinemez.");
        db.members = db.members.filter((m) => m.id !== memberId);
        db.loans = db.loans.filter((l) => l.member_id !== memberId);
        saveLocalDB(db);
        return { message: "Üye silindi." };
    }

    if (url === "/api/export" && method === "GET") {
        return db;
    }

    if (url === "/api/import" && method === "POST") {
        if (!Array.isArray(body.books) || !Array.isArray(body.members) || !Array.isArray(body.loans)) {
            throw new Error("Geçersiz yedek dosyası formatı.");
        }
        saveLocalDB({ books: body.books, members: body.members, loans: body.loans });
        return { message: "Yedek başarıyla yüklendi." };
    }

    throw new Error("Desteklenmeyen işlem");
}

async function apiRequest(url, method = "GET", body = null) {
    if (useLocalStorageMode) {
        return handleLocalApi(url, method, body);
    }

    try {
        const options = {
            method,
            headers: { "Content-Type": "application/json" },
        };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(url, options);
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            useLocalStorageMode = true;
            return handleLocalApi(url, method, body);
        }
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || "Bir hata oluştu");
        }
        return data;
    } catch (err) {
        if (err instanceof TypeError || err.message.includes("Failed to fetch")) {
            useLocalStorageMode = true;
            return handleLocalApi(url, method, body);
        }
        throw err;
    }
}

function setupBackupButtons() {
    const exportBtn = document.getElementById("btn-export");
    const importInput = document.getElementById("input-import");

    if (exportBtn) {
        exportBtn.addEventListener("click", async () => {
            try {
                const data = await apiRequest("/api/export", "GET");
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `kutuphane-yedek-${new Date().toISOString().split("T")[0]}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                showToast("Veritabanı yedeği indirildi.");
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    if (importInput) {
        importInput.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                await apiRequest("/api/import", "POST", parsed);
                showToast("Yedek dosyası başarıyla yüklendi.");
                loadAllData();
            } catch (err) {
                showToast(err.message || "Yedek dosyası okunamadı.", "error");
            } finally {
                e.target.value = "";
            }
        });
    }
}

async function loadAllData() {
    try {
        const [summary, books, members, loans] = await Promise.all([
            apiRequest("/api/summary"),
            apiRequest("/api/books"),
            apiRequest("/api/members"),
            apiRequest("/api/loans"),
        ]);

        document.getElementById("stat-titles").textContent = summary.book_titles;
        document.getElementById("stat-books").textContent = summary.total_books;
        document.getElementById("stat-members").textContent = summary.total_members;
        document.getElementById("stat-loans").textContent = summary.active_loans;

        booksData = books;
        membersData = members;
        loansData = loans;

        renderBooks(booksData);
        renderMembers(membersData);
        renderLoans(loansData);
        populateLoanSelects();
    } catch (err) {
        showToast(err.message, "error");
    }
}

function renderBooks(list) {
    const tbody = document.getElementById("books-tbody");
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Kayıtlı kitap bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = list
        .map((b) => {
            const availBadge =
                b.available > 0
                    ? `<span class="badge badge-green">Mevcut (${b.available}/${b.stock})</span>`
                    : `<span class="badge badge-red">Tükendi (0/${b.stock})</span>`;

            return `
            <tr>
                <td>
                    <strong>${escapeHtml(b.title)}</strong>
                    ${b.isbn ? `<div style="font-size:0.78rem;color:#64748b">ISBN: ${escapeHtml(b.isbn)}</div>` : ""}
                </td>
                <td>${escapeHtml(b.author)}</td>
                <td><span class="badge badge-gray">${escapeHtml(b.category)}</span></td>
                <td>${availBadge}</td>
                <td>
                    <button class="btn btn-danger" onclick="deleteBook(${b.id})">Sil</button>
                </td>
            </tr>
        `;
        })
        .join("");
}

function renderMembers(list) {
    const tbody = document.getElementById("members-tbody");
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Kayıtlı üye bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = list
        .map((m) => {
            const loanInfo =
                m.active_loans > 0
                    ? `<span class="badge badge-yellow">${m.active_loans} Kitap Ödünçte</span>`
                    : `<span class="badge badge-green">Yok</span>`;

            return `
            <tr>
                <td><strong>${escapeHtml(m.full_name)}</strong></td>
                <td>${escapeHtml(m.phone || "-")}</td>
                <td>${escapeHtml(m.email || "-")}</td>
                <td>${loanInfo}</td>
                <td>
                    <button class="btn btn-danger" onclick="deleteMember(${m.id})">Sil</button>
                </td>
            </tr>
        `;
        })
        .join("");
}

function renderLoans(list) {
    const tbody = document.getElementById("loans-tbody");
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Henüz ödünç işlemi yok.</td></tr>`;
        return;
    }

    const today = new Date().toISOString().split("T")[0];

    tbody.innerHTML = list
        .map((l) => {
            let statusBadge = "";
            let actionBtn = "-";

            if (l.status === "active") {
                if (l.due_date < today) {
                    statusBadge = `<span class="badge badge-red">Gecikmiş!</span>`;
                } else {
                    statusBadge = `<span class="badge badge-yellow">Ödünçte</span>`;
                }
                actionBtn = `<button class="btn btn-success" onclick="returnBook(${l.id})">İade Al</button>`;
            } else {
                statusBadge = `<span class="badge badge-green">İade Edildi (${l.return_date})</span>`;
            }

            return `
            <tr>
                <td><strong>${escapeHtml(l.book_title)}</strong></td>
                <td>${escapeHtml(l.member_name)}</td>
                <td>${escapeHtml(l.loan_date)}</td>
                <td>${escapeHtml(l.due_date)}</td>
                <td>${statusBadge}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
        })
        .join("");
}

function populateLoanSelects() {
    const bookSelect = document.getElementById("loan-book");
    const memberSelect = document.getElementById("loan-member");

    const availableBooks = booksData.filter((b) => b.available > 0);
    bookSelect.innerHTML =
        `<option value="">-- Kitap Seçin --</option>` +
        availableBooks
            .map(
                (b) =>
                    `<option value="${b.id}">${escapeHtml(b.title)} - ${escapeHtml(b.author)} (Stok: ${b.available})</option>`
            )
            .join("");

    memberSelect.innerHTML =
        `<option value="">-- Üye Seçin --</option>` +
        membersData
            .map((m) => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`)
            .join("");
}

function setupForms() {
    document.getElementById("book-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await apiRequest("/api/books", "POST", {
                title: document.getElementById("book-title").value,
                author: document.getElementById("book-author").value,
                category: document.getElementById("book-category").value,
                isbn: document.getElementById("book-isbn").value,
                stock: Number(document.getElementById("book-stock").value),
            });
            e.target.reset();
            document.getElementById("book-stock").value = 1;
            showToast("Kitap başarıyla eklendi.");
            loadAllData();
        } catch (err) {
            showToast(err.message, "error");
        }
    });

    document.getElementById("member-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await apiRequest("/api/members", "POST", {
                full_name: document.getElementById("member-name").value,
                phone: document.getElementById("member-phone").value,
                email: document.getElementById("member-email").value,
            });
            e.target.reset();
            showToast("Üye başarıyla kaydedildi.");
            loadAllData();
        } catch (err) {
            showToast(err.message, "error");
        }
    });

    document.getElementById("loan-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await apiRequest("/api/loans", "POST", {
                book_id: Number(document.getElementById("loan-book").value),
                member_id: Number(document.getElementById("loan-member").value),
                days: Number(document.getElementById("loan-days").value),
            });
            e.target.reset();
            showToast("Kitap ödünç verildi.");
            loadAllData();
        } catch (err) {
            showToast(err.message, "error");
        }
    });
}

function setupSearch() {
    document.getElementById("search-books").addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase();
        renderBooks(
            booksData.filter(
                (b) =>
                    b.title.toLowerCase().includes(q) ||
                    b.author.toLowerCase().includes(q) ||
                    b.category.toLowerCase().includes(q) ||
                    (b.isbn && b.isbn.toLowerCase().includes(q))
            )
        );
    });

    document.getElementById("search-members").addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase();
        renderMembers(
            membersData.filter(
                (m) =>
                    m.full_name.toLowerCase().includes(q) ||
                    (m.phone && m.phone.toLowerCase().includes(q)) ||
                    (m.email && m.email.toLowerCase().includes(q))
            )
        );
    });

    document.getElementById("search-loans").addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase();
        renderLoans(
            loansData.filter(
                (l) =>
                    l.book_title.toLowerCase().includes(q) ||
                    l.member_name.toLowerCase().includes(q)
            )
        );
    });
}

async function deleteBook(id) {
    if (!confirm("Bu kitabı silmek istediğinize emin misiniz?")) return;
    try {
        await apiRequest(`/api/books/${id}`, "DELETE");
        showToast("Kitap silindi.");
        loadAllData();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteMember(id) {
    if (!confirm("Bu üyeyi silmek istediğinize emin misiniz?")) return;
    try {
        await apiRequest(`/api/members/${id}`, "DELETE");
        showToast("Üye silindi.");
        loadAllData();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function returnBook(loanId) {
    try {
        await apiRequest(`/api/loans/${loanId}/return`, "POST");
        showToast("Kitap iade alındı.");
        loadAllData();
    } catch (err) {
        showToast(err.message, "error");
    }
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
