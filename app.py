import json
import os
import sqlite3
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "kutuphane.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
PORT = 8000


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                isbn TEXT DEFAULT '',
                category TEXT DEFAULT 'Genel',
                stock INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                phone TEXT DEFAULT '',
                email TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS loans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                loan_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                return_date TEXT DEFAULT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
                FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
            );
            """
        )

        # Örnek veriler (eğer tablo boşsa)
        book_count = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
        if book_count == 0:
            sample_books = [
                ("Suç ve Ceza", "Fyodor Dostoyevski", "9789750719387", "Roman", 3),
                ("Kürk Mantolu Madonna", "Sabahattin Ali", "9789753638029", "Edebiyat", 4),
                ("Saatleri Ayarlama Enstitüsü", "Ahmet Hamdi Tanpınar", "9789759955762", "Roman", 2),
                ("1984", "George Orwell", "9789750718533", "Distopya", 3),
                ("Simyacı", "Paulo Coelho", "9789750726439", "Felsefe / Roman", 2),
                ("İnce Memed 1", "Yaşar Kemal", "9789750807145", "Edebiyat", 2),
            ]
            conn.executemany(
                "INSERT INTO books (title, author, isbn, category, stock) VALUES (?, ?, ?, ?, ?)",
                sample_books,
            )

            sample_members = [
                ("Ahmet Yılmaz", "0532 111 22 33", "ahmet@ornek.com"),
                ("Ayşe Demir", "0544 222 33 44", "ayse@ornek.com"),
                ("Mehmet Kaya", "0555 333 44 55", "mehmet@ornek.com"),
            ]
            conn.executemany(
                "INSERT INTO members (full_name, phone, email) VALUES (?, ?, ?)",
                sample_members,
            )

            today = datetime.now().strftime("%Y-%m-%d")
            due = (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")
            conn.execute(
                "INSERT INTO loans (book_id, member_id, loan_date, due_date, status) VALUES (1, 1, ?, ?, 'active')",
                (today, due),
            )


class LibraryHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def _serve_file(self, filename, content_type):
        filepath = os.path.join(BASE_DIR, filename)
        if not os.path.exists(filepath):
            filepath = os.path.join(STATIC_DIR, filename)
        if not os.path.exists(filepath):
            self.send_error(404, "Dosya bulunamadi")
            return
        with open(filepath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        # Konsol çıktısını sade tut
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            return self._serve_file("index.html", "text/html; charset=utf-8")
        elif path == "/style.css":
            return self._serve_file("style.css", "text/css; charset=utf-8")
        elif path == "/script.js":
            return self._serve_file("script.js", "application/javascript; charset=utf-8")

        if path == "/api/summary":
            with get_db() as conn:
                total_books = conn.execute("SELECT COALESCE(SUM(stock), 0) FROM books").fetchone()[0]
                book_titles = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
                total_members = conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]
                active_loans = conn.execute(
                    "SELECT COUNT(*) FROM loans WHERE status = 'active'"
                ).fetchone()[0]
                today = datetime.now().strftime("%Y-%m-%d")
                overdue_loans = conn.execute(
                    "SELECT COUNT(*) FROM loans WHERE status = 'active' AND due_date < ?",
                    (today,),
                ).fetchone()[0]
            return self._send_json(
                {
                    "total_books": total_books,
                    "book_titles": book_titles,
                    "total_members": total_members,
                    "active_loans": active_loans,
                    "overdue_loans": overdue_loans,
                }
            )

        if path == "/api/books":
            with get_db() as conn:
                rows = conn.execute(
                    """
                    SELECT b.*,
                           (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.status = 'active') AS loaned_count
                    FROM books b
                    ORDER BY b.id DESC
                    """
                ).fetchall()
                books = []
                for r in rows:
                    item = dict(r)
                    item["available"] = max(0, item["stock"] - item["loaned_count"])
                    books.append(item)
            return self._send_json(books)

        if path == "/api/members":
            with get_db() as conn:
                rows = conn.execute(
                    """
                    SELECT m.*,
                           (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.status = 'active') AS active_loans
                    FROM members m
                    ORDER BY m.id DESC
                    """
                ).fetchall()
                members = [dict(r) for r in rows]
            return self._send_json(members)

        if path == "/api/loans":
            with get_db() as conn:
                rows = conn.execute(
                    """
                    SELECT l.*,
                           b.title AS book_title,
                           b.author AS book_author,
                           m.full_name AS member_name,
                           m.phone AS member_phone
                    FROM loans l
                    JOIN books b ON b.id = l.book_id
                    JOIN members m ON m.id = l.member_id
                    ORDER BY CASE WHEN l.status = 'active' THEN 0 ELSE 1 END, l.id DESC
                    """
                ).fetchall()
                loans = [dict(r) for r in rows]
            return self._send_json(loans)

        if path == "/api/export":
            with get_db() as conn:
                books = [dict(r) for r in conn.execute("SELECT * FROM books ORDER BY id ASC").fetchall()]
                members = [dict(r) for r in conn.execute("SELECT * FROM members ORDER BY id ASC").fetchall()]
                loans = [dict(r) for r in conn.execute("SELECT * FROM loans ORDER BY id ASC").fetchall()]
            return self._send_json({"books": books, "members": members, "loans": loans})

        self.send_error(404, "Endpoint bulunamadi")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        data = self._read_body()

        if path == "/api/books":
            title = (data.get("title") or "").strip()
            author = (data.get("author") or "").strip()
            isbn = (data.get("isbn") or "").strip()
            category = (data.get("category") or "Genel").strip() or "Genel"
            try:
                stock = max(1, int(data.get("stock", 1)))
            except ValueError:
                stock = 1

            if not title or not author:
                return self._send_json({"error": "Kitap adı ve yazar zorunludur."}, 400)

            with get_db() as conn:
                conn.execute(
                    "INSERT INTO books (title, author, isbn, category, stock) VALUES (?, ?, ?, ?, ?)",
                    (title, author, isbn, category, stock),
                )
            return self._send_json({"message": "Kitap başarıyla eklendi."}, 201)

        if path == "/api/members":
            full_name = (data.get("full_name") or "").strip()
            phone = (data.get("phone") or "").strip()
            email = (data.get("email") or "").strip()

            if not full_name:
                return self._send_json({"error": "Üye adı soyadı zorunludur."}, 400)

            with get_db() as conn:
                conn.execute(
                    "INSERT INTO members (full_name, phone, email) VALUES (?, ?, ?)",
                    (full_name, phone, email),
                )
            return self._send_json({"message": "Üye başarıyla eklendi."}, 201)

        if path == "/api/loans":
            try:
                book_id = int(data.get("book_id"))
                member_id = int(data.get("member_id"))
                days = int(data.get("days", 14))
            except (TypeError, ValueError):
                return self._send_json({"error": "Geçersiz kitap veya üye seçimi."}, 400)

            with get_db() as conn:
                book = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
                if not book:
                    return self._send_json({"error": "Kitap bulunamadı."}, 404)

                loaned = conn.execute(
                    "SELECT COUNT(*) FROM loans WHERE book_id = ? AND status = 'active'",
                    (book_id,),
                ).fetchone()[0]

                if book["stock"] - loaned <= 0:
                    return self._send_json({"error": "Bu kitabın mevcut stoğu tükenmiş."}, 400)

                loan_date = datetime.now().strftime("%Y-%m-%d")
                due_date = data.get("due_date") or (
                    datetime.now() + timedelta(days=days)
                ).strftime("%Y-%m-%d")

                conn.execute(
                    "INSERT INTO loans (book_id, member_id, loan_date, due_date, status) VALUES (?, ?, ?, ?, 'active')",
                    (book_id, member_id, loan_date, due_date),
                )
            return self._send_json({"message": "Kitap ödünç verildi."}, 201)

        if path.startswith("/api/loans/") and path.endswith("/return"):
            parts = path.split("/")
            try:
                loan_id = int(parts[3])
            except (IndexError, ValueError):
                return self._send_json({"error": "Geçersiz işlem ID."}, 400)

            return_date = datetime.now().strftime("%Y-%m-%d")
            with get_db() as conn:
                conn.execute(
                    "UPDATE loans SET status = 'returned', return_date = ? WHERE id = ?",
                    (return_date, loan_id),
                )
            return self._send_json({"message": "Kitap iade alındı."})

        if path == "/api/import":
            books = data.get("books")
            members = data.get("members")
            loans = data.get("loans")
            if not isinstance(books, list) or not isinstance(members, list) or not isinstance(loans, list):
                return self._send_json({"error": "Geçersiz yedek dosyası formatı."}, 400)

            with get_db() as conn:
                conn.execute("PRAGMA foreign_keys = OFF")
                conn.execute("DELETE FROM loans")
                conn.execute("DELETE FROM books")
                conn.execute("DELETE FROM members")
                for b in books:
                    conn.execute(
                        "INSERT INTO books (id, title, author, isbn, category, stock) VALUES (?, ?, ?, ?, ?, ?)",
                        (b.get("id"), b.get("title"), b.get("author"), b.get("isbn", ""), b.get("category", "Genel"), b.get("stock", 1)),
                    )
                for m in members:
                    conn.execute(
                        "INSERT INTO members (id, full_name, phone, email) VALUES (?, ?, ?, ?)",
                        (m.get("id"), m.get("full_name"), m.get("phone", ""), m.get("email", "")),
                    )
                for l in loans:
                    conn.execute(
                        "INSERT INTO loans (id, book_id, member_id, loan_date, due_date, return_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (l.get("id"), l.get("book_id"), l.get("member_id"), l.get("loan_date"), l.get("due_date"), l.get("return_date"), l.get("status", "active")),
                    )
                conn.execute("PRAGMA foreign_keys = ON")
            return self._send_json({"message": "Yedek başarıyla yüklendi."})

        self.send_error(404, "Endpoint bulunamadi")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/books/"):
            try:
                book_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                return self._send_json({"error": "Geçersiz kitap ID."}, 400)

            with get_db() as conn:
                active = conn.execute(
                    "SELECT COUNT(*) FROM loans WHERE book_id = ? AND status = 'active'",
                    (book_id,),
                ).fetchone()[0]
                if active > 0:
                    return self._send_json(
                        {"error": "Ödünçte olan bir kitap silinemez. Önce iade alın."}, 400
                    )
                conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
            return self._send_json({"message": "Kitap silindi."})

        if path.startswith("/api/members/"):
            try:
                member_id = int(path.split("/")[3])
            except (IndexError, ValueError):
                return self._send_json({"error": "Geçersiz üye ID."}, 400)

            with get_db() as conn:
                active = conn.execute(
                    "SELECT COUNT(*) FROM loans WHERE member_id = ? AND status = 'active'",
                    (member_id,),
                ).fetchone()[0]
                if active > 0:
                    return self._send_json(
                        {"error": "Üzerinde kitap bulunan üye silinemez."}, 400
                    )
                conn.execute("DELETE FROM members WHERE id = ?", (member_id,))
            return self._send_json({"message": "Üye silindi."})

        self.send_error(404, "Endpoint bulunamadi")


if __name__ == "__main__":
    init_db()
    server = HTTPServer(("127.0.0.1", PORT), LibraryHandler)
    print(f"====================================================")
    print(f" Kutuphane Yonetim Sistemi Calisiyor!")
    print(f" Tarayicinizdan acin: http://localhost:{PORT}")
    print(f" Durdurmak icin: CTRL+C")
    print(f"====================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu kapatildi.")
        server.server_close()
