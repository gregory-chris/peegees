# Data Types & Advanced Structures

## Introduction

PostgreSQL's rich type system is one of its greatest strengths, offering far more than traditional relational databases. For experienced developers, understanding these advanced data types can eliminate the need for separate NoSQL solutions and dramatically simplify application architecture.

## Built-in Rich Types

### Arrays: First-Class Citizens

Unlike most databases, PostgreSQL treats arrays as native data types:

```sql
-- Create table with array columns
CREATE TABLE user_preferences (
    user_id INTEGER PRIMARY KEY,
    favorite_colors TEXT[],
    daily_temperatures NUMERIC(5,2)[],
    tags INTEGER[]
);

-- Insert array data
INSERT INTO user_preferences VALUES 
(1, ARRAY['red', 'blue', 'green'], ARRAY[23.5, 24.1, 22.8], ARRAY[1, 5, 9]),
(2, '{"purple", "yellow"}', '{25.0, 23.2, 26.1}', '{2, 3, 7, 11}');

-- Query array elements
SELECT 
    user_id,
    favorite_colors[1] as first_color,
    array_length(tags, 1) as tag_count,
    23.0 = ANY(daily_temperatures) as had_exact_temp
FROM user_preferences;
```

### Array Operations and Functions

PostgreSQL provides powerful operators and functions for working with arrays, enabling complex operations like concatenation, overlap detection, and element containment checks. These operations make arrays a viable alternative to normalized junction tables in many scenarios.

```sql
-- Array operators and functions
SELECT 
    -- Concatenation
    ARRAY[1,2,3] || ARRAY[4,5] as concatenated,
    
    -- Overlap check
    ARRAY[1,2,3] && ARRAY[3,4,5] as has_overlap,
    
    -- Contains
    ARRAY[1,2,3,4] @> ARRAY[2,3] as contains,
    
    -- Array to string
    array_to_string(ARRAY['a','b','c'], ',') as joined,
    
    -- Unnest array to rows
    unnest(ARRAY[1,2,3]) as individual_elements;

-- Practical example: Tag-based filtering
SELECT user_id, tags
FROM user_preferences 
WHERE tags @> ARRAY[5]; -- Users who have tag 5
```

### JSON and JSONB: Document Storage

```sql
-- Create table with JSON columns
CREATE TABLE product_catalog (
    product_id SERIAL PRIMARY KEY,
    metadata JSON,
    specifications JSONB, -- Binary JSON (preferred)
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert JSON data
INSERT INTO product_catalog (metadata, specifications) VALUES 
(
    '{"name": "Laptop Pro", "category": "electronics"}',
    '{
        "cpu": "Intel i7",
        "ram": "16GB",
        "storage": {"type": "SSD", "capacity": "512GB"},
        "ports": ["USB-C", "HDMI", "Thunderbolt"],
        "features": {
            "backlit_keyboard": true,
            "touchscreen": false,
            "weight_kg": 1.8
        }
    }'
);
```

### JSONB Operations and Indexing

JSONB (Binary JSON) offers advanced querying capabilities and indexing support that makes it superior to regular JSON for most use cases. The binary format enables efficient operations and GIN indexing for fast containment queries.

```sql
-- JSONB queries
SELECT 
    product_id,
    specifications->>'cpu' as processor,
    specifications->'storage'->>'capacity' as storage_size,
    specifications->'features'->'backlit_keyboard' as has_backlight
FROM product_catalog;

-- JSON path queries (PostgreSQL 12+)
SELECT 
    product_id,
    jsonb_path_query(specifications, '$.features.weight_kg') as weight,
    jsonb_path_exists(specifications, '$.ports[*] ? (@ == "USB-C")') as has_usb_c
FROM product_catalog;

-- Create GIN index for JSONB performance
CREATE INDEX idx_product_specs_gin ON product_catalog USING GIN (specifications);

-- Fast JSONB containment queries
SELECT product_id 
FROM product_catalog 
WHERE specifications @> '{"features": {"backlit_keyboard": true}}';
```

### UUID: Universal Identifiers

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create table with UUID primary key
CREATE TABLE distributed_entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    external_ref UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert with generated and explicit UUIDs
INSERT INTO distributed_entities (name, external_ref) VALUES 
('Entity 1', uuid_generate_v4()),
('Entity 2', '550e8400-e29b-41d4-a716-446655440000'::UUID);

