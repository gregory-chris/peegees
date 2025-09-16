# Query Language Enhancements

## Introduction

PostgreSQL extends standard SQL with powerful features that enable complex data operations, advanced analytics, and elegant solutions to common problems. These enhancements can dramatically simplify application logic and improve performance when used appropriately.

## RETURNING Clause: Capture Modified Data

### Basic RETURNING Usage

The RETURNING clause allows you to retrieve values from modified rows without requiring a separate SELECT query. This is particularly useful for getting auto-generated IDs, timestamps, or computed values after INSERT, UPDATE, or DELETE operations.

```sql
-- Setup demo table
CREATE TABLE inventory (
    item_id SERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price NUMERIC(10,2),
    last_updated TIMESTAMP DEFAULT NOW()
);

-- INSERT with RETURNING
INSERT INTO inventory (product_name, quantity, price) VALUES 
('Widget A', 100, 29.99),
('Widget B', 50, 49.99),
('Gadget X', 25, 199.99)
RETURNING item_id, product_name, quantity * price as total_value;

-- UPDATE with RETURNING
UPDATE inventory 
SET quantity = quantity - 10,
    last_updated = NOW()
WHERE product_name LIKE 'Widget%'
RETURNING item_id, product_name, quantity as remaining_quantity, last_updated;

-- DELETE with RETURNING for audit trail
DELETE FROM inventory 
WHERE quantity = 0
RETURNING item_id, product_name, 'DELETED: ' || now()::TEXT as audit_message;
```

### Advanced RETURNING Patterns

RETURNING can be combined with CTEs, UPSERT operations, and complex calculations to create powerful data processing pipelines. It's especially valuable in OLTP systems where you need immediate feedback from data modifications.

```sql
-- RETURNING with calculations
WITH sale_transaction AS (
    UPDATE inventory 
    SET quantity = quantity - 5
    WHERE item_id = 1
    RETURNING item_id, product_name, quantity as new_quantity, price
)
SELECT 
    item_id,
    product_name,
    new_quantity,
    price,
    5 * price as sale_amount,
    CASE 
        WHEN new_quantity < 10 THEN 'REORDER NEEDED'
        ELSE 'OK'
    END as status
FROM sale_transaction;

-- RETURNING with UPSERT (INSERT ... ON CONFLICT)
INSERT INTO inventory (product_name, quantity, price) VALUES 
('Widget A', 20, 29.99)
ON CONFLICT (product_name) 
DO UPDATE SET 
    quantity = inventory.quantity + EXCLUDED.quantity,
    last_updated = NOW()
RETURNING 
    item_id, 
    product_name, 
    quantity,
    CASE 
        WHEN xmax = 0 THEN 'INSERTED'
        ELSE 'UPDATED'
    END as operation;
```

## Common Table Expressions (CTEs)

### Basic CTEs

Common Table Expressions provide a way to write auxiliary statements for use in a larger query. They improve readability by breaking complex queries into named, reusable components and can be referenced multiple times within the main query.

```sql
-- Simple CTE for readability
WITH recent_orders AS (
    SELECT customer_id, order_date, total_amount
    FROM orders 
    WHERE order_date >= CURRENT_DATE - INTERVAL '30 days'
),
customer_totals AS (
    SELECT 
        customer_id,
        COUNT(*) as order_count,
        SUM(total_amount) as total_spent,
        AVG(total_amount) as avg_order_value
    FROM recent_orders
    GROUP BY customer_id
)
SELECT 
    c.customer_name,
    ct.order_count,
    ct.total_spent,
    ct.avg_order_value,
    CASE 
        WHEN ct.total_spent > 1000 THEN 'VIP'
        WHEN ct.total_spent > 500 THEN 'Premium'
        ELSE 'Standard'
    END as customer_tier
FROM customer_totals ct
JOIN customers c ON c.customer_id = ct.customer_id
ORDER BY ct.total_spent DESC;
```

### Recursive CTEs

Recursive CTEs enable traversal of hierarchical data structures like organizational charts, file systems, or graphs. They use a base case and recursive case to iteratively build result sets, making complex tree operations manageable.

