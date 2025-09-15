# Indexing Deep Dive

## Introduction

PostgreSQL's sophisticated indexing system is one of its greatest strengths. Understanding when and how to use different index types can dramatically improve query performance and enable complex data access patterns that would be impossible with traditional B-tree indexes alone.

## B-tree Indexes: The Foundation

### Understanding B-tree Structure

B-tree indexes are the default and most commonly used index type in PostgreSQL:

```sql
-- Create sample table for index demonstrations
CREATE TABLE customer_orders (
    order_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_date DATE NOT NULL,
    total_amount NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Generate sample data (10,000 orders)
INSERT INTO customer_orders (customer_id, order_date, total_amount, status)
SELECT 
    (random() * 1000)::INTEGER + 1,
    CURRENT_DATE - (random() * 365)::INTEGER,
    (random() * 1000 + 10)::NUMERIC(10,2),
    (ARRAY['pending', 'processing', 'shipped', 'delivered', 'cancelled'])[floor(random() * 5 + 1)]
FROM generate_series(1, 10000);

-- Basic B-tree indexes
CREATE INDEX idx_customer_orders_customer_id ON customer_orders (customer_id);
CREATE INDEX idx_customer_orders_order_date ON customer_orders (order_date);
CREATE INDEX idx_customer_orders_status ON customer_orders (status);
```

### Multi-Column B-tree Indexes

```sql
-- Composite indexes - column order matters!
CREATE INDEX idx_customer_orders_compound_1 ON customer_orders (customer_id, order_date);
CREATE INDEX idx_customer_orders_compound_2 ON customer_orders (order_date, customer_id);
CREATE INDEX idx_customer_orders_status_date ON customer_orders (status, order_date, total_amount);

-- Demonstrate index usage
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM customer_orders 
WHERE customer_id = 123 AND order_date >= '2024-01-01';

-- This query can use idx_customer_orders_compound_1 efficiently
-- But would be less efficient with idx_customer_orders_compound_2

-- Show index usage for different query patterns
EXPLAIN (ANALYZE, BUFFERS) 
SELECT customer_id, COUNT(*), SUM(total_amount)
FROM customer_orders 
WHERE status = 'delivered' 
  AND order_date BETWEEN '2024-01-01' AND '2024-03-31'
GROUP BY customer_id;
```

### Partial Indexes

```sql
-- Partial indexes for specific conditions
CREATE INDEX idx_customer_orders_active ON customer_orders (customer_id, order_date)
WHERE status NOT IN ('delivered', 'cancelled');

CREATE INDEX idx_customer_orders_high_value ON customer_orders (order_date, customer_id)
WHERE total_amount > 500;

CREATE INDEX idx_customer_orders_recent_pending ON customer_orders (customer_id)
WHERE status = 'pending' AND order_date >= CURRENT_DATE - INTERVAL '30 days';

-- Partial index benefits
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM customer_orders 
WHERE customer_id = 456 
  AND status = 'pending' 
  AND order_date >= CURRENT_DATE - INTERVAL '30 days';

-- Index size comparison
SELECT 
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as size,
    pg_relation_size(indexname::regclass) as size_bytes
FROM pg_indexes 
WHERE tablename = 'customer_orders'
ORDER BY pg_relation_size(indexname::regclass) DESC;
```

### Expression Indexes

```sql
-- Indexes on expressions
CREATE INDEX idx_customer_orders_month ON customer_orders (EXTRACT(YEAR FROM order_date), EXTRACT(MONTH FROM order_date));
CREATE INDEX idx_customer_orders_total_rounded ON customer_orders (ROUND(total_amount));
CREATE INDEX idx_customer_orders_status_lower ON customer_orders (LOWER(status));

-- Case-insensitive searching
CREATE INDEX idx_customer_orders_case_insensitive ON customer_orders (UPPER(status));

-- Complex expression indexes
CREATE INDEX idx_customer_orders_business_days ON customer_orders 
((order_date + INTERVAL '5 days')::DATE) 
WHERE EXTRACT(DOW FROM order_date) NOT IN (0, 6);

-- Using expression indexes
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, COUNT(*)
FROM customer_orders 
WHERE EXTRACT(YEAR FROM order_date) = 2024 
  AND EXTRACT(MONTH FROM order_date) = 6
GROUP BY customer_id;
```