-- UUID operations
SELECT 
    id,
    name,
    id::TEXT as uuid_string,
    md5(id::TEXT) as uuid_hash
FROM distributed_entities;
```

### Range Types: Continuous Data

```sql
-- Built-in range types
CREATE TABLE event_schedule (
    event_id SERIAL PRIMARY KEY,
    event_name TEXT,
    time_range TSRANGE, -- Timestamp range
    price_range NUMRANGE, -- Numeric range
    age_restriction INT4RANGE -- Integer range
);

-- Insert range data
INSERT INTO event_schedule (event_name, time_range, price_range, age_restriction) VALUES 
(
    'Concert A', 
    '[2024-12-01 19:00, 2024-12-01 22:00)',
    '[50.00, 150.00]',
    '[18, 65)'
),
(
    'Workshop B',
    '[2024-12-02 09:00, 2024-12-02 17:00)',
    '[25.00, 75.00)',
    '[16,)'
);

-- Range queries
SELECT 
    event_name,
    time_range,
    -- Check if ranges overlap
    time_range && '[2024-12-01 20:00, 2024-12-01 21:00)'::TSRANGE as overlaps_evening,
    -- Check if value is in range
    25 <@ age_restriction as allows_25_year_olds,
    -- Get range bounds
    lower(price_range) as min_price,
    upper(price_range) as max_price
FROM event_schedule;
```

### hstore: Key-Value Pairs

```sql
-- Enable hstore extension
CREATE EXTENSION IF NOT EXISTS hstore;

-- Create table with hstore column
CREATE TABLE server_config (
    server_id SERIAL PRIMARY KEY,
    hostname TEXT,
    config_params HSTORE
);

-- Insert hstore data
INSERT INTO server_config (hostname, config_params) VALUES 
(
    'web-server-01',
    'max_connections=>100, timeout=>30, ssl_enabled=>true, cache_size=>256MB'::HSTORE
),
(
    'db-server-01', 
    '"shared_buffers"=>"1GB", "work_mem"=>"64MB", "maintenance_work_mem"=>"256MB"'
);

-- hstore queries
SELECT 
    hostname,
    config_params->'max_connections' as max_conn,
    config_params ? 'ssl_enabled' as has_ssl_config,
    akeys(config_params) as all_keys,
    svals(config_params) as all_values
FROM server_config;

-- Convert hstore to JSON
SELECT 
    hostname,
    hstore_to_json(config_params) as config_json
FROM server_config;
```

## Composite and Custom Types

### Composite Types: Structured Data

```sql
-- Define composite types
CREATE TYPE address_type AS (
    street TEXT,
    city TEXT,
    state CHAR(2),
    zip_code TEXT,
    country CHAR(2)
);

CREATE TYPE contact_info AS (
    phone TEXT,
    email TEXT,
    address address_type
);

-- Use composite types
CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    name TEXT,
    contact contact_info,
    billing_address address_type,
    shipping_address address_type
);

-- Insert composite data
INSERT INTO customers (name, contact, billing_address) VALUES (
    'John Doe',
    ROW('555-1234', 'john@example.com', ROW('123 Main St', 'Anytown', 'NY', '12345', 'US')),
    ROW('456 Oak Ave', 'Other City', 'CA', '67890', 'US')
);

-- Query composite fields
SELECT 
    name,
    (contact).email,
    (contact.address).city,
    (billing_address).street || ', ' || (billing_address).city as billing_location
FROM customers;
```

### Domain Types: Constrained Types

```sql
-- Create domain types with constraints
CREATE DOMAIN email_address AS TEXT
CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE DOMAIN us_phone AS TEXT
CHECK (VALUE ~ '^\(\d{3}\) \d{3}-\d{4}$');

CREATE DOMAIN positive_money AS NUMERIC(10,2)
CHECK (VALUE > 0);

-- Use domains in tables
CREATE TABLE user_accounts (
    user_id SERIAL PRIMARY KEY,
    email email_address UNIQUE NOT NULL,
    phone us_phone,
    account_balance positive_money DEFAULT 0.00
);