```sql
-- Employee hierarchy
CREATE TABLE employees_hierarchy (
    emp_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    manager_id INTEGER REFERENCES employees_hierarchy(emp_id),
    department TEXT,
    salary NUMERIC(10,2)
);

-- Sample hierarchical data
INSERT INTO employees_hierarchy (name, manager_id, department, salary) VALUES 
('CEO Alice', NULL, 'Executive', 200000),
('VP Bob', 1, 'Engineering', 150000),
('VP Carol', 1, 'Sales', 140000),
('Manager Dave', 2, 'Engineering', 120000),
('Manager Eve', 2, 'Engineering', 115000),
('Manager Frank', 3, 'Sales', 110000),
('Dev George', 4, 'Engineering', 95000),
('Dev Helen', 4, 'Engineering', 90000),
('Sales Ian', 6, 'Sales', 85000);

-- Recursive CTE to build org chart
WITH RECURSIVE org_chart AS (
    -- Base case: top-level employees (CEOs)
    SELECT 
        emp_id,
        name,
        manager_id,
        department,
        salary,
        0 as level,
        name::TEXT as path,
        ARRAY[emp_id] as path_ids
    FROM employees_hierarchy 
    WHERE manager_id IS NULL
    
    UNION ALL
    
    -- Recursive case: employees with managers
    SELECT 
        e.emp_id,
        e.name,
        e.manager_id,
        e.department,
        e.salary,
        oc.level + 1,
        oc.path || ' -> ' || e.name,
        oc.path_ids || e.emp_id
    FROM employees_hierarchy e
    JOIN org_chart oc ON e.manager_id = oc.emp_id
)
SELECT 
    repeat('  ', level) || name as indented_name,
    level,
    department,
    salary,
    path,
    array_length(path_ids, 1) as depth
FROM org_chart 
ORDER BY path_ids;
```

### Advanced Recursive Examples

Advanced recursive patterns handle complex scenarios like cycle detection, path finding, and graph traversal. These examples show how to prevent infinite loops and extract meaningful information from interconnected data.

```sql
-- Bill of Materials (BOM) explosion
CREATE TABLE parts (
    part_id SERIAL PRIMARY KEY,
    part_name TEXT NOT NULL,
    unit_cost NUMERIC(8,2)
);

CREATE TABLE bill_of_materials (
    parent_part_id INTEGER REFERENCES parts(part_id),
    child_part_id INTEGER REFERENCES parts(part_id),
    quantity INTEGER NOT NULL,
    PRIMARY KEY (parent_part_id, child_part_id)
);

-- Sample data
INSERT INTO parts (part_name, unit_cost) VALUES 
('Computer', 0),      -- 1: Assembly
('Motherboard', 150), -- 2
('CPU', 300),         -- 3
('RAM', 100),         -- 4
('Capacitor', 0.50),  -- 5
('Resistor', 0.25);   -- 6

INSERT INTO bill_of_materials VALUES 
(1, 2, 1), -- Computer contains 1 Motherboard
(1, 3, 1), -- Computer contains 1 CPU
(1, 4, 2), -- Computer contains 2 RAM modules
(2, 5, 10), -- Motherboard contains 10 Capacitors
(2, 6, 20); -- Motherboard contains 20 Resistors

-- Recursive BOM explosion with costs
WITH RECURSIVE bom_explosion AS (
    -- Starting part
    SELECT 
        p.part_id,
        p.part_name,
        p.unit_cost,
        1::INTEGER as quantity,
        0 as level,
        ARRAY[p.part_id] as path
    FROM parts p 
    WHERE p.part_id = 1 -- Computer
    
    UNION ALL
    
    -- Explode sub-assemblies
    SELECT 
        p.part_id,
        p.part_name,
        p.unit_cost,
        be.quantity * bom.quantity,
        be.level + 1,
        be.path || p.part_id
    FROM bom_explosion be
    JOIN bill_of_materials bom ON be.part_id = bom.parent_part_id
    JOIN parts p ON bom.child_part_id = p.part_id
    WHERE NOT (p.part_id = ANY(be.path)) -- Prevent cycles
)
SELECT 
    repeat('  ', level) || part_name as indented_part,
    quantity,
    unit_cost,
    quantity * unit_cost as extended_cost,
    level
FROM bom_explosion
ORDER BY path;

-- Total cost rollup
WITH RECURSIVE bom_explosion AS (
    SELECT 
        p.part_id, p.part_name, p.unit_cost,
        1::INTEGER as quantity, 0 as level,
        ARRAY[p.part_id] as path
    FROM parts p WHERE p.part_id = 1
    
    UNION ALL
    
    SELECT 
        p.part_id, p.part_name, p.unit_cost,
        be.quantity * bom.quantity, be.level + 1,
        be.path || p.part_id
    FROM bom_explosion be
    JOIN bill_of_materials bom ON be.part_id = bom.parent_part_id
    JOIN parts p ON bom.child_part_id = p.part_id
    WHERE NOT (p.part_id = ANY(be.path))
)
SELECT 
    'Computer Total Cost' as description,
    SUM(quantity * unit_cost) as total_cost
FROM bom_explosion 
WHERE unit_cost > 0; -- Exclude assemblies
```