## Hash Indexes

### When to Use Hash Indexes

```sql
-- Hash indexes for equality lookups
CREATE TABLE user_sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Generate sample session data
INSERT INTO user_sessions (session_id, user_id, ip_address)
SELECT 
    'sess_' || generate_random_uuid()::TEXT,
    (random() * 10000)::INTEGER + 1,
    ('192.168.' || (random() * 255)::INTEGER || '.' || (random() * 255)::INTEGER)::INET
FROM generate_series(1, 100000);

-- Hash index for exact equality lookups
CREATE INDEX idx_user_sessions_hash_session ON user_sessions USING HASH (session_id);
CREATE INDEX idx_user_sessions_hash_user ON user_sessions USING HASH (user_id);

-- Compare B-tree vs Hash for equality
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM user_sessions WHERE session_id = 'sess_specific_id';

-- Hash indexes don't support range queries
-- This would NOT use the hash index:
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM user_sessions WHERE user_id > 5000;
```

## GIN Indexes: Generalized Inverted Indexes

### Array and JSONB Indexing

```sql
-- Setup tables for GIN examples
CREATE TABLE product_catalog (
    product_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    tags TEXT[],
    specifications JSONB,
    categories INTEGER[],
    full_text_search TSVECTOR
);

-- Sample product data
INSERT INTO product_catalog (name, tags, specifications, categories) VALUES 
('Laptop Pro', 
 ARRAY['electronics', 'computer', 'portable', 'business'],
 '{"cpu": "Intel i7", "ram": "16GB", "storage": "512GB SSD", "screen": "15.6 inch", "weight": 1.8}',
 ARRAY[1, 15, 23]),
('Gaming Mouse',
 ARRAY['electronics', 'gaming', 'accessories', 'rgb'],
 '{"dpi": 16000, "buttons": 8, "wireless": true, "battery_life": "80 hours"}',
 ARRAY[1, 8, 45]),
('Office Chair',
 ARRAY['furniture', 'office', 'ergonomic', 'adjustable'],
 '{"material": "mesh", "height_adjustable": true, "lumbar_support": true, "weight_capacity": "150kg"}',
 ARRAY[5, 12]);

-- Update full-text search vectors
UPDATE product_catalog 
SET full_text_search = to_tsvector('english', name || ' ' || array_to_string(tags, ' '));

-- GIN indexes for different data types
CREATE INDEX idx_product_tags_gin ON product_catalog USING GIN (tags);
CREATE INDEX idx_product_specs_gin ON product_catalog USING GIN (specifications);
CREATE INDEX idx_product_categories_gin ON product_catalog USING GIN (categories);
CREATE INDEX idx_product_fts_gin ON product_catalog USING GIN (full_text_search);
```

### GIN Query Patterns

```sql
-- Array containment queries
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, name, tags
FROM product_catalog 
WHERE tags @> ARRAY['electronics', 'portable'];

-- Array overlap queries
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, name 
FROM product_catalog 
WHERE tags && ARRAY['gaming', 'rgb'];

-- JSONB containment
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, name, specifications
FROM product_catalog 
WHERE specifications @> '{"wireless": true}';

-- JSONB key existence
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, name
FROM product_catalog 
WHERE specifications ? 'dpi';

-- JSONB path queries
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, name, specifications->'cpu' as processor
FROM product_catalog 
WHERE specifications->'cpu' IS NOT NULL;

-- Full-text search
EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, name, ts_rank(full_text_search, query) as rank
FROM product_catalog, to_tsquery('english', 'electronics & portable') query
WHERE full_text_search @@ query
ORDER BY rank DESC;
```

### Advanced GIN Usage

```sql
-- GIN with custom operator classes
CREATE INDEX idx_product_specs_path_gin ON product_catalog 
USING GIN (specifications jsonb_path_ops);

-- jsonb_path_ops is more efficient for @> queries but supports fewer operations
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM product_catalog 
WHERE specifications @> '{"ram": "16GB"}';

-- Multi-column GIN indexes
CREATE INDEX idx_product_combined_gin ON product_catalog 
USING GIN (tags, categories);

-- Query using multiple GIN columns
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM product_catalog 
WHERE tags @> ARRAY['electronics'] 
  AND categories @> ARRAY[1];
```

## GiST Indexes: Generalized Search Tree

