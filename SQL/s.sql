CREATE TABLE product_variants (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    color VARCHAR(50),
    size VARCHAR(20),
    stock INTEGER DEFAULT 0,
    sku VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);