-- Domain constraints are enforced
INSERT INTO user_accounts (email, phone, account_balance) VALUES 
('user@example.com', '(555) 123-4567', 100.50);

-- This would fail due to domain constraints:
-- INSERT INTO user_accounts (email) VALUES ('invalid-email');
```

### Enumerated Types

Enums provide type safety and performance benefits by restricting values to a predefined set while maintaining natural ordering. They're ideal for status fields, priority levels, and other categorical data with a known, limited set of values.

```sql
-- Create enum types
CREATE TYPE order_status AS ENUM (
    'pending', 'processing', 'shipped', 'delivered', 'cancelled'
);

CREATE TYPE priority_level AS ENUM (
    'low', 'medium', 'high', 'critical'
);

-- Use enums in tables
CREATE TABLE support_tickets (
    ticket_id SERIAL PRIMARY KEY,
    title TEXT,
    priority priority_level DEFAULT 'medium',
    status order_status DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Enum operations
INSERT INTO support_tickets (title, priority) VALUES 
('Database connection issue', 'high'),
('Feature request', 'low');

-- Enum ordering and comparisons
SELECT 
    title,
    priority,
    status,
    priority > 'medium' as is_high_priority
FROM support_tickets 
ORDER BY priority DESC, created_at;
```

## When to Use Advanced Types vs. NoSQL

### PostgreSQL vs. MongoDB-style Documents

PostgreSQL's JSONB capabilities often eliminate the need for separate document databases like MongoDB. You can achieve the flexibility of document storage while maintaining ACID properties, relational integrity, and SQL's powerful querying capabilities.

```sql
-- Instead of separate MongoDB collection, use JSONB
CREATE TABLE user_profiles (
    user_id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    profile_data JSONB,
    preferences JSONB,
    activity_log JSONB[]
);

-- Rich querying capabilities
SELECT user_id, username
FROM user_profiles 
WHERE profile_data @> '{"location": {"country": "US"}}'
  AND preferences->'notifications'->>'email' = 'true'
  AND jsonb_array_length(activity_log) > 10;

-- Hybrid relational + document approach
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(customer_id),
    order_date TIMESTAMP DEFAULT NOW(),
    items JSONB, -- Flexible item structure
    metadata JSONB, -- Additional order metadata
    total_amount NUMERIC(10,2)
);
```

### Performance Considerations

Proper indexing strategies are crucial when working with advanced types. Each type has specific index types that optimize different query patterns, from GIN indexes for JSONB containment to GiST indexes for range overlaps.

```sql
-- Indexing strategies for advanced types

-- JSONB indexes
CREATE INDEX idx_user_profile_location 
ON user_profiles USING GIN ((profile_data->'location'));

CREATE INDEX idx_user_preferences_email 
ON user_profiles ((preferences->'notifications'->>'email'));

-- Array indexes
CREATE INDEX idx_user_tags 
ON user_preferences USING GIN (tags);

-- Range indexes
CREATE INDEX idx_event_time_range 
ON event_schedule USING GIST (time_range);

-- Composite type indexes
CREATE INDEX idx_customer_city 
ON customers (((contact.address).city));
```

## Practical Examples and Best Practices

### Real-world Scenario: E-commerce Product Catalog

```sql
-- Comprehensive product catalog using advanced types
CREATE TABLE products (
    product_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    
    -- Rich specifications as JSONB
    specifications JSONB,
    
    -- Pricing with currency support
    pricing JSONB,
    
    -- Categories as array
    categories TEXT[],
    
    -- Availability windows
    available_periods TSRANGE[],
    
    -- Customer reviews aggregation
    reviews_summary JSONB,
    
    -- Search metadata
    search_vector TSVECTOR,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Sample product data
INSERT INTO products (sku, name, specifications, pricing, categories, available_periods, reviews_summary) VALUES (
    'LAPTOP-001',
    'Professional Laptop',
    '{
        "technical": {
            "cpu": "Intel i7-12700H",
            "ram": {"size": "32GB", "type": "DDR5"},
            "storage": [
                {"type": "SSD", "capacity": "1TB", "interface": "NVMe"}
            ],
            "display": {
                "size": "15.6",
                "resolution": "3840x2160",
                "type": "OLED"
            }
        },
        "physical": {
            "weight": 1.8,
            "dimensions": {"width": 35.7, "depth": 24.7, "height": 1.9},
            "color": "Space Gray"
        }
    }',
    '{
        "USD": {"base": 2499.00, "sale": 2199.00},
        "EUR": {"base": 2299.00, "sale": 1999.00}
    }',
    ARRAY['Electronics', 'Computers', 'Laptops', 'Professional'],
    ARRAY['[2024-01-01, 2024-12-31)'::TSRANGE],
    '{
        "average_rating": 4.7,
        "total_reviews": 142,
        "rating_distribution": {"5": 89, "4": 35, "3": 12, "2": 4, "1": 2}
    }'
);