### Geometric and Range Data

```sql
-- Setup for GiST examples
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE geo_locations (
    location_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    coordinates POINT,
    coverage_area CIRCLE,
    service_region POLYGON,
    active_period TSRANGE
);

-- Sample geometric data
INSERT INTO geo_locations (name, coordinates, coverage_area, active_period) VALUES 
('Downtown Office', POINT(40.7589, -73.9851), CIRCLE(POINT(40.7589, -73.9851), 0.5), '[2024-01-01, 2024-12-31)'),
('Warehouse North', POINT(40.8176, -73.9782), CIRCLE(POINT(40.8176, -73.9782), 1.0), '[2024-03-01, 2024-10-31)'),
('Service Center', POINT(40.6892, -74.0445), CIRCLE(POINT(40.6892, -74.0445), 0.8), '[2024-01-01, )');

-- GiST indexes for geometric types
CREATE INDEX idx_geo_coordinates_gist ON geo_locations USING GiST (coordinates);
CREATE INDEX idx_geo_coverage_gist ON geo_locations USING GiST (coverage_area);
CREATE INDEX idx_geo_period_gist ON geo_locations USING GiST (active_period);
```

### GiST Query Examples

```sql
-- Proximity queries
EXPLAIN (ANALYZE, BUFFERS)
SELECT name, coordinates <-> POINT(40.7500, -73.9900) as distance
FROM geo_locations 
ORDER BY coordinates <-> POINT(40.7500, -73.9900)
LIMIT 5;

-- Range containment
EXPLAIN (ANALYZE, BUFFERS)
SELECT name, active_period
FROM geo_locations 
WHERE active_period @> '2024-06-15'::DATE;

-- Range overlap
EXPLAIN (ANALYZE, BUFFERS)
SELECT name, active_period
FROM geo_locations 
WHERE active_period && '[2024-05-01, 2024-07-01)'::TSRANGE;

-- Geometric containment
EXPLAIN (ANALYZE, BUFFERS)
SELECT name 
FROM geo_locations 
WHERE coverage_area @> POINT(40.7600, -73.9850);
```

### Text Search with GiST

```sql
-- GiST for full-text search (alternative to GIN)
CREATE INDEX idx_product_fts_gist ON product_catalog USING GiST (full_text_search);

-- GiST supports nearest neighbor for text similarity
SELECT 
    product_id, 
    name,
    full_text_search <-> to_tsquery('english', 'computer') as distance
FROM product_catalog 
ORDER BY full_text_search <-> to_tsquery('english', 'computer')
LIMIT 5;
```

## BRIN Indexes: Block Range Indexes

### Large Table Optimization

```sql
-- BRIN indexes for very large tables with natural ordering
CREATE TABLE time_series_data (
    timestamp TIMESTAMP NOT NULL,
    sensor_id INTEGER NOT NULL,
    temperature NUMERIC(5,2),
    humidity NUMERIC(5,2),
    pressure NUMERIC(7,2)
);

-- Generate large time-series dataset (naturally ordered by time)
INSERT INTO time_series_data (timestamp, sensor_id, temperature, humidity, pressure)
SELECT 
    '2024-01-01'::TIMESTAMP + (n || ' minutes')::INTERVAL,
    (n % 100) + 1,
    20 + (random() * 20)::NUMERIC(5,2),
    40 + (random() * 40)::NUMERIC(5,2),
    1000 + (random() * 50)::NUMERIC(7,2)
FROM generate_series(1, 1000000) n;

-- BRIN indexes for time-ordered data
CREATE INDEX idx_timeseries_timestamp_brin ON time_series_data USING BRIN (timestamp);
CREATE INDEX idx_timeseries_sensor_brin ON time_series_data USING BRIN (sensor_id);

-- Compare BRIN vs B-tree size
SELECT 
    'BRIN timestamp' as index_type,
    pg_size_pretty(pg_relation_size('idx_timeseries_timestamp_brin')) as size
UNION ALL
SELECT 
    'B-tree timestamp' as index_type,
    pg_size_pretty(pg_relation_size('idx_customer_orders_order_date')) as size;

-- BRIN query performance
EXPLAIN (ANALYZE, BUFFERS)
SELECT sensor_id, AVG(temperature), COUNT(*)
FROM time_series_data 
WHERE timestamp BETWEEN '2024-06-01' AND '2024-06-30'
GROUP BY sensor_id;
```