## Window Functions

### Basic Window Functions

Window functions perform calculations across a set of rows related to the current row without collapsing the result set like aggregate functions. They provide powerful analytical capabilities for ranking, running totals, and comparative analysis.

```sql
-- Sales data for window function examples
CREATE TABLE sales_performance (
    sale_id SERIAL PRIMARY KEY,
    sales_rep TEXT NOT NULL,
    region TEXT NOT NULL,
    sale_date DATE NOT NULL,
    amount NUMERIC(10,2) NOT NULL
);

-- Sample data
INSERT INTO sales_performance (sales_rep, region, sale_date, amount) VALUES 
('Alice', 'North', '2024-01-15', 1200),
('Bob', 'North', '2024-01-20', 1500),
('Carol', 'South', '2024-01-18', 1100),
('Alice', 'North', '2024-02-10', 1350),
('Dave', 'East', '2024-01-25', 1800),
('Carol', 'South', '2024-02-05', 1250),
('Bob', 'North', '2024-02-15', 1650),
('Eve', 'West', '2024-01-30', 1400),
('Dave', 'East', '2024-02-20', 1900),
('Eve', 'West', '2024-02-12', 1550);

-- Window function examples
SELECT 
    sales_rep,
    region,
    sale_date,
    amount,
    
    -- Running total by sales rep
    SUM(amount) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date 
        ROWS UNBOUNDED PRECEDING
    ) as running_total,
    
    -- Rank within region
    RANK() OVER (
        PARTITION BY region 
        ORDER BY amount DESC
    ) as region_rank,
    
    -- Dense rank globally
    DENSE_RANK() OVER (ORDER BY amount DESC) as global_rank,
    
    -- Row number within partition
    ROW_NUMBER() OVER (
        PARTITION BY region 
        ORDER BY sale_date
    ) as sale_sequence,
    
    -- Percentage of total by region
    ROUND(
        100.0 * amount / SUM(amount) OVER (PARTITION BY region), 
        2
    ) as pct_of_region_total,
    
    -- Moving average (3-sale window)
    AVG(amount) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date 
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) as moving_avg_3,
    
    -- Previous and next sale amounts
    LAG(amount, 1) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date
    ) as prev_sale,
    
    LEAD(amount, 1) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date
    ) as next_sale,
    
    -- First and last values in partition
    FIRST_VALUE(amount) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date 
        ROWS UNBOUNDED PRECEDING
    ) as first_sale,
    
    LAST_VALUE(amount) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date 
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as last_sale
    
FROM sales_performance
ORDER BY region, sales_rep, sale_date;
```

### Advanced Window Function Patterns

Advanced window function patterns solve complex analytical problems like gap detection, streak analysis, and statistical calculations. These techniques are essential for time-series analysis and business intelligence applications.

