# Partitioning & Performance Optimization

## Introduction

PostgreSQL's query optimizer and partitioning system are sophisticated tools for maintaining performance at scale. Understanding how the planner works, how to interpret execution plans, and when to use partitioning can mean the difference between a system that scales and one that doesn't.

## Understanding the Query Planner

### How PostgreSQL Chooses Execution Plans

```sql
-- Create tables for optimizer demonstrations
CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    country TEXT NOT NULL,
    signup_date DATE DEFAULT CURRENT_DATE,
    lifetime_value NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE orders (
    order_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(customer_id),
    order_date DATE NOT NULL,
    total_amount NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL,
    shipping_country TEXT
);

CREATE TABLE order_items (
    item_id BIGSERIAL PRIMARY KEY,
    order_id BIGINT REFERENCES orders(order_id),
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL
);

-- Generate sample data
INSERT INTO customers (name, email, country, signup_date, lifetime_value)
SELECT 
    'Customer ' || n,
    'customer' || n || '@example.com',
    (ARRAY['US', 'UK', 'DE', 'FR', 'CA', 'AU'])[1 + (n % 6)],
    CURRENT_DATE - (random() * 1000)::INTEGER,
    (random() * 10000)::NUMERIC(10,2)
FROM generate_series(1, 10000) n;

INSERT INTO orders (customer_id, order_date, total_amount, status, shipping_country)
SELECT 
    1 + (random() * 9999)::INTEGER,
    CURRENT_DATE - (random() * 365)::INTEGER,
    (random() * 1000 + 10)::NUMERIC(10,2),
    (ARRAY['pending', 'processing', 'shipped', 'delivered'])[1 + (random() * 3)::INTEGER],
    (ARRAY['US', 'UK', 'DE', 'FR', 'CA', 'AU'])[1 + (random() * 5)::INTEGER]
FROM generate_series(1, 50000);

-- Create appropriate indexes
CREATE INDEX idx_customers_country ON customers (country);
CREATE INDEX idx_customers_signup_date ON customers (signup_date);
CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_orders_order_date ON orders (order_date);
CREATE INDEX idx_orders_status ON orders (status);

-- Update table statistics
ANALYZE customers;
ANALYZE orders;
ANALYZE order_items;
```

### Reading EXPLAIN Plans

```sql
-- Basic EXPLAIN output
EXPLAIN 
SELECT c.name, c.country, COUNT(o.order_id) as order_count
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
WHERE c.country = 'US'
GROUP BY c.customer_id, c.name, c.country;

-- EXPLAIN ANALYZE for actual execution stats
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT c.name, c.country, COUNT(o.order_id) as order_count
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
WHERE c.country = 'US'
GROUP BY c.customer_id, c.name, c.country;

-- Detailed format for better readability
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT c.name, o.order_date, o.total_amount
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE c.country = 'US' 
  AND o.order_date >= '2024-01-01'
  AND o.total_amount > 500
ORDER BY o.order_date DESC
LIMIT 10;
```

### Understanding Plan Nodes

```sql
-- Nested Loop vs Hash Join vs Merge Join
SET enable_hashjoin = off;
SET enable_mergejoin = off;
EXPLAIN ANALYZE
SELECT c.name, o.total_amount
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE c.country = 'US'
LIMIT 1000;

-- Enable hash joins
SET enable_hashjoin = on;
SET enable_mergejoin = off;
EXPLAIN ANALYZE
SELECT c.name, o.total_amount
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE c.country = 'US'
LIMIT 1000;

-- Reset to defaults
RESET enable_hashjoin;
RESET enable_mergejoin;

-- Compare different index strategies
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE order_date BETWEEN '2024-01-01' AND '2024-01-31';

-- Create covering index and compare
CREATE INDEX idx_orders_date_covering ON orders (order_date) 
INCLUDE (customer_id, total_amount, status);

EXPLAIN (ANALYZE, BUFFERS)
SELECT order_date, customer_id, total_amount, status 
FROM orders 
WHERE order_date BETWEEN '2024-01-01' AND '2024-01-31';
```