### BRIN Maintenance

```sql
-- BRIN indexes need periodic summarization
SELECT brin_summarize_new_values('idx_timeseries_timestamp_brin');

-- Check BRIN index statistics
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE tablename = 'time_series_data' 
  AND attname = 'timestamp';

-- BRIN works best with high correlation
SELECT 
    attname,
    correlation
FROM pg_stats 
WHERE tablename = 'time_series_data';
```

## SP-GiST Indexes: Space-Partitioned GiST

### Specialized Data Structures

```sql
-- SP-GiST for specific data types
CREATE TABLE network_data (
    network_id SERIAL PRIMARY KEY,
    ip_address INET,
    phone_number TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sample network data
INSERT INTO network_data (ip_address, phone_number) VALUES 
('192.168.1.100/24', '+1-555-123-4567'),
('10.0.0.0/8', '+1-555-987-6543'),
('172.16.0.0/12', '+1-555-555-5555');

-- SP-GiST index for INET types
CREATE INDEX idx_network_ip_spgist ON network_data USING SPGIST (ip_address);

-- SP-GiST for text with specific patterns
CREATE INDEX idx_network_phone_spgist ON network_data USING SPGIST (phone_number);

-- Query examples
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM network_data 
WHERE ip_address << '192.168.0.0/16'::INET;
```

## Covering Indexes (INCLUDE)

### Include Non-Key Columns

```sql
-- Covering indexes to avoid table lookups
CREATE INDEX idx_customer_orders_covering ON customer_orders (customer_id, order_date) 
INCLUDE (total_amount, status);

-- This query can be satisfied entirely from the index
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, order_date, total_amount, status
FROM customer_orders 
WHERE customer_id = 123 
  AND order_date >= '2024-01-01'
ORDER BY order_date;

-- Compare with and without covering index
CREATE INDEX idx_customer_orders_regular ON customer_orders (customer_id, order_date);

-- Show the difference in index-only scans
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, order_date -- Only key columns
FROM customer_orders 
WHERE customer_id = 123;
```

## Index Maintenance and Monitoring

### Index Usage Statistics

```sql
-- Monitor index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan,
    CASE 
        WHEN idx_scan = 0 THEN 'Never used'
        WHEN idx_scan < 10 THEN 'Rarely used'
        ELSE 'Actively used'
    END as usage_level
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Find unused indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as size
FROM pg_stat_user_indexes 
WHERE idx_scan = 0 
  AND schemaname = 'public'
ORDER BY pg_relation_size(indexname::regclass) DESC;

-- Index bloat detection
WITH index_bloat AS (
    SELECT 
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size,
        pg_relation_size(indexname::regclass) as size_bytes,
        100 * (pg_relation_size(indexname::regclass) - pg_relation_size(tablename::regclass)) / 
            NULLIF(pg_relation_size(tablename::regclass), 0) as bloat_ratio
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
)
SELECT *
FROM index_bloat
WHERE bloat_ratio > 50
ORDER BY size_bytes DESC;
```

### Index Maintenance Operations

```sql
-- Rebuild bloated indexes
REINDEX INDEX idx_customer_orders_customer_id;

-- Rebuild all indexes on a table
REINDEX TABLE customer_orders;

-- Concurrent index rebuilding (available for B-tree)
CREATE INDEX CONCURRENTLY idx_customer_orders_customer_id_new ON customer_orders (customer_id);
DROP INDEX idx_customer_orders_customer_id;
ALTER INDEX idx_customer_orders_customer_id_new RENAME TO idx_customer_orders_customer_id;

-- Check index validity after concurrent operations
SELECT 
    indexname,
    indisvalid,
    indisready
FROM pg_index i
JOIN pg_class c ON i.indexrelid = c.oid
WHERE c.relname LIKE 'idx_customer_orders%';
```

## Index Strategy Guidelines

### Choosing the Right Index Type