```sql
-- Gap and island detection
WITH sales_with_gaps AS (
    SELECT 
        sales_rep,
        sale_date,
        amount,
        sale_date - LAG(sale_date, 1, sale_date) OVER (
            PARTITION BY sales_rep 
            ORDER BY sale_date
        ) as days_since_last_sale
    FROM sales_performance
),
gap_groups AS (
    SELECT 
        *,
        SUM(CASE WHEN days_since_last_sale > 7 THEN 1 ELSE 0 END) OVER (
            PARTITION BY sales_rep 
            ORDER BY sale_date 
            ROWS UNBOUNDED PRECEDING
        ) as gap_group
    FROM sales_with_gaps
)
SELECT 
    sales_rep,
    gap_group,
    MIN(sale_date) as streak_start,
    MAX(sale_date) as streak_end,
    COUNT(*) as sales_in_streak,
    SUM(amount) as streak_total
FROM gap_groups
GROUP BY sales_rep, gap_group
ORDER BY sales_rep, streak_start;

-- Percentiles and quartiles
SELECT 
    region,
    sales_rep,
    amount,
    
    -- Percentile rank
    PERCENT_RANK() OVER (ORDER BY amount) as percentile_rank,
    
    -- Cumulative distribution
    CUME_DIST() OVER (ORDER BY amount) as cumulative_dist,
    
    -- Ntile (quartiles)
    NTILE(4) OVER (ORDER BY amount) as quartile,
    
    -- Percentile values
    PERCENTILE_CONT(0.5) OVER (PARTITION BY region) as region_median,
    PERCENTILE_DISC(0.5) OVER (PARTITION BY region) as region_median_discrete
    
FROM sales_performance
ORDER BY amount DESC;
```

## FILTER Clause

### Conditional Aggregations

The FILTER clause enables selective aggregation by applying conditions to aggregate functions. This eliminates the need for complex CASE statements and provides cleaner, more readable conditional calculations.

```sql
-- Using FILTER for conditional aggregations
SELECT 
    region,
    
    -- Count all sales
    COUNT(*) as total_sales,
    
    -- Count high-value sales
    COUNT(*) FILTER (WHERE amount > 1500) as high_value_sales,
    
    -- Sum by condition
    SUM(amount) as total_amount,
    SUM(amount) FILTER (WHERE amount > 1500) as high_value_amount,
    
    -- Average with filter
    AVG(amount) as overall_avg,
    AVG(amount) FILTER (WHERE amount > 1000) as high_avg,
    
    -- Multiple conditions
    COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM sale_date) = 1) as january_sales,
    COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM sale_date) = 2) as february_sales,
    
    -- Complex filters
    SUM(amount) FILTER (
        WHERE amount > 1200 AND sales_rep IN ('Alice', 'Bob')
    ) as top_reps_high_sales

FROM sales_performance
GROUP BY region
ORDER BY region;

-- FILTER with window functions
SELECT 
    sales_rep,
    sale_date,
    amount,
    
    -- Running count of high-value sales
    COUNT(*) FILTER (WHERE amount > 1500) OVER (
        PARTITION BY sales_rep 
        ORDER BY sale_date 
        ROWS UNBOUNDED PRECEDING
    ) as running_high_value_count,
    
    -- Percentage of high-value sales over time
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE amount > 1500) OVER (
            PARTITION BY sales_rep 
            ORDER BY sale_date 
            ROWS UNBOUNDED PRECEDING
        ) / COUNT(*) OVER (
            PARTITION BY sales_rep 
            ORDER BY sale_date 
            ROWS UNBOUNDED PRECEDING
        ), 2
    ) as pct_high_value

FROM sales_performance
ORDER BY sales_rep, sale_date;
```

## LATERAL Joins

### Basic LATERAL Usage

LATERAL joins allow subqueries to reference columns from preceding tables in the FROM clause. This enables correlated operations that would be difficult or impossible with standard joins, particularly useful for array processing and dynamic calculations.