### Query Plan Analysis Tools

```sql
-- Function to analyze expensive queries
CREATE OR REPLACE FUNCTION analyze_query_performance(query_text TEXT)
RETURNS TABLE(
    operation TEXT,
    time_ms NUMERIC,
    rows_estimate BIGINT,
    rows_actual BIGINT,
    accuracy_ratio NUMERIC
) AS $$
DECLARE
    plan_json JSONB;
    explain_query TEXT;
BEGIN
    -- This is a simplified example - real implementation would parse EXPLAIN JSON
    explain_query := 'EXPLAIN (ANALYZE, FORMAT JSON) ' || query_text;
    
    -- In practice, you'd execute the EXPLAIN and parse the JSON
    -- For demonstration, return mock data
    RETURN QUERY 
    SELECT 
        'Hash Join'::TEXT,
        15.23::NUMERIC,
        1000::BIGINT,
        1200::BIGINT,
        1.2::NUMERIC;
END;
$$ LANGUAGE plpgsql;

-- Monitor query performance over time
CREATE TABLE query_performance_log (
    log_id SERIAL PRIMARY KEY,
    query_hash TEXT,
    query_text TEXT,
    execution_time_ms NUMERIC,
    rows_examined BIGINT,
    rows_returned BIGINT,
    execution_date TIMESTAMP DEFAULT NOW()
);

-- Function to log slow queries
CREATE OR REPLACE FUNCTION log_slow_query(
    p_query TEXT,
    p_execution_time NUMERIC,
    p_rows_examined BIGINT,
    p_rows_returned BIGINT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO query_performance_log (
        query_hash, query_text, execution_time_ms, 
        rows_examined, rows_returned
    ) VALUES (
        md5(p_query), p_query, p_execution_time,
        p_rows_examined, p_rows_returned
    );
END;
$$ LANGUAGE plpgsql;
```

## Declarative Partitioning Deep Dive

### Range Partitioning for Time-Series Data

```sql
-- Create partitioned table for time-series analytics
CREATE TABLE sales_analytics (
    sale_id BIGSERIAL,
    sale_date DATE NOT NULL,
    product_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    total_amount NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    region TEXT NOT NULL,
    sales_rep_id INTEGER,
    
    PRIMARY KEY (sale_id, sale_date)
) PARTITION BY RANGE (sale_date);

-- Create monthly partitions for 2024
CREATE TABLE sales_analytics_2024_01 PARTITION OF sales_analytics
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE sales_analytics_2024_02 PARTITION OF sales_analytics
FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE sales_analytics_2024_03 PARTITION OF sales_analytics
FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

-- Continue for remaining months...
CREATE TABLE sales_analytics_2024_04 PARTITION OF sales_analytics
FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE sales_analytics_2024_05 PARTITION OF sales_analytics
FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE sales_analytics_2024_06 PARTITION OF sales_analytics
FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

-- Default partition for data outside specific ranges
CREATE TABLE sales_analytics_default PARTITION OF sales_analytics DEFAULT;

-- Generate sample sales data
INSERT INTO sales_analytics (sale_date, product_id, customer_id, quantity, unit_price, region, sales_rep_id)
SELECT 
    '2024-01-01'::DATE + (random() * 180)::INTEGER,
    1 + (random() * 1000)::INTEGER,
    1 + (random() * 9999)::INTEGER,
    1 + (random() * 10)::INTEGER,
    (random() * 200 + 10)::NUMERIC(10,2),
    (ARRAY['North', 'South', 'East', 'West', 'Central'])[1 + (random() * 4)::INTEGER],
    1 + (random() * 50)::INTEGER
FROM generate_series(1, 100000);
```

### Hash Partitioning for Even Distribution