```sql
-- Decision matrix for index types
CREATE TABLE index_decision_guide AS
WITH index_types AS (
    SELECT 'B-tree' as index_type, 'Equality, ranges, sorting' as best_for, 'General purpose' as use_case
    UNION ALL SELECT 'Hash', 'Equality only', 'High-volume equality lookups'
    UNION ALL SELECT 'GIN', 'Contains, overlap, full-text', 'Arrays, JSONB, text search'
    UNION ALL SELECT 'GiST', 'Geometric, ranges, nearest neighbor', 'Spatial data, ranges'
    UNION ALL SELECT 'BRIN', 'Range queries on ordered data', 'Very large tables with natural order'
    UNION ALL SELECT 'SP-GiST', 'Specialized partitioning', 'Non-balanced trees, specific types'
)
SELECT * FROM index_types;

-- Performance comparison framework
CREATE OR REPLACE FUNCTION compare_index_performance(
    table_name TEXT,
    query_pattern TEXT,
    iterations INTEGER DEFAULT 100
) RETURNS TABLE(
    index_type TEXT,
    avg_execution_time NUMERIC,
    total_time NUMERIC
) AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    i INTEGER;
BEGIN
    -- This is a template for performance testing
    -- Actual implementation would vary based on specific use case
    RETURN QUERY
    SELECT 
        'B-tree'::TEXT,
        random()::NUMERIC * 10,
        random()::NUMERIC * 100;
END;
$$ LANGUAGE plpgsql;
```

### Index Best Practices

```sql
-- Comprehensive indexing strategy
CREATE TABLE best_practices_example (
    id SERIAL PRIMARY KEY,                    -- Automatic B-tree index
    user_id INTEGER NOT NULL,                 -- Foreign key - needs index
    email TEXT UNIQUE,                        -- Unique constraint - automatic index
    status TEXT NOT NULL,                     -- Frequently filtered - index candidate
    created_at TIMESTAMP DEFAULT NOW(),       -- Time-based queries - index candidate
    metadata JSONB,                          -- Semi-structured data - GIN candidate
    tags TEXT[],                             -- Array data - GIN candidate
    coordinates POINT,                       -- Spatial data - GiST candidate
    active_period TSRANGE                    -- Range data - GiST candidate
);

-- Strategic index creation
CREATE INDEX idx_bp_user_id ON best_practices_example (user_id);
CREATE INDEX idx_bp_status_created ON best_practices_example (status, created_at);
CREATE INDEX idx_bp_created_desc ON best_practices_example (created_at DESC);
CREATE INDEX idx_bp_metadata_gin ON best_practices_example USING GIN (metadata);
CREATE INDEX idx_bp_tags_gin ON best_practices_example USING GIN (tags);
CREATE INDEX idx_bp_coordinates_gist ON best_practices_example USING GiST (coordinates);
CREATE INDEX idx_bp_active_period_gist ON best_practices_example USING GiST (active_period);

-- Partial indexes for common patterns
CREATE INDEX idx_bp_active_users ON best_practices_example (user_id, created_at)
WHERE status = 'active';

-- Covering index for common queries
CREATE INDEX idx_bp_covering ON best_practices_example (user_id, status)
INCLUDE (email, created_at);
```

## Query Plan Analysis

### Understanding Index Usage

```sql
-- Analyze query plans for index effectiveness
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT 
    bp.user_id,
    bp.email,
    bp.status,
    bp.created_at
FROM best_practices_example bp
WHERE bp.status = 'active'
  AND bp.created_at >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY bp.created_at DESC
LIMIT 10;

-- Function to analyze index usage patterns
CREATE OR REPLACE FUNCTION analyze_query_indexes(query_text TEXT)
RETURNS TABLE(
    node_type TEXT,
    index_name TEXT,
    index_cond TEXT,
    rows_estimated BIGINT,
    rows_actual BIGINT,
    execution_time NUMERIC
) AS $$
BEGIN
    -- This would parse EXPLAIN output to extract index information
    -- Simplified example
    RETURN QUERY
    SELECT 
        'Index Scan'::TEXT,
        'idx_example'::TEXT,
        'status = active'::TEXT,
        1000::BIGINT,
        950::BIGINT,
        0.125::NUMERIC;
END;
$$ LANGUAGE plpgsql;
```

## Next Steps

In the next lesson, we'll explore PostgreSQL's concurrency and transaction systems, including how MVCC works with indexes and the impact of different isolation levels on query performance.

Understanding indexing deeply enables you to design systems that maintain excellent performance even as data volumes grow, and provides the foundation for more advanced topics like partitioning and performance optimization.