```sql
-- LATERAL for correlated subqueries
SELECT 
    c.customer_name,
    c.customer_id,
    recent.order_count,
    recent.total_spent,
    recent.avg_amount,
    recent.latest_order
FROM customers c
LATERAL (
    SELECT 
        COUNT(*) as order_count,
        SUM(total_amount) as total_spent,
        AVG(total_amount) as avg_amount,
        MAX(order_date) as latest_order
    FROM orders o 
    WHERE o.customer_id = c.customer_id
      AND o.order_date >= CURRENT_DATE - INTERVAL '6 months'
) recent
WHERE recent.order_count > 0
ORDER BY recent.total_spent DESC;

-- LATERAL with functions
CREATE OR REPLACE FUNCTION get_top_products(cust_id INTEGER, limit_count INTEGER)
RETURNS TABLE(product_name TEXT, times_ordered BIGINT, total_quantity INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.name,
        COUNT(*)::BIGINT,
        SUM(oi.quantity)::INTEGER
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.product_id
    WHERE o.customer_id = cust_id
    GROUP BY p.product_id, p.name
    ORDER BY COUNT(*) DESC, SUM(oi.quantity) DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Use LATERAL with function
SELECT 
    c.customer_name,
    tp.product_name,
    tp.times_ordered,
    tp.total_quantity
FROM customers c
LATERAL get_top_products(c.customer_id, 3) tp
WHERE c.customer_type = 'Premium'
ORDER BY c.customer_name, tp.times_ordered DESC;
```

### Advanced LATERAL Patterns

Advanced LATERAL patterns enable sophisticated data transformations like array unnesting with context preservation, dynamic calculations, and complex aggregations that maintain row-level detail.

```sql
-- LATERAL for array unnesting with context
CREATE TABLE product_reviews (
    review_id SERIAL PRIMARY KEY,
    product_id INTEGER,
    reviewer_name TEXT,
    rating INTEGER,
    tags TEXT[],
    review_date DATE
);

-- Sample data
INSERT INTO product_reviews (product_id, reviewer_name, rating, tags, review_date) VALUES 
(1, 'Alice', 5, ARRAY['excellent', 'fast', 'reliable'], '2024-01-15'),
(1, 'Bob', 4, ARRAY['good', 'value'], '2024-01-20'),
(2, 'Carol', 3, ARRAY['okay', 'slow'], '2024-01-18');

-- LATERAL to unnest arrays with review context
SELECT 
    pr.product_id,
    pr.reviewer_name,
    pr.rating,
    pr.review_date,
    tag_info.tag,
    tag_info.tag_position
FROM product_reviews pr
LATERAL (
    SELECT 
        unnest(pr.tags) as tag,
        generate_subscripts(pr.tags, 1) as tag_position
) tag_info
ORDER BY pr.product_id, pr.review_date, tag_info.tag_position;

-- LATERAL for complex calculations
SELECT 
    sp.sales_rep,
    sp.region,
    calc.total_sales,
    calc.avg_sale,
    calc.best_month,
    calc.performance_score
FROM (SELECT DISTINCT sales_rep, region FROM sales_performance) sp
LATERAL (
    SELECT 
        COUNT(*) as total_sales,
        AVG(amount) as avg_sale,
        to_char(date_trunc('month', sale_date), 'YYYY-MM') as best_month,
        CASE 
            WHEN AVG(amount) > 1500 THEN 'Excellent'
            WHEN AVG(amount) > 1200 THEN 'Good'
            ELSE 'Needs Improvement'
        END as performance_score
    FROM sales_performance sp2
    WHERE sp2.sales_rep = sp.sales_rep
    GROUP BY date_trunc('month', sale_date)
    ORDER BY AVG(amount) DESC
    LIMIT 1
) calc
ORDER BY calc.avg_sale DESC;
```

## JSON/JSONB Querying

### Basic JSON Operations

PostgreSQL's JSON and JSONB support includes operators for extraction, modification, and querying. These operations provide flexible data handling while maintaining the benefits of relational integrity and ACID properties.