```sql
-- Create hash-partitioned table for user data
CREATE TABLE user_analytics (
    user_id BIGINT NOT NULL,
    username TEXT NOT NULL,
    activity_date DATE NOT NULL,
    page_views INTEGER DEFAULT 0,
    session_duration INTEGER DEFAULT 0,
    actions_count INTEGER DEFAULT 0,
    
    PRIMARY KEY (user_id, username)
) PARTITION BY HASH (user_id);

-- Create hash partitions
CREATE TABLE user_analytics_p0 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 0);

CREATE TABLE user_analytics_p1 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 1);

CREATE TABLE user_analytics_p2 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 2);

CREATE TABLE user_analytics_p3 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 3);

CREATE TABLE user_analytics_p4 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 4);

CREATE TABLE user_analytics_p5 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 5);

CREATE TABLE user_analytics_p6 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 6);

CREATE TABLE user_analytics_p7 PARTITION OF user_analytics
FOR VALUES WITH (modulus 8, remainder 7);

-- Sample user data
INSERT INTO user_analytics (user_id, username, activity_date, page_views, session_duration, actions_count)
SELECT 
    n,
    'user_' || n,
    CURRENT_DATE - (random() * 30)::INTEGER,
    (random() * 100)::INTEGER,
    (random() * 3600)::INTEGER,
    (random() * 50)::INTEGER
FROM generate_series(1, 100000) n;
```

### List Partitioning by Category

```sql
-- Create list-partitioned table for regional data
CREATE TABLE regional_sales (
    sale_id BIGSERIAL,
    region TEXT NOT NULL,
    country TEXT NOT NULL,
    sale_date DATE NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    
    PRIMARY KEY (sale_id, region)
) PARTITION BY LIST (region);

-- Regional partitions
CREATE TABLE regional_sales_americas PARTITION OF regional_sales
FOR VALUES IN ('US', 'CA', 'MX', 'BR', 'AR');

CREATE TABLE regional_sales_europe PARTITION OF regional_sales
FOR VALUES IN ('UK', 'DE', 'FR', 'IT', 'ES', 'NL');

CREATE TABLE regional_sales_asia PARTITION OF regional_sales
FOR VALUES IN ('JP', 'CN', 'IN', 'SG', 'KR', 'AU');

CREATE TABLE regional_sales_other PARTITION OF regional_sales DEFAULT;

-- Sample regional data
INSERT INTO regional_sales (region, country, sale_date, amount)
SELECT 
    (ARRAY['US', 'UK', 'DE', 'JP', 'CA', 'FR'])[1 + (random() * 5)::INTEGER],
    (ARRAY['US', 'UK', 'DE', 'JP', 'CA', 'FR'])[1 + (random() * 5)::INTEGER],
    CURRENT_DATE - (random() * 365)::INTEGER,
    (random() * 1000 + 10)::NUMERIC(10,2)
FROM generate_series(1, 50000);
```

### Multi-Level Partitioning

```sql
-- Multi-level partitioning: date then region
CREATE TABLE transaction_log (
    transaction_id BIGSERIAL,
    transaction_date DATE NOT NULL,
    region TEXT NOT NULL,
    customer_id INTEGER NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    
    PRIMARY KEY (transaction_id, transaction_date, region)
) PARTITION BY RANGE (transaction_date);

-- Year-level partitions
CREATE TABLE transaction_log_2024 PARTITION OF transaction_log
FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')
PARTITION BY LIST (region);

-- Region sub-partitions for 2024
CREATE TABLE transaction_log_2024_us PARTITION OF transaction_log_2024
FOR VALUES IN ('US');

CREATE TABLE transaction_log_2024_eu PARTITION OF transaction_log_2024
FOR VALUES IN ('UK', 'DE', 'FR', 'IT', 'ES');

CREATE TABLE transaction_log_2024_asia PARTITION OF transaction_log_2024
FOR VALUES IN ('JP', 'CN', 'IN', 'SG');

CREATE TABLE transaction_log_2024_other PARTITION OF transaction_log_2024 DEFAULT;
```

## Partition Pruning and Constraint Exclusion