-- Complex queries combining multiple advanced types
SELECT 
    sku,
    name,
    specifications->'technical'->'cpu' as cpu,
    pricing->'USD'->>'sale' as usd_price,
    array_length(categories, 1) as category_count,
    reviews_summary->>'average_rating' as rating
FROM products 
WHERE 
    categories && ARRAY['Professional'] -- Has Professional category
    AND specifications @> '{"technical": {"ram": {"size": "32GB"}}}' -- 32GB RAM
    AND (pricing->'USD'->>'sale')::NUMERIC < 2500 -- Under $2500 on sale
    AND NOW() <@ ANY(available_periods); -- Currently available
```

### Analytics with Advanced Types

Advanced types enable sophisticated analytics directly in the database, combining time-series data, JSON aggregations, and array operations. This approach reduces data movement and leverages PostgreSQL's analytical functions for complex computations.

```sql
-- Time-series data with advanced aggregations
CREATE TABLE sensor_readings (
    sensor_id TEXT,
    reading_time TIMESTAMP,
    measurements JSONB,
    location POINT,
    metadata HSTORE
);

-- Advanced analytics query
WITH hourly_stats AS (
    SELECT 
        sensor_id,
        date_trunc('hour', reading_time) as hour,
        avg((measurements->>'temperature')::NUMERIC) as avg_temp,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (measurements->>'humidity')::NUMERIC) as p95_humidity,
        array_agg(DISTINCT metadata->'status') as statuses
    FROM sensor_readings 
    WHERE reading_time >= NOW() - INTERVAL '24 hours'
    GROUP BY sensor_id, date_trunc('hour', reading_time)
)
SELECT 
    sensor_id,
    jsonb_build_object(
        'temperature_stats', jsonb_build_object(
            'avg', round(avg(avg_temp), 2),
            'min', round(min(avg_temp), 2),
            'max', round(max(avg_temp), 2)
        ),
        'humidity_p95_max', max(p95_humidity),
        'status_changes', cardinality(array_agg(DISTINCT unnest(statuses)))
    ) as daily_summary
FROM hourly_stats 
GROUP BY sensor_id;
```

## Migration Strategies

### From Traditional Schema to Advanced Types

Migrating from normalized schemas to advanced types can significantly simplify application code and improve performance. The key is identifying where flexible data structures provide benefits over rigid relational models.

```sql
-- Before: Normalized approach
CREATE TABLE old_user_preferences (
    user_id INTEGER,
    preference_key TEXT,
    preference_value TEXT,
    PRIMARY KEY (user_id, preference_key)
);

-- After: Using JSONB
CREATE TABLE new_user_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences JSONB
);

-- Migration query
INSERT INTO new_user_preferences (user_id, preferences)
SELECT 
    user_id,
    jsonb_object_agg(preference_key, preference_value) as preferences
FROM old_user_preferences 
GROUP BY user_id;
```

## Performance Tips

1. **Use JSONB over JSON** for any data you'll query
2. **Index JSONB paths** you query frequently
3. **Consider composite types** for structured data with known schema
4. **Use arrays** instead of junction tables for simple lists
5. **Leverage range types** for temporal and numeric ranges
6. **Use domains** to enforce business rules at the database level

## Next Steps

In the next lesson, we'll explore PostgreSQL's advanced schema design capabilities, including constraints, domains, inheritance, and partitioning strategies that work seamlessly with these rich data types.

The combination of PostgreSQL's advanced types and proper schema design can eliminate the need for multiple database technologies while providing better performance and data consistency than polyglot persistence approaches.