```sql
-- JSON data examples
CREATE TABLE api_logs (
    log_id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT NOW(),
    request_data JSONB,
    response_data JSONB,
    metadata JSONB
);

-- Sample JSON data
INSERT INTO api_logs (request_data, response_data, metadata) VALUES 
(
    '{
        "method": "POST",
        "endpoint": "/api/users",
        "headers": {"content-type": "application/json", "authorization": "Bearer token123"},
        "body": {"name": "John Doe", "email": "john@example.com", "age": 30}
    }',
    '{
        "status": 201,
        "body": {"id": 123, "name": "John Doe", "created_at": "2024-01-15T10:30:00Z"},
        "headers": {"content-type": "application/json"}
    }',
    '{
        "client_ip": "192.168.1.100",
        "user_agent": "Mozilla/5.0...",
        "processing_time_ms": 45,
        "database_queries": 3
    }'
);

-- Basic JSON querying
SELECT 
    log_id,
    timestamp,
    
    -- Extract values
    request_data->>'method' as http_method,
    request_data->'body'->>'name' as user_name,
    response_data->'body'->>'id' as created_user_id,
    
    -- Extract numbers
    (metadata->>'processing_time_ms')::INTEGER as processing_time,
    
    -- Check for key existence
    request_data ? 'body' as has_body,
    response_data->'headers' ? 'content-type' as has_content_type,
    
    -- Path extraction
    request_data #> '{body, email}' as user_email,
    request_data #>> '{headers, authorization}' as auth_header

FROM api_logs;
```

### Advanced JSON Querying

Advanced JSON operations include path-based queries, aggregations, and transformations. These capabilities enable complex data analysis directly on JSON structures without requiring separate document databases.

```sql
-- JSON path queries (PostgreSQL 12+)
SELECT 
    log_id,
    
    -- JSON path with conditions
    jsonb_path_query(request_data, '$.headers.* ? (@ like_regex "Bearer.*")') as bearer_tokens,
    
    -- Multiple path results
    jsonb_path_query_array(response_data, '$.body.*') as all_response_values,
    
    -- Conditional paths
    jsonb_path_exists(metadata, '$.processing_time_ms ? (@ > 40)') as slow_request,
    
    -- Complex path expressions
    jsonb_path_query(
        request_data, 
        '$.body.* ? (@.type() == "string" && @ != "")'
    ) as non_empty_strings

FROM api_logs;

-- JSON aggregations
SELECT 
    request_data->>'method' as method,
    
    -- Count and group by JSON values
    COUNT(*) as request_count,
    
    -- Aggregate JSON paths
    AVG((metadata->>'processing_time_ms')::INTEGER) as avg_processing_time,
    
    -- Collect JSON objects
    jsonb_agg(response_data->'body') as all_response_bodies,
    
    -- Build JSON objects from aggregations
    jsonb_build_object(
        'total_requests', COUNT(*),
        'avg_processing_time', AVG((metadata->>'processing_time_ms')::INTEGER),
        'unique_endpoints', COUNT(DISTINCT request_data->>'endpoint')
    ) as method_stats

FROM api_logs
GROUP BY request_data->>'method';

-- JSON modification
UPDATE api_logs 
SET metadata = metadata || '{"processed": true, "analysis_date": "2024-01-15"}'::JSONB
WHERE (metadata->>'processing_time_ms')::INTEGER > 40;

-- JSON path updates
UPDATE api_logs 
SET request_data = jsonb_set(
    request_data, 
    '{headers, x-processed}', 
    '"true"'::JSONB
)
WHERE log_id = 1;
```

## Full-Text Search

### Basic Text Search

PostgreSQL's full-text search capabilities include stemming, ranking, and phrase queries. The built-in text search is often sufficient for applications requiring search functionality without external search engines.