### Understanding Partition Pruning

```sql
-- Demonstrate partition pruning
SET enable_partition_pruning = on;

-- Query that benefits from partition pruning
EXPLAIN (ANALYZE, BUFFERS)
SELECT region, COUNT(*), SUM(amount)
FROM sales_analytics 
WHERE sale_date BETWEEN '2024-03-01' AND '2024-03-31'
GROUP BY region;

-- Show which partitions are accessed
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM sales_analytics 
WHERE sale_date = '2024-02-15';

-- Multi-partition query
EXPLAIN (ANALYZE, BUFFERS)
SELECT region, AVG(total_amount)
FROM sales_analytics 
WHERE sale_date BETWEEN '2024-01-15' AND '2024-04-15'
GROUP BY region;

-- Disable partition pruning to see the difference
SET enable_partition_pruning = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM sales_analytics 
WHERE sale_date = '2024-02-15';

-- Re-enable
SET enable_partition_pruning = on;
```

### Runtime Partition Pruning

```sql
-- Runtime pruning with parameters
PREPARE partition_query AS
SELECT COUNT(*), AVG(total_amount)
FROM sales_analytics 
WHERE sale_date BETWEEN $1 AND $2;

-- Execute with different date ranges
EXPLAIN (ANALYZE, BUFFERS)
EXECUTE partition_query('2024-01-01', '2024-01-31');

EXPLAIN (ANALYZE, BUFFERS)
EXECUTE partition_query('2024-03-01', '2024-05-31');

-- Join with partition pruning
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.name, s.total_amount
FROM customers c
JOIN sales_analytics s ON c.customer_id = s.customer_id
WHERE c.country = 'US' 
  AND s.sale_date >= '2024-02-01' 
  AND s.sale_date < '2024-03-01';
```

## Performance Optimization Techniques

### Query Optimization Strategies

```sql
-- Index optimization for partitioned tables
CREATE INDEX idx_sales_analytics_2024_01_region ON sales_analytics_2024_01 (region, total_amount);
CREATE INDEX idx_sales_analytics_2024_01_product ON sales_analytics_2024_01 (product_id, sale_date);

-- Or create on parent (applies to all partitions)
CREATE INDEX idx_sales_analytics_customer ON sales_analytics (customer_id);

-- Analyze partition pruning effectiveness
WITH partition_stats AS (
    SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        seq_scan,
        idx_scan,
        n_live_tup as live_tuples
    FROM pg_stat_user_tables
    WHERE tablename LIKE 'sales_analytics_%'
)
SELECT 
    tablename,
    live_tuples,
    seq_scan,
    idx_scan,
    CASE 
        WHEN seq_scan + idx_scan = 0 THEN 0
        ELSE ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 2)
    END as index_usage_percent
FROM partition_stats
ORDER BY live_tuples DESC;
```

### Materialized Views for Aggregation

```sql
-- Create materialized view for common aggregations
CREATE MATERIALIZED VIEW monthly_sales_summary AS
SELECT 
    DATE_TRUNC('month', sale_date) as month,
    region,
    COUNT(*) as sale_count,
    SUM(total_amount) as total_revenue,
    AVG(total_amount) as avg_sale_amount,
    COUNT(DISTINCT customer_id) as unique_customers
FROM sales_analytics
GROUP BY DATE_TRUNC('month', sale_date), region;

-- Create index on materialized view
CREATE INDEX idx_monthly_sales_summary_month_region 
ON monthly_sales_summary (month, region);

-- Refresh materialized view
REFRESH MATERIALIZED VIEW monthly_sales_summary;

-- Query the materialized view instead of base table
EXPLAIN (ANALYZE, BUFFERS)
SELECT month, region, total_revenue
FROM monthly_sales_summary
WHERE month >= '2024-01-01' AND month < '2024-06-01'
ORDER BY total_revenue DESC;

-- Compare with querying base table
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    DATE_TRUNC('month', sale_date) as month,
    region,
    SUM(total_amount) as total_revenue
FROM sales_analytics
WHERE sale_date >= '2024-01-01' AND sale_date < '2024-06-01'
GROUP BY DATE_TRUNC('month', sale_date), region
ORDER BY total_revenue DESC;
```

