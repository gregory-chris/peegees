# Extensions & Procedural Languages

## Introduction

PostgreSQL's extension system transforms it from a database into a platform. Combined with procedural languages, you can implement complex business logic, data processing pipelines, and custom functionality directly in the database, often with better performance than application-level solutions.

## Core Extensions

### pgcrypto: Cryptographic Functions

The pgcrypto extension provides cryptographic functions for password hashing, data encryption, and digital signatures. It's essential for securing sensitive data and implementing authentication systems directly in the database.

```sql
-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Password hashing
CREATE TABLE user_accounts (
    user_id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL DEFAULT gen_salt('bf'),
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- Function to create user with hashed password
CREATE OR REPLACE FUNCTION create_user(
    p_username TEXT,
    p_email TEXT,
    p_password TEXT
) RETURNS INTEGER AS $$
DECLARE
    user_salt TEXT;
    new_user_id INTEGER;
BEGIN
    -- Generate salt
    user_salt := gen_salt('bf', 8);
    
    -- Insert user with hashed password
    INSERT INTO user_accounts (username, email, password_hash, salt)
    VALUES (p_username, p_email, crypt(p_password, user_salt), user_salt)
    RETURNING user_id INTO new_user_id;
    
    RETURN new_user_id;
END;
$$ LANGUAGE plpgsql;

-- Function to verify password
CREATE OR REPLACE FUNCTION verify_password(
    p_username TEXT,
    p_password TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    stored_hash TEXT;
    user_salt TEXT;
BEGIN
    SELECT password_hash, salt INTO stored_hash, user_salt
    FROM user_accounts 
    WHERE username = p_username;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    RETURN stored_hash = crypt(p_password, user_salt);
END;
$$ LANGUAGE plpgsql;

-- Test user creation and authentication
SELECT create_user('alice_dev', 'alice@example.com', 'secure_password123');
SELECT verify_password('alice_dev', 'secure_password123'); -- Should return true
SELECT verify_password('alice_dev', 'wrong_password'); -- Should return false

-- Data encryption/decryption
CREATE TABLE sensitive_data (
    record_id SERIAL PRIMARY KEY,
    public_info TEXT,
    encrypted_info BYTEA,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Encrypt data before storage
INSERT INTO sensitive_data (public_info, encrypted_info) VALUES 
('Public record 1', pgp_sym_encrypt('Sensitive information here', 'encryption_key')),
('Public record 2', pgp_sym_encrypt('Credit card: 4532-1234-5678-9012', 'encryption_key'));

-- Decrypt data for authorized access
SELECT 
    record_id,
    public_info,
    pgp_sym_decrypt(encrypted_info, 'encryption_key') as decrypted_info
FROM sensitive_data;

-- One-way hashing for data integrity
SELECT 
    'original_data' as data,
    digest('original_data', 'sha256') as sha256_hash,
    digest('original_data', 'md5') as md5_hash;
```

### uuid-ossp: UUID Generation

UUIDs provide globally unique identifiers that are crucial for distributed systems, replication, and avoiding ID conflicts. The uuid-ossp extension offers various UUID generation algorithms for different use cases.

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table with UUID primary key
CREATE TABLE distributed_entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    external_id UUID DEFAULT uuid_generate_v1(),
    namespace_id UUID DEFAULT uuid_generate_v5(uuid_ns_url(), 'https://example.com'),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert with different UUID types
INSERT INTO distributed_entities (name) VALUES 
('Entity One'),
('Entity Two'),
('Entity Three');