```sql
-- Full-text search setup
CREATE TABLE documents (
    doc_id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    search_vector TSVECTOR
);

-- Generate search vectors
UPDATE documents 
SET search_vector = to_tsvector('english', title || ' ' || content);

-- Create GIN index for fast searching
CREATE INDEX idx_documents_search ON documents USING GIN (search_vector);

-- Sample documents
INSERT INTO documents (title, content, author) VALUES 
('PostgreSQL Performance Tuning', 'Learn how to optimize PostgreSQL queries and configuration for better performance...', 'Alice DB'),
('Advanced SQL Techniques', 'Explore window functions, CTEs, and complex joins in PostgreSQL...', 'Bob Query'),
('Database Design Patterns', 'Best practices for designing scalable database schemas...', 'Carol Schema');

-- Update search vectors
UPDATE documents 
SET search_vector = to_tsvector('english', title || ' ' || content);

-- Basic text search
SELECT 
    doc_id,
    title,
    author,
    ts_rank(search_vector, to_tsquery('english', 'PostgreSQL & performance')) as rank
FROM documents
WHERE search_vector @@ to_tsquery('english', 'PostgreSQL & performance')
ORDER BY rank DESC;

-- Advanced text search with highlighting
SELECT 
    doc_id,
    title,
    ts_headline(
        'english', 
        content, 
        to_tsquery('english', 'PostgreSQL | database'),
        'MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=FALSE'
    ) as highlighted_content,
    ts_rank_cd(search_vector, to_tsquery('english', 'PostgreSQL | database')) as rank
FROM documents
WHERE search_vector @@ to_tsquery('english', 'PostgreSQL | database')
ORDER BY rank DESC;
```

### Advanced Text Search Patterns

Advanced text search patterns include custom rankings, phrase distance, and search result highlighting. These features provide sophisticated search capabilities comparable to dedicated search engines.

```sql
-- Phrase search and proximity
SELECT 
    title,
    ts_rank(search_vector, phraseto_tsquery('english', 'database design')) as phrase_rank,
    ts_rank(search_vector, to_tsquery('english', 'database <-> design')) as adjacent_rank,
    ts_rank(search_vector, to_tsquery('english', 'database <2> design')) as proximity_rank
FROM documents
WHERE search_vector @@ (
    phraseto_tsquery('english', 'database design') ||
    to_tsquery('english', 'database <-> design') ||
    to_tsquery('english', 'database <2> design')
)
ORDER BY phrase_rank DESC;

-- Multi-language and custom configurations
CREATE TEXT SEARCH CONFIGURATION code_search (COPY = english);
ALTER TEXT SEARCH CONFIGURATION code_search
    DROP MAPPING FOR word, asciiword;

-- Search with custom configuration
SELECT 
    title,
    content,
    ts_rank(
        to_tsvector('code_search', title || ' ' || content),
        to_tsquery('code_search', 'SELECT | INSERT | UPDATE')
    ) as code_rank
FROM documents
WHERE to_tsvector('code_search', title || ' ' || content) 
      @@ to_tsquery('code_search', 'SELECT | INSERT | UPDATE');
```

## Pattern Matching

### Advanced Pattern Matching

Pattern matching in PostgreSQL extends beyond basic LIKE operations to include regular expressions, similarity functions, and fuzzy matching. These tools are essential for data cleaning, validation, and flexible search operations.

```sql
-- Pattern matching examples
CREATE TABLE log_entries (
    entry_id SERIAL PRIMARY KEY,
    log_level TEXT,
    message TEXT,
    source_ip INET,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- Sample log data
INSERT INTO log_entries (log_level, message, source_ip) VALUES 
('ERROR', 'Database connection failed: timeout after 30s', '192.168.1.100'),
('WARN', 'Slow query detected: SELECT took 2.5s', '10.0.0.1'),
('INFO', 'User login successful for user_id=12345', '203.0.113.1'),
('ERROR', 'Authentication failed for username: admin', '192.168.1.200');

-- Regular expression matching
SELECT 
    entry_id,
    log_level,
    message,
    
    -- Extract patterns
    (regexp_match(message, 'timeout after (\d+)s'))[1] as timeout_seconds,
    (regexp_match(message, 'took (\d+\.?\d*)s'))[1] as query_duration,
    (regexp_match(message, 'user_id=(\d+)'))[1] as user_id,
    
    -- Boolean regex matching
    message ~ 'failed' as is_failure,
    message ~* 'USER' as mentions_user, -- case insensitive
    
    -- Replace patterns
    regexp_replace(message, '\d+', 'XXX', 'g') as sanitized_message

FROM log_entries;

-- Complex pattern extraction
WITH extracted_data AS (
    SELECT 
        entry_id,
        log_level,
        message,
        regexp_match(message, '(\w+): (.+)') as key_value,
        regexp_matches(message, '\b\d+\.?\d*\b', 'g') as all_numbers
    FROM log_entries
)
SELECT 
    entry_id,
    log_level,
    message,
    key_value[1] as error_type,
    key_value[2] as error_detail,
    array_to_string(array_agg(all_numbers[1]), ', ') as extracted_numbers
FROM extracted_data
LEFT JOIN LATERAL unnest(COALESCE(all_numbers, ARRAY[ARRAY['0']])) as all_numbers ON true
GROUP BY entry_id, log_level, message, key_value
ORDER BY entry_id;
```