### Parallel Query Execution

```sql
-- Configure parallel execution
SET max_parallel_workers_per_gather = 4;
SET parallel_tuple_cost = 0.1;
SET parallel_setup_cost = 1000;

-- Force parallel execution for testing
SET force_parallel_mode = on;

-- Parallel sequential scan
EXPLAIN (ANALYZE, BUFFERS)
SELECT region, COUNT(*), SUM(total_amount)
FROM sales_analytics
WHERE total_amount > 100
GROUP BY region;

-- Parallel join
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.country, COUNT(s.sale_id), SUM(s.total_amount)
FROM customers c
JOIN sales_analytics s ON c.customer_id = s.customer_id
WHERE s.sale_date >= '2024-01-01'
GROUP BY c.country;

-- Reset parallel settings
SET force_parallel_mode = off;
```

### Work Memory and Sort Optimization

```sql
-- Monitor sort operations
SET log_temp_files = 0; -- Log all temp file usage

-- Large sort that might spill to disk
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, sale_date, total_amount
FROM sales_analytics
ORDER BY total_amount DESC, sale_date;

-- Increase work_mem temporarily
SET work_mem = '256MB';

-- Same query with more memory
EXPLAIN (ANALYZE, BUFFERS)
SELECT customer_id, sale_date, total_amount
FROM sales_analytics
ORDER BY total_amount DESC, sale_date;

-- Reset work_mem
RESET work_mem;

-- Monitor temp file usage
SELECT 
    temp_files,
    temp_bytes,
    pg_size_pretty(temp_bytes) as temp_size
FROM pg_stat_database 
WHERE datname = current_database();
```

## Automated Partition Management

### Partition Creation Functions

```sql
-- Function to create monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partition(
    table_name TEXT,
    start_date DATE
) RETURNS TEXT AS $$
DECLARE
    partition_name TEXT;
    end_date DATE;
    sql_command TEXT;
BEGIN
    -- Calculate partition name and end date
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    end_date := start_date + INTERVAL '1 month';
    
    -- Create the partition
    sql_command := format(
        'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name, table_name, start_date, end_date
    );
    
    EXECUTE sql_command;
    
    -- Create indexes on the new partition
    EXECUTE format(
        'CREATE INDEX %I ON %I (sale_date, region)',
        'idx_' || partition_name || '_date_region', partition_name
    );
    
    EXECUTE format(
        'CREATE INDEX %I ON %I (customer_id)',
        'idx_' || partition_name || '_customer', partition_name
    );
    
    RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Create partitions for next 6 months
SELECT create_monthly_partition(
    'sales_analytics', 
    date_trunc('month', CURRENT_DATE) + (n || ' month')::INTERVAL
)
FROM generate_series(1, 6) n;

-- Function to drop old partitions
CREATE OR REPLACE FUNCTION drop_old_partitions(
    table_name TEXT,
    retention_period INTERVAL
) RETURNS INTEGER AS $$
DECLARE
    partition_record RECORD;
    cutoff_date DATE;
    dropped_count INTEGER := 0;
BEGIN
    cutoff_date := CURRENT_DATE - retention_period;
    
    -- Find partitions older than retention period
    FOR partition_record IN
        SELECT 
            schemaname,
            tablename
        FROM pg_tables 
        WHERE tablename LIKE table_name || '_%'
          AND tablename ~ '\d{4}_\d{2}$'
          AND to_date(
              substring(tablename from '.+_(\d{4}_\d{2})$'),
              'YYYY_MM'
          ) < cutoff_date
    LOOP
        EXECUTE format('DROP TABLE %I.%I', 
                      partition_record.schemaname, 
                      partition_record.tablename);
        dropped_count := dropped_count + 1;
        
        RAISE NOTICE 'Dropped partition: %', partition_record.tablename;
    END LOOP;
    
    RETURN dropped_count;
END;
$$ LANGUAGE plpgsql;

-- Drop partitions older than 2 years
SELECT drop_old_partitions('sales_analytics', INTERVAL '2 years');
```

