-- Unlimited external voting books: title, wrapped/external link, and image URL.
CREATE TABLE IF NOT EXISTS voting_external_books (
    external_book_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_id INTEGER NOT NULL,
    book_title TEXT NOT NULL,
    book_link TEXT NOT NULL,
    image_url TEXT NOT NULL,
    author_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (festival_id, book_link),
    FOREIGN KEY (festival_id) REFERENCES voting_festivals(festival_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voting_external_votes (
    vote_id INTEGER PRIMARY KEY AUTOINCREMENT,
    festival_id INTEGER NOT NULL,
    external_book_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    voted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (festival_id, user_id),
    FOREIGN KEY (festival_id) REFERENCES voting_festivals(festival_id) ON DELETE CASCADE,
    FOREIGN KEY (external_book_id) REFERENCES voting_external_books(external_book_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