## Query Optimization with Advanced Features

### Combining Multiple Enhancements

Real-world applications benefit from combining multiple PostgreSQL enhancements in single queries. This comprehensive example demonstrates how window functions, CTEs, JSON operations, and other features work together for complex analytics.

```sql
-- Complex analytical query combining multiple features
WITH RECURSIVE date_series AS (
    -- Generate date series
    SELECT '2024-01-01'::DATE as report_date
    UNION ALL
    SELECT report_date + INTERVAL '1 day'
    FROM date_series
    WHERE report_date < '2024-12-31'::DATE
),
daily_sales AS (
    SELECT 
        sp.sale_date,
        sp.region,
        sp.sales_rep,
        sp.amount,
        
        -- Window functions for trends
        LAG(sp.amount, 1) OVER (
            PARTITION BY sp.sales_rep 
            ORDER BY sp.sale_date
        ) as prev_amount,
        
        AVG(sp.amount) OVER (
            PARTITION BY sp.sales_rep 
            ORDER BY sp.sale_date 
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) as rolling_avg_7day
        
    FROM sales_performance sp
    WHERE sp.sale_date >= '2024-01-01'
),
performance_metrics AS (
    SELECT 
        ds.report_date,
        COALESCE(dsales.region, 'No Sales') as region,
        
        -- Conditional aggregations with FILTER
        COUNT(dsales.amount) as daily_sales_count,
        SUM(dsales.amount) FILTER (WHERE dsales.amount > 1500) as high_value_sales,
        AVG(dsales.amount) FILTER (WHERE dsales.prev_amount IS NOT NULL) as avg_repeat_sales,
        
        -- JSON aggregation
        jsonb_agg(
            jsonb_build_object(
                'rep', dsales.sales_rep,
                'amount', dsales.amount,
                'trend', CASE 
                    WHEN dsales.amount > dsales.prev_amount THEN 'up'
                    WHEN dsales.amount < dsales.prev_amount THEN 'down'
                    ELSE 'stable'
                END
            ) ORDER BY dsales.amount DESC
        ) FILTER (WHERE dsales.sales_rep IS NOT NULL) as daily_details
        
    FROM date_series ds
    LEFT JOIN daily_sales dsales ON ds.report_date = dsales.sale_date
    GROUP BY ds.report_date, dsales.region
)
SELECT 
    report_date,
    region,
    daily_sales_count,
    COALESCE(high_value_sales, 0) as high_value_sales,
    ROUND(avg_repeat_sales, 2) as avg_repeat_sales,
    
    -- Rank days by performance
    DENSE_RANK() OVER (ORDER BY daily_sales_count DESC, high_value_sales DESC) as performance_rank,
    
    -- Show top performers from JSON
    jsonb_path_query(daily_details, '$[0].rep') as top_rep,
    jsonb_path_query(daily_details, '$[0].amount') as top_amount,
    
    daily_details
FROM performance_metrics
WHERE report_date <= CURRENT_DATE
ORDER BY performance_rank, report_date
LIMIT 20;
```

## Next Steps

In the next lesson, we'll dive deep into PostgreSQL's indexing capabilities, exploring different index types and how they interact with the advanced query patterns we've covered here.

These query enhancements form the foundation for building sophisticated analytical applications and can often replace complex application logic with elegant SQL solutions.