### Automated Maintenance

```sql
-- Partition maintenance scheduler
CREATE TABLE partition_maintenance_log (
    log_id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    action TEXT NOT NULL,
    partition_name TEXT,
    execution_time TIMESTAMP DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    error_message TEXT
);

CREATE OR REPLACE FUNCTION maintain_partitions()
RETURNS VOID AS $$
DECLARE
    maintenance_record RECORD;
    partition_name TEXT;
    error_msg TEXT;
BEGIN
    -- List of tables that need partition maintenance
    FOR maintenance_record IN 
        SELECT 'sales_analytics' as table_name, '1 month'::INTERVAL as period
        UNION ALL
        SELECT 'transaction_log', '1 month'::INTERVAL
    LOOP
        BEGIN
            -- Create future partitions
            SELECT create_monthly_partition(
                maintenance_record.table_name,
                date_trunc('month', CURRENT_DATE + INTERVAL '1 month')
            ) INTO partition_name;
            
            INSERT INTO partition_maintenance_log 
            (table_name, action, partition_name, success)
            VALUES (maintenance_record.table_name, 'CREATE', partition_name, TRUE);
            
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
            INSERT INTO partition_maintenance_log 
            (table_name, action, success, error_message)
            VALUES (maintenance_record.table_name, 'CREATE', FALSE, error_msg);
        END;
        
        BEGIN
            -- Drop old partitions (older than 2 years)
            PERFORM drop_old_partitions(maintenance_record.table_name, INTERVAL '2 years');
            
            INSERT INTO partition_maintenance_log 
            (table_name, action, success)
            VALUES (maintenance_record.table_name, 'DROP_OLD', TRUE);
            
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
            INSERT INTO partition_maintenance_log 
            (table_name, action, success, error_message)
            VALUES (maintenance_record.table_name, 'DROP_OLD', FALSE, error_msg);
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule this function to run regularly (e.g., daily via cron)
SELECT maintain_partitions();
```

## Performance Monitoring and Tuning

### Query Performance Analysis

```sql
-- Monitor partition-wise operations
CREATE VIEW partition_performance AS
SELECT 
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as size
FROM pg_stat_user_tables
WHERE tablename LIKE 'sales_analytics_%'
   OR tablename LIKE 'transaction_log_%'
ORDER BY pg_relation_size(schemaname||'.'||tablename) DESC;

-- Identify hot partitions
SELECT 
    tablename,
    seq_scan + idx_scan as total_scans,
    seq_tup_read + idx_tup_fetch as total_tuples_read,
    n_tup_ins + n_tup_upd + n_tup_del as total_modifications,
    size
FROM partition_performance
WHERE seq_scan + idx_scan > 0
ORDER BY total_scans DESC;

-- Check constraint exclusion effectiveness
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT COUNT(*)
FROM sales_analytics
WHERE sale_date BETWEEN '2024-02-01' AND '2024-02-29';
```

### Index Usage on Partitions

```sql
-- Analyze index usage across partitions
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
FROM pg_stat_user_indexes 
WHERE tablename LIKE 'sales_analytics_%'
ORDER BY idx_scan DESC;

-- Find unused indexes on partitions
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as wasted_size
FROM pg_stat_user_indexes 
WHERE idx_scan = 0 
  AND tablename LIKE 'sales_analytics_%'
ORDER BY pg_relation_size(indexname::regclass) DESC;
```

## Next Steps

In the next lesson, we'll explore PostgreSQL's powerful extension system and procedural languages, which can help automate many of the optimization and maintenance tasks we've covered here.

Understanding partitioning and performance optimization provides the foundation for building systems that can handle massive amounts of data while maintaining responsive query performance.