-- Custom UUID generation function
CREATE OR REPLACE FUNCTION generate_prefixed_uuid(prefix TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN prefix || '-' || replace(uuid_generate_v4()::TEXT, '-', '');
END;
$$ LANGUAGE plpgsql;

-- Use custom UUID generator
SELECT generate_prefixed_uuid('USER') as user_id;
SELECT generate_prefixed_uuid('ORDER') as order_id;

-- UUID operations
SELECT 
    id,
    name,
    external_id,
    -- Extract UUID timestamp (v1 only)
    CASE 
        WHEN external_id IS NOT NULL THEN 
            to_timestamp((
                ('x' || lpad(split_part(external_id::TEXT, '-', 1), 16, '0'))::bit(64)::bigint + 
                ('x' || lpad(split_part(external_id::TEXT, '-', 2), 16, '0'))::bit(64)::bigint * 4294967296 +
                (('x' || lpad(split_part(external_id::TEXT, '-', 3), 16, '0'))::bit(64)::bigint - 122192928000000000) / 10000000
            ))
        ELSE NULL
    END as uuid_timestamp
FROM distributed_entities;
```

### ltree: Hierarchical Data

The ltree extension enables efficient storage and querying of hierarchical data using a specialized data type. It's perfect for organizational structures, category trees, and any data with parent-child relationships.

```sql
-- Enable ltree extension
CREATE EXTENSION IF NOT EXISTS ltree;

-- Hierarchical organization structure
CREATE TABLE organization_structure (
    node_id SERIAL PRIMARY KEY,
    path LTREE NOT NULL,
    name TEXT NOT NULL,
    employee_count INTEGER DEFAULT 0,
    budget NUMERIC(12,2) DEFAULT 0
);

-- Create GiST index for ltree operations
CREATE INDEX idx_org_structure_path_gist ON organization_structure USING GIST (path);

-- Insert hierarchical data
INSERT INTO organization_structure (path, name, employee_count, budget) VALUES 
('company', 'ACME Corporation', 0, 10000000),
('company.engineering', 'Engineering Division', 0, 6000000),
('company.engineering.backend', 'Backend Team', 15, 2000000),
('company.engineering.frontend', 'Frontend Team', 12, 1500000),
('company.engineering.devops', 'DevOps Team', 8, 1200000),
('company.engineering.qa', 'QA Team', 10, 800000),
('company.sales', 'Sales Division', 0, 2500000),
('company.sales.enterprise', 'Enterprise Sales', 20, 1500000),
('company.sales.smb', 'SMB Sales', 15, 1000000),
('company.marketing', 'Marketing Division', 0, 1500000),
('company.marketing.digital', 'Digital Marketing', 8, 800000),
('company.marketing.content', 'Content Marketing', 6, 400000);

-- Query hierarchical relationships
-- All descendants of engineering
SELECT 
    nlevel(path) as level,
    repeat('  ', nlevel(path) - 2) || name as indented_name,
    employee_count,
    budget
FROM organization_structure 
WHERE path <@ 'company.engineering'
ORDER BY path;

-- All ancestors of backend team
SELECT 
    nlevel(path) as level,
    name,
    path
FROM organization_structure 
WHERE 'company.engineering.backend' @> path
ORDER BY nlevel(path);

-- Direct children of a node
SELECT name, employee_count, budget
FROM organization_structure 
WHERE path ~ 'company.engineering.*{1}'
ORDER BY name;

-- Calculate department totals with ltree
WITH RECURSIVE dept_totals AS (
    -- Base case: leaf nodes
    SELECT 
        path,
        name,
        employee_count,
        budget,
        nlevel(path) as level
    FROM organization_structure
    WHERE NOT EXISTS (
        SELECT 1 FROM organization_structure child 
        WHERE child.path <@ organization_structure.path 
        AND child.path != organization_structure.path
    )
    
    UNION ALL
    
    -- Recursive case: aggregate children
    SELECT 
        parent.path,
        parent.name,
        parent.employee_count + COALESCE(SUM(child.employee_count), 0),
        parent.budget + COALESCE(SUM(child.budget), 0),
        nlevel(parent.path)
    FROM organization_structure parent
    LEFT JOIN dept_totals child ON child.path <@ parent.path AND child.path != parent.path
    WHERE NOT EXISTS (
        SELECT 1 FROM dept_totals existing 
        WHERE existing.path = parent.path
    )
    GROUP BY parent.path, parent.name, parent.employee_count, parent.budget
)
SELECT 
    repeat('  ', level - 1) || name as org_chart,
    employee_count as total_employees,
    budget as total_budget
FROM dept_totals
ORDER BY path;
```

### hstore: Key-Value Store

The hstore extension adds a key-value data type that's more efficient than JSONB for simple key-value scenarios. It's ideal for configuration management, metadata storage, and dynamic attributes.

```sql
-- Enable hstore extension
CREATE EXTENSION IF NOT EXISTS hstore;

-- Configuration management with hstore
CREATE TABLE application_configs (
    config_id SERIAL PRIMARY KEY,
    application_name TEXT NOT NULL,
    environment TEXT NOT NULL,
    config_data HSTORE NOT NULL,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(application_name, environment)
);

-- Create GIN index for hstore queries
CREATE INDEX idx_app_configs_data_gin ON application_configs USING GIN (config_data);

-- Insert application configurations
INSERT INTO application_configs (application_name, environment, config_data) VALUES 
('web_app', 'production', 'database_url=>postgresql://prod-db:5432/app,redis_url=>redis://prod-redis:6379,log_level=>INFO,max_connections=>100,cache_ttl=>3600'),
('web_app', 'staging', 'database_url=>postgresql://staging-db:5432/app,redis_url=>redis://staging-redis:6379,log_level=>DEBUG,max_connections=>50,cache_ttl=>300'),
('api_service', 'production', 'database_url=>postgresql://prod-db:5432/api,rate_limit=>1000,timeout=>30,log_level=>WARN');

-- Query hstore data
SELECT 
    application_name,
    environment,
    config_data->'database_url' as db_connection,
    config_data->'log_level' as log_level,
    (config_data->'max_connections')::INTEGER as max_conn
FROM application_configs;

-- Search by hstore keys and values
SELECT application_name, environment
FROM application_configs 
WHERE config_data ? 'redis_url'; -- Has redis_url key

SELECT application_name, environment
FROM application_configs 
WHERE config_data @> 'log_level=>DEBUG'; -- Contains specific key-value

-- Update hstore configurations
UPDATE application_configs 
SET config_data = config_data || 'feature_flags=>"{\"new_ui\": true, \"analytics\": false}"'::HSTORE,
    version = version + 1
WHERE application_name = 'web_app' AND environment = 'staging';

-- Configuration management functions
CREATE OR REPLACE FUNCTION get_config_value(
    app_name TEXT,
    env TEXT,
    config_key TEXT
) RETURNS TEXT AS $$
BEGIN
    RETURN (
        SELECT config_data->config_key 
        FROM application_configs 
        WHERE application_name = app_name AND environment = env
    );
END;
$$ LANGUAGE plpgsql;

-- Test configuration function
SELECT get_config_value('web_app', 'production', 'log_level');
```

## PostGIS: Spatial Data

```sql
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Spatial data table
CREATE TABLE locations (
    location_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    coordinates GEOMETRY(POINT, 4326), -- WGS84 coordinate system
    service_area GEOMETRY(POLYGON, 4326),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create spatial indexes
CREATE INDEX idx_locations_coordinates ON locations USING GIST (coordinates);
CREATE INDEX idx_locations_service_area ON locations USING GIST (service_area);

-- Insert location data
INSERT INTO locations (name, address, coordinates, service_area) VALUES 
(
    'Downtown Office',
    '123 Main St, Anytown, ST 12345',
    ST_SetSRID(ST_MakePoint(-73.9851, 40.7589), 4326), -- Longitude, Latitude
    ST_SetSRID(ST_Buffer(ST_MakePoint(-73.9851, 40.7589)::geography, 1000)::geometry, 4326) -- 1km radius
),
(
    'Warehouse North',
    '456 Industrial Ave, Anytown, ST 12345',
    ST_SetSRID(ST_MakePoint(-73.9782, 40.8176), 4326),
    ST_SetSRID(ST_Buffer(ST_MakePoint(-73.9782, 40.8176)::geography, 2000)::geometry, 4326) -- 2km radius
);

-- Spatial queries
-- Distance calculations
SELECT 
    l1.name as from_location,
    l2.name as to_location,
    ROUND(ST_Distance(l1.coordinates::geography, l2.coordinates::geography)) as distance_meters
FROM locations l1
CROSS JOIN locations l2
WHERE l1.location_id != l2.location_id;

-- Find locations within distance
SELECT 
    name,
    address,
    ROUND(ST_Distance(coordinates::geography, ST_SetSRID(ST_MakePoint(-73.9800, 40.7700), 4326)::geography)) as distance_meters
FROM locations
WHERE ST_DWithin(coordinates::geography, ST_SetSRID(ST_MakePoint(-73.9800, 40.7700), 4326)::geography, 2000) -- Within 2km
ORDER BY distance_meters;

-- Point in polygon queries
CREATE TABLE customer_locations (
    customer_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location GEOMETRY(POINT, 4326)
);

INSERT INTO customer_locations (name, location) VALUES 
('Customer A', ST_SetSRID(ST_MakePoint(-73.9860, 40.7580), 4326)),
('Customer B', ST_SetSRID(ST_MakePoint(-73.9770, 40.8160), 4326)),
('Customer C', ST_SetSRID(ST_MakePoint(-74.0000, 40.7000), 4326));

-- Find customers within service areas
SELECT 
    c.name as customer_name,
    l.name as servicing_location
FROM customer_locations c
JOIN locations l ON ST_Within(c.location, l.service_area);

-- Spatial aggregations
SELECT 
    COUNT(*) as total_customers,
    ST_AsText(ST_Centroid(ST_Collect(location))) as customer_centroid
FROM customer_locations;
```

## PL/pgSQL: Advanced Procedural Programming

### Complex Business Logic

PL/pgSQL enables implementing sophisticated business rules, data validation, and workflow logic directly in the database. This approach ensures data consistency and often provides better performance than application-level business logic.

```sql
-- Advanced order processing system
CREATE TYPE order_status_type AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled');

CREATE TABLE orders_advanced (
    order_id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_date TIMESTAMP DEFAULT NOW(),
    status order_status_type DEFAULT 'pending',
    total_amount NUMERIC(12,2) NOT NULL,
    discount_amount NUMERIC(12,2) DEFAULT 0,
    tax_amount NUMERIC(12,2) DEFAULT 0,
    shipping_cost NUMERIC(12,2) DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    version INTEGER DEFAULT 1
);

CREATE TABLE inventory_items (
    item_id SERIAL PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    quantity_available INTEGER NOT NULL DEFAULT 0,
    price NUMERIC(10,2) NOT NULL,
    reserved_quantity INTEGER DEFAULT 0
);

CREATE TABLE order_items_advanced (
    order_item_id BIGSERIAL PRIMARY KEY,
    order_id BIGINT REFERENCES orders_advanced(order_id),
    item_id INTEGER REFERENCES inventory_items(item_id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL
);

-- Sample inventory
INSERT INTO inventory_items (sku, name, quantity_available, price) VALUES 
('LAPTOP-001', 'Business Laptop', 50, 999.99),
('MOUSE-001', 'Wireless Mouse', 200, 29.99),
('KEYBOARD-001', 'Mechanical Keyboard', 75, 149.99);

-- Complex order processing function
CREATE OR REPLACE FUNCTION process_order(
    p_customer_id INTEGER,
    p_items JSONB, -- [{"sku": "LAPTOP-001", "quantity": 2}, ...]
    p_discount_percent NUMERIC DEFAULT 0
) RETURNS TABLE(
    order_id BIGINT,
    success BOOLEAN,
    message TEXT,
    total_amount NUMERIC
) AS $$
DECLARE
    v_order_id BIGINT;
    v_item JSONB;
    v_inventory_record RECORD;
    v_subtotal NUMERIC := 0;
    v_discount_amount NUMERIC := 0;
    v_tax_amount NUMERIC := 0;
    v_shipping_cost NUMERIC := 15.00; -- Flat rate
    v_total_amount NUMERIC := 0;
    v_error_message TEXT;
BEGIN
    -- Validate input
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RETURN QUERY SELECT NULL::BIGINT, FALSE, 'No items specified', 0::NUMERIC;
        RETURN;
    END IF;
    
    -- Start transaction
    BEGIN
        -- Create order record
        INSERT INTO orders_advanced (customer_id, total_amount, metadata)
        VALUES (p_customer_id, 0, jsonb_build_object('processing_started', NOW()))
        RETURNING orders_advanced.order_id INTO v_order_id;
        
        -- Process each item
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
        LOOP
            -- Get inventory information
            SELECT * INTO v_inventory_record
            FROM inventory_items 
            WHERE sku = v_item->>'sku'
            FOR UPDATE; -- Lock for inventory update
            
            IF NOT FOUND THEN
                v_error_message := 'SKU not found: ' || (v_item->>'sku');
                RAISE EXCEPTION '%', v_error_message;
            END IF;
            
            -- Check availability
            IF v_inventory_record.quantity_available < (v_item->>'quantity')::INTEGER THEN
                v_error_message := format('Insufficient inventory for %s. Available: %s, Requested: %s',
                    v_inventory_record.sku,
                    v_inventory_record.quantity_available,
                    v_item->>'quantity'
                );
                RAISE EXCEPTION '%', v_error_message;
            END IF;
            
            -- Reserve inventory
            UPDATE inventory_items 
            SET quantity_available = quantity_available - (v_item->>'quantity')::INTEGER,
                reserved_quantity = reserved_quantity + (v_item->>'quantity')::INTEGER
            WHERE item_id = v_inventory_record.item_id;
            
            -- Add order item
            INSERT INTO order_items_advanced (order_id, item_id, quantity, unit_price)
            VALUES (v_order_id, v_inventory_record.item_id, (v_item->>'quantity')::INTEGER, v_inventory_record.price);
            
            -- Calculate subtotal
            v_subtotal := v_subtotal + (v_inventory_record.price * (v_item->>'quantity')::INTEGER);
        END LOOP;
        
        -- Calculate totals
        v_discount_amount := v_subtotal * (p_discount_percent / 100.0);
        v_tax_amount := (v_subtotal - v_discount_amount) * 0.08; -- 8% tax
        v_total_amount := v_subtotal - v_discount_amount + v_tax_amount + v_shipping_cost;
        
        -- Update order with final amounts
        UPDATE orders_advanced 
        SET total_amount = v_total_amount,
            discount_amount = v_discount_amount,
            tax_amount = v_tax_amount,
            shipping_cost = v_shipping_cost,
            status = 'confirmed',
            metadata = metadata || jsonb_build_object(
                'processing_completed', NOW(),
                'subtotal', v_subtotal,
                'items_count', jsonb_array_length(p_items)
            )
        WHERE orders_advanced.order_id = v_order_id;
        
        RETURN QUERY SELECT v_order_id, TRUE, 'Order processed successfully', v_total_amount;
        
    EXCEPTION WHEN OTHERS THEN
        -- Rollback will happen automatically
        RETURN QUERY SELECT v_order_id, FALSE, SQLERRM, 0::NUMERIC;
    END;
END;
$$ LANGUAGE plpgsql;

-- Test order processing
SELECT * FROM process_order(
    123, 
    '[{"sku": "LAPTOP-001", "quantity": 1}, {"sku": "MOUSE-001", "quantity": 2}]'::JSONB,
    10.0 -- 10% discount
);

-- Check results
SELECT * FROM orders_advanced WHERE order_id = 1;
SELECT * FROM order_items_advanced WHERE order_id = 1;
SELECT * FROM inventory_items;
```

### Dynamic SQL and Metaprogramming

Dynamic SQL construction and metaprogramming techniques allow creating flexible, reusable functions that can adapt to different schemas and requirements. This is powerful for building generic utilities and data processing functions.

```sql
-- Dynamic table partitioning function
CREATE OR REPLACE FUNCTION create_partitioned_analytics_table(
    table_name TEXT,
    partition_column TEXT,
    partition_type TEXT -- 'range' or 'hash' or 'list'
) RETURNS TEXT AS $$
DECLARE
    sql_command TEXT;
    partition_clause TEXT;
BEGIN
    -- Validate partition type
    IF partition_type NOT IN ('range', 'hash', 'list') THEN
        RAISE EXCEPTION 'Invalid partition type: %', partition_type;
    END IF;
    
    -- Build partition clause
    CASE partition_type
        WHEN 'range' THEN
            partition_clause := format('PARTITION BY RANGE (%I)', partition_column);
        WHEN 'hash' THEN
            partition_clause := format('PARTITION BY HASH (%I)', partition_column);
        WHEN 'list' THEN
            partition_clause := format('PARTITION BY LIST (%I)', partition_column);
    END CASE;
    
    -- Build CREATE TABLE command
    sql_command := format('
        CREATE TABLE %I (
            id BIGSERIAL,
            %I %s NOT NULL,
            data JSONB,
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (id, %I)
        ) %s',
        table_name,
        partition_column,
        CASE 
            WHEN partition_type = 'range' AND partition_column LIKE '%date%' THEN 'DATE'
            WHEN partition_type = 'hash' THEN 'INTEGER'
            ELSE 'TEXT'
        END,
        partition_column,
        partition_clause
    );
    
    -- Execute the command
    EXECUTE sql_command;
    
    RETURN format('Created partitioned table: %s with %s partitioning on %s', 
                  table_name, partition_type, partition_column);
END;
$$ LANGUAGE plpgsql;

-- Test dynamic table creation
SELECT create_partitioned_analytics_table('user_events', 'event_date', 'range');
SELECT create_partitioned_analytics_table('session_data', 'user_id', 'hash');

-- Dynamic query builder for analytics
CREATE OR REPLACE FUNCTION build_analytics_query(
    table_name TEXT,
    metrics TEXT[],
    dimensions TEXT[],
    filters JSONB DEFAULT '{}'::JSONB,
    time_range JSONB DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
    select_clause TEXT;
    from_clause TEXT;
    where_clause TEXT := '';
    group_clause TEXT := '';
    filter_key TEXT;
    filter_value TEXT;
    query_text TEXT;
BEGIN
    -- Build SELECT clause
    select_clause := array_to_string(dimensions, ', ');
    
    IF array_length(dimensions, 1) > 0 AND array_length(metrics, 1) > 0 THEN
        select_clause := select_clause || ', ';
    END IF;
    
    select_clause := select_clause || array_to_string(metrics, ', ');
    
    -- Build FROM clause
    from_clause := format('FROM %I', table_name);
    
    -- Build WHERE clause from filters
    IF jsonb_typeof(filters) = 'object' AND jsonb_object_keys(filters) IS NOT NULL THEN
        FOR filter_key IN SELECT * FROM jsonb_object_keys(filters)
        LOOP
            filter_value := filters->>filter_key;
            
            IF where_clause = '' THEN
                where_clause := 'WHERE ';
            ELSE
                where_clause := where_clause || ' AND ';
            END IF;
            
            where_clause := where_clause || format('%I = %L', filter_key, filter_value);
        END LOOP;
    END IF;
    
    -- Add time range filter if provided
    IF time_range IS NOT NULL THEN
        IF where_clause = '' THEN
            where_clause := 'WHERE ';
        ELSE
            where_clause := where_clause || ' AND ';
        END IF;
        
        where_clause := where_clause || format(
            'created_at BETWEEN %L AND %L',
            time_range->>'start_date',
            time_range->>'end_date'
        );
    END IF;
    
    -- Build GROUP BY clause
    IF array_length(dimensions, 1) > 0 THEN
        group_clause := 'GROUP BY ' || array_to_string(dimensions, ', ');
    END IF;
    
    -- Combine all clauses
    query_text := format('SELECT %s %s %s %s',
        select_clause,
        from_clause,
        where_clause,
        group_clause
    );
    
    RETURN query_text;
END;
$$ LANGUAGE plpgsql;

-- Test dynamic query builder
SELECT build_analytics_query(
    'sales_analytics',
    ARRAY['COUNT(*) as sale_count', 'SUM(total_amount) as total_revenue'],
    ARRAY['region', 'DATE_TRUNC(''month'', sale_date) as month'],
    '{"status": "completed"}'::JSONB,
    '{"start_date": "2024-01-01", "end_date": "2024-12-31"}'::JSONB
);
```

## PL/Python: Python Integration

```sql
-- Enable PL/Python extension (requires installation)
-- CREATE EXTENSION IF NOT EXISTS plpython3u;

-- Note: PL/Python requires special installation and trusted language setup
-- This example shows what's possible when properly configured

/*
-- Data science functions in Python
CREATE OR REPLACE FUNCTION calculate_statistics(values NUMERIC[])
RETURNS TABLE(
    mean NUMERIC,
    median NUMERIC,
    std_dev NUMERIC,
    quartiles NUMERIC[]
) AS $$
    import numpy as np
    
    if not values:
        return None
        
    arr = np.array(values, dtype=float)
    
    return [{
        'mean': float(np.mean(arr)),
        'median': float(np.median(arr)),
        'std_dev': float(np.std(arr)),
        'quartiles': [float(q) for q in np.percentile(arr, [25, 50, 75])]
    }]
$$ LANGUAGE plpython3u;

-- Machine learning integration
CREATE OR REPLACE FUNCTION simple_linear_regression(x_values NUMERIC[], y_values NUMERIC[])
RETURNS TABLE(
    slope NUMERIC,
    intercept NUMERIC,
    r_squared NUMERIC,
    prediction_for_next NUMERIC
) AS $$
    import numpy as np
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import r2_score
    
    if len(x_values) != len(y_values) or len(x_values) < 2:
        return None
        
    X = np.array(x_values).reshape(-1, 1)
    y = np.array(y_values)
    
    model = LinearRegression()
    model.fit(X, y)
    
    y_pred = model.predict(X)
    r2 = r2_score(y, y_pred)
    
    # Predict next value
    next_x = max(x_values) + 1
    next_prediction = model.predict([[next_x]])[0]
    
    return [{
        'slope': float(model.coef_[0]),
        'intercept': float(model.intercept_),
        'r_squared': float(r2),
        'prediction_for_next': float(next_prediction)
    }]
$$ LANGUAGE plpython3u;
*/

-- Alternative: JSON-based data science functions using available languages
CREATE OR REPLACE FUNCTION calculate_basic_statistics(data_json JSONB)
RETURNS JSONB AS $$
DECLARE
    values_array NUMERIC[];
    mean_val NUMERIC;
    count_val INTEGER;
    sum_val NUMERIC := 0;
    variance_val NUMERIC := 0;
    std_dev_val NUMERIC;
    value_record RECORD;
BEGIN
    -- Extract numeric values from JSON array
    SELECT ARRAY(
        SELECT (value::TEXT)::NUMERIC 
        FROM jsonb_array_elements(data_json) AS value
        WHERE jsonb_typeof(value) = 'number'
    ) INTO values_array;
    
    count_val := array_length(values_array, 1);
    
    IF count_val = 0 THEN
        RETURN '{"error": "No numeric values found"}'::JSONB;
    END IF;
    
    -- Calculate mean
    SELECT AVG(unnest) INTO mean_val FROM unnest(values_array);
    
    -- Calculate variance
    SELECT AVG(power(unnest - mean_val, 2)) INTO variance_val FROM unnest(values_array);
    std_dev_val := sqrt(variance_val);
    
    -- Return statistics as JSON
    RETURN jsonb_build_object(
        'count', count_val,
        'mean', ROUND(mean_val, 4),
        'variance', ROUND(variance_val, 4),
        'std_dev', ROUND(std_dev_val, 4),
        'min', (SELECT MIN(unnest) FROM unnest(values_array)),
        'max', (SELECT MAX(unnest) FROM unnest(values_array))
    );
END;
$$ LANGUAGE plpgsql;

-- Test statistics function
SELECT calculate_basic_statistics('[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]'::JSONB);
```

## Custom Extensions Development

### Extension Structure

Creating custom extensions requires understanding the PostgreSQL extension framework, proper directory structure, and metadata files. Extensions encapsulate related functions, types, and operators into reusable packages.

```sql
-- Template for custom extension development
-- File structure:
-- my_extension/
-- ├── my_extension.control
-- ├── my_extension--1.0.sql
-- └── Makefile

-- my_extension.control content:
/*
comment = 'My custom PostgreSQL extension'
default_version = '1.0'
module_pathname = '$libdir/my_extension'
relocatable = true
*/

-- Example custom functions for business logic
CREATE OR REPLACE FUNCTION calculate_business_metrics(
    start_date DATE,
    end_date DATE,
    region TEXT DEFAULT NULL
) RETURNS TABLE(
    metric_name TEXT,
    metric_value NUMERIC,
    period_start DATE,
    period_end DATE
) AS $$
BEGIN
    -- Customer acquisition cost
    RETURN QUERY
    SELECT 
        'customer_acquisition_cost'::TEXT,
        COALESCE(
            (SELECT SUM(marketing_spend) / NULLIF(COUNT(DISTINCT customer_id), 0)
             FROM marketing_campaigns mc
             JOIN customer_acquisitions ca ON DATE(ca.acquired_date) BETWEEN mc.start_date AND mc.end_date
             WHERE ca.acquired_date BETWEEN start_date AND end_date
               AND (region IS NULL OR ca.region = calculate_business_metrics.region)
            ), 0
        )::NUMERIC,
        start_date,
        end_date;
    
    -- Customer lifetime value
    RETURN QUERY
    SELECT 
        'customer_lifetime_value'::TEXT,
        COALESCE(
            (SELECT AVG(total_revenue)
             FROM (
                 SELECT 
                     c.customer_id,
                     SUM(o.total_amount) as total_revenue
                 FROM customers c
                 JOIN orders o ON c.customer_id = o.customer_id
                 WHERE o.order_date BETWEEN start_date AND end_date
                   AND (region IS NULL OR c.country = calculate_business_metrics.region)
                 GROUP BY c.customer_id
             ) customer_revenues
            ), 0
        )::NUMERIC,
        start_date,
        end_date;
    
    -- Monthly recurring revenue
    RETURN QUERY
    SELECT 
        'monthly_recurring_revenue'::TEXT,
        COALESCE(
            (SELECT SUM(monthly_amount)
             FROM subscriptions s
             WHERE s.status = 'active'
               AND s.start_date <= end_date
               AND (s.end_date IS NULL OR s.end_date >= start_date)
               AND (region IS NULL OR s.customer_region = calculate_business_metrics.region)
            ), 0
        )::NUMERIC,
        start_date,
        end_date;
END;
$$ LANGUAGE plpgsql;

-- Usage tracking for extension functions
CREATE TABLE extension_usage_log (
    log_id BIGSERIAL PRIMARY KEY,
    function_name TEXT NOT NULL,
    parameters JSONB,
    execution_time_ms NUMERIC,
    user_name TEXT DEFAULT current_user,
    execution_timestamp TIMESTAMP DEFAULT NOW()
);

-- Wrapper function with usage tracking
CREATE OR REPLACE FUNCTION tracked_business_metrics(
    start_date DATE,
    end_date DATE,
    region TEXT DEFAULT NULL
) RETURNS TABLE(
    metric_name TEXT,
    metric_value NUMERIC,
    period_start DATE,
    period_end DATE
) AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    execution_ms NUMERIC;
BEGIN
    start_time := clock_timestamp();
    
    -- Log function call
    INSERT INTO extension_usage_log (function_name, parameters)
    VALUES ('calculate_business_metrics', jsonb_build_object(
        'start_date', start_date,
        'end_date', end_date,
        'region', region
    ));
    
    -- Execute main function
    RETURN QUERY
    SELECT * FROM calculate_business_metrics(start_date, end_date, region);
    
    -- Log execution time
    end_time := clock_timestamp();
    execution_ms := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
    
    UPDATE extension_usage_log 
    SET execution_time_ms = execution_ms
    WHERE log_id = (SELECT MAX(log_id) FROM extension_usage_log);
END;
$$ LANGUAGE plpgsql;
```

## Extension Management and Best Practices

### Extension Lifecycle Management

Managing extension versions, dependencies, and upgrades is crucial for maintaining database stability. Proper lifecycle management ensures smooth deployments and rollbacks when needed.

```sql
-- List installed extensions
SELECT 
    extname as extension_name,
    extversion as version,
    nspname as schema,
    extrelocatable as relocatable
FROM pg_extension e
JOIN pg_namespace n ON e.extnamespace = n.oid
ORDER BY extname;

-- Check available extensions
SELECT 
    name,
    default_version,
    installed_version,
    comment
FROM pg_available_extensions 
ORDER BY name;

-- Extension dependency tracking
CREATE VIEW extension_dependencies AS
WITH RECURSIVE deps AS (
    SELECT 
        e.extname,
        d.refobjid::regclass as depends_on,
        1 as level
    FROM pg_extension e
    JOIN pg_depend d ON e.oid = d.objid
    WHERE d.deptype = 'e'
    
    UNION ALL
    
    SELECT 
        deps.extname,
        d.refobjid::regclass,
        deps.level + 1
    FROM deps
    JOIN pg_depend d ON d.objid = deps.depends_on::oid
    WHERE deps.level < 5 -- Prevent infinite recursion
)
SELECT DISTINCT
    extname as extension,
    depends_on,
    level as dependency_level
FROM deps
ORDER BY extname, level;

-- Monitor extension performance impact
CREATE OR REPLACE FUNCTION analyze_extension_performance()
RETURNS TABLE(
    extension_name TEXT,
    function_count BIGINT,
    avg_execution_time NUMERIC,
    total_calls BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        regexp_replace(p.proname, '^.*?_', '') as ext_name,
        COUNT(*)::BIGINT as func_count,
        AVG(eul.execution_time_ms) as avg_time,
        COUNT(eul.log_id)::BIGINT as call_count
    FROM pg_proc p
    LEFT JOIN extension_usage_log eul ON p.proname = eul.function_name
    WHERE p.proname LIKE '%_%' -- Assume extension functions have prefixes
    GROUP BY regexp_replace(p.proname, '^.*?_', '')
    ORDER BY avg_time DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;

-- Extension cleanup utilities
CREATE OR REPLACE FUNCTION cleanup_extension_artifacts(ext_name TEXT)
RETURNS TEXT AS $$
DECLARE
    cleanup_count INTEGER := 0;
BEGIN
    -- Clean up extension-specific tables that might remain
    -- This is a template - actual implementation depends on extension
    
    EXECUTE format('DELETE FROM extension_usage_log WHERE function_name LIKE %L', ext_name || '%');
    GET DIAGNOSTICS cleanup_count = ROW_COUNT;
    
    RETURN format('Cleaned up %s artifacts for extension %s', cleanup_count, ext_name);
END;
$$ LANGUAGE plpgsql;
```

## Next Steps

In the next lesson, we'll explore PostgreSQL's replication and high availability features, which often work in conjunction with the extensions and custom logic we've developed here.

The extension system and procedural languages provide the foundation for building sophisticated, database-centric applications that can handle complex business logic efficiently and reliably.
