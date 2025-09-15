# Schema Design & Constraints

## Introduction

PostgreSQL's advanced schema design capabilities go far beyond traditional relational databases. Understanding domains, constraints, inheritance, and partitioning allows experienced developers to build robust, maintainable, and performant database schemas that encode business logic at the database level.

## Domains: Reusable Type Definitions

### Creating and Using Domains

Domains allow you to create reusable, constrained data types:

```sql
-- Email domain with validation
CREATE DOMAIN email_type AS TEXT
CHECK (
    VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(VALUE) <= 254
);

-- Currency domain
CREATE DOMAIN currency_code AS CHAR(3)
CHECK (VALUE ~ '^[A-Z]{3}$');

-- Positive money amounts
CREATE DOMAIN money_positive AS NUMERIC(12,2)
CHECK (VALUE > 0);

-- US Social Security Number
CREATE DOMAIN ssn_type AS CHAR(11)
CHECK (VALUE ~ '^\d{3}-\d{2}-\d{4}$');

-- Phone number with formatting
CREATE DOMAIN phone_us AS TEXT
CHECK (VALUE ~ '^\+1-\d{3}-\d{3}-\d{4}$' OR VALUE ~ '^\(\d{3}\) \d{3}-\d{4}$');
```

### Domain Usage in Tables

```sql
-- Use domains in table definitions
CREATE TABLE customers (
    customer_id SERIAL PRIMARY KEY,
    email email_type UNIQUE NOT NULL,
    phone phone_us,
    ssn ssn_type UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE financial_accounts (
    account_id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(customer_id),
    balance money_positive DEFAULT 0.01,
    currency currency_code DEFAULT 'USD',
    opened_date DATE DEFAULT CURRENT_DATE
);

-- Domain constraints are automatically enforced
INSERT INTO customers (email, phone, ssn) VALUES 
('john.doe@example.com', '(555) 123-4567', '123-45-6789');

-- This would fail due to domain constraint:
-- INSERT INTO customers (email) VALUES ('invalid-email');
```

### Domain Management

```sql
-- Alter domain constraints
ALTER DOMAIN email_type 
ADD CONSTRAINT email_no_plus CHECK (VALUE NOT LIKE '%+%');

-- Drop specific constraint
ALTER DOMAIN email_type DROP CONSTRAINT email_no_plus;

-- View domain information
SELECT 
    domain_name,
    data_type,
    character_maximum_length,
    is_nullable,
    domain_default
FROM information_schema.domains 
WHERE domain_schema = 'public';

-- Find all constraints on a domain
SELECT 
    constraint_name,
    check_clause
FROM information_schema.domain_constraints 
WHERE domain_name = 'email_type';
```

## Advanced Check Constraints

### Complex Business Rules

```sql
-- Multi-column check constraints
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    ship_date DATE,
    total_amount NUMERIC(10,2) NOT NULL,
    discount_amount NUMERIC(10,2) DEFAULT 0,
    status TEXT NOT NULL,
    
    -- Complex constraints
    CONSTRAINT valid_dates CHECK (ship_date >= order_date),
    CONSTRAINT valid_amounts CHECK (
        total_amount > 0 
        AND discount_amount >= 0 
        AND discount_amount <= total_amount
    ),
    CONSTRAINT valid_status CHECK (
        status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')
    ),
    CONSTRAINT business_rules CHECK (
        (status = 'shipped' AND ship_date IS NOT NULL) OR
        (status IN ('pending', 'processing') AND ship_date IS NULL)
    )
);

-- Table-level constraint using functions
CREATE OR REPLACE FUNCTION validate_order_timing(order_date DATE, ship_date DATE, status TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Business day shipping rule
    IF status = 'shipped' AND ship_date IS NOT NULL THEN
        -- No weekend shipping
        IF EXTRACT(DOW FROM ship_date) IN (0, 6) THEN
            RETURN FALSE;
        END IF;
        -- Must ship within 5 business days
        IF ship_date > order_date + INTERVAL '7 days' THEN
            RETURN FALSE;
        END IF;
    END IF;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE orders 
ADD CONSTRAINT valid_shipping_schedule 
CHECK (validate_order_timing(order_date, ship_date, status));
```

### Conditional Constraints

```sql
-- Constraints based on other column values
CREATE TABLE employees (
    employee_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    role TEXT NOT NULL,
    salary NUMERIC(10,2),
    manager_id INTEGER REFERENCES employees(employee_id),
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    
    -- Conditional constraints
    CONSTRAINT valid_employment_period CHECK (
        end_date IS NULL OR end_date >= start_date
    ),
    CONSTRAINT manager_rules CHECK (
        -- CEO has no manager
        (role = 'CEO' AND manager_id IS NULL) OR
        -- Others must have a manager
        (role != 'CEO' AND manager_id IS NOT NULL)
    ),
    CONSTRAINT salary_rules CHECK (
        -- Salary required for permanent employees
        (end_date IS NULL AND salary IS NOT NULL) OR
        -- Contractors might not have salary in this table
        (end_date IS NOT NULL)
    )
);
```

## Exclusion Constraints

### Non-Overlapping Ranges

```sql
-- Install btree_gist for advanced exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Room booking system with no overlaps
CREATE TABLE room_bookings (
    booking_id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    booking_period TSRANGE NOT NULL,
    purpose TEXT,
    
    -- Exclude overlapping bookings for the same room
    EXCLUDE USING GIST (
        room_id WITH =,
        booking_period WITH &&
    )
);

-- This will work
INSERT INTO room_bookings (room_id, user_id, booking_period, purpose) VALUES 
(101, 1, '[2024-12-01 09:00, 2024-12-01 10:00)', 'Team Meeting'),
(101, 2, '[2024-12-01 10:00, 2024-12-01 11:00)', 'Client Call');

-- This will fail due to overlap
-- INSERT INTO room_bookings (room_id, user_id, booking_period) VALUES 
-- (101, 3, '[2024-12-01 09:30, 2024-12-01 10:30)');
```

### Advanced Exclusion Examples

```sql
-- Employee scheduling - no double booking
CREATE TABLE work_shifts (
    shift_id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    shift_time TSRANGE NOT NULL,
    location TEXT NOT NULL,
    
    -- Employee cannot work overlapping shifts
    EXCLUDE USING GIST (
        employee_id WITH =,
        shift_time WITH &&
    ),
    
    -- Maximum one person per location at any time
    EXCLUDE USING GIST (
        location WITH =,
        shift_time WITH &&
    ) WHERE (location = 'security_desk')
);

-- IP address allocation without conflicts
CREATE TABLE ip_allocations (
    allocation_id SERIAL PRIMARY KEY,
    network CIDR NOT NULL,
    allocated_to TEXT NOT NULL,
    allocation_date DATE DEFAULT CURRENT_DATE,
    
    -- No overlapping network allocations
    EXCLUDE USING GIST (network inet_ops WITH &&)
);
```

## Table Inheritance

### Basic Inheritance

```sql
-- Base table for all vehicles
CREATE TABLE vehicles (
    vehicle_id SERIAL PRIMARY KEY,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER NOT NULL,
    vin TEXT UNIQUE,
    purchase_date DATE,
    
    CONSTRAINT valid_year CHECK (year >= 1900 AND year <= EXTRACT(YEAR FROM CURRENT_DATE) + 1)
);

-- Inherited tables for specific vehicle types
CREATE TABLE cars (
    doors INTEGER DEFAULT 4,
    transmission TEXT DEFAULT 'automatic',
    
    CONSTRAINT valid_doors CHECK (doors IN (2, 4, 5)),
    CONSTRAINT valid_transmission CHECK (transmission IN ('manual', 'automatic', 'cvt'))
) INHERITS (vehicles);

CREATE TABLE trucks (
    payload_capacity INTEGER, -- in pounds
    bed_length NUMERIC(4,2), -- in feet
    drive_type TEXT DEFAULT '2WD',
    
    CONSTRAINT valid_payload CHECK (payload_capacity > 0),
    CONSTRAINT valid_drive CHECK (drive_type IN ('2WD', '4WD', 'AWD'))
) INHERITS (vehicles);

CREATE TABLE motorcycles (
    engine_size INTEGER, -- in cc
    bike_type TEXT,
    
    CONSTRAINT valid_engine CHECK (engine_size >= 50),
    CONSTRAINT valid_type CHECK (bike_type IN ('cruiser', 'sport', 'touring', 'dirt'))
) INHERITS (vehicles);
```

### Inheritance Queries

```sql
-- Insert data into inherited tables
INSERT INTO cars (make, model, year, vin, doors, transmission) VALUES 
('Toyota', 'Camry', 2023, '1HGCM82633A123456', 4, 'automatic'),
('Honda', 'Civic', 2023, '2HGFC2F59NH123457', 4, 'manual');

INSERT INTO trucks (make, model, year, vin, payload_capacity, bed_length, drive_type) VALUES 
('Ford', 'F-150', 2023, '1FTFW1ET5NFC12345', 2000, 6.5, '4WD');

INSERT INTO motorcycles (make, model, year, vin, engine_size, bike_type) VALUES 
('Harley-Davidson', 'Street 750', 2023, 'MEJ59KE1XKM123456', 750, 'cruiser');

-- Query all vehicles (includes inherited tables by default)
SELECT vehicle_id, make, model, year, tableoid::regclass as table_name
FROM vehicles;

-- Query only the base table
SELECT vehicle_id, make, model, year 
FROM ONLY vehicles;

-- Query with type-specific columns
SELECT 
    vehicle_id,
    make,
    model,
    doors,
    transmission,
    'car'::TEXT as vehicle_type
FROM cars
UNION ALL
SELECT 
    vehicle_id,
    make,
    model,
    NULL as doors,
    drive_type as transmission,
    'truck'::TEXT as vehicle_type
FROM trucks;
```

### Inheritance Constraints and Indexes

```sql
-- Add constraint to base table affects all children
ALTER TABLE vehicles ADD CONSTRAINT valid_make 
CHECK (length(make) >= 2);

-- Indexes on base table don't automatically apply to children
CREATE INDEX idx_vehicles_make ON vehicles (make);
CREATE INDEX idx_cars_make ON cars (make);
CREATE INDEX idx_trucks_make ON trucks (make);
CREATE INDEX idx_motorcycles_make ON motorcycles (make);

-- Check constraints are inherited but can be strengthened
ALTER TABLE cars ADD CONSTRAINT cars_recent_models 
CHECK (year >= 2010);
```

## Declarative Partitioning

### Range Partitioning

```sql
-- Partitioned table for time-series data
CREATE TABLE sales_data (
    sale_id BIGSERIAL,
    sale_date DATE NOT NULL,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    sales_rep_id INTEGER,
    region TEXT NOT NULL,
    
    PRIMARY KEY (sale_id, sale_date)
) PARTITION BY RANGE (sale_date);

-- Create partitions for different time periods
CREATE TABLE sales_data_2023_q1 PARTITION OF sales_data
FOR VALUES FROM ('2023-01-01') TO ('2023-04-01');

CREATE TABLE sales_data_2023_q2 PARTITION OF sales_data
FOR VALUES FROM ('2023-04-01') TO ('2023-07-01');

CREATE TABLE sales_data_2023_q3 PARTITION OF sales_data
FOR VALUES FROM ('2023-07-01') TO ('2023-10-01');

CREATE TABLE sales_data_2023_q4 PARTITION OF sales_data
FOR VALUES FROM ('2023-10-01') TO ('2024-01-01');

CREATE TABLE sales_data_2024_q1 PARTITION OF sales_data
FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

-- Default partition for other dates
CREATE TABLE sales_data_default PARTITION OF sales_data DEFAULT;
```

### Hash Partitioning

```sql
-- Hash partitioning for even distribution
CREATE TABLE user_sessions (
    session_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    
    PRIMARY KEY (session_id, user_id)
) PARTITION BY HASH (user_id);

-- Create hash partitions
CREATE TABLE user_sessions_p0 PARTITION OF user_sessions
FOR VALUES WITH (modulus 4, remainder 0);

CREATE TABLE user_sessions_p1 PARTITION OF user_sessions
FOR VALUES WITH (modulus 4, remainder 1);

CREATE TABLE user_sessions_p2 PARTITION OF user_sessions
FOR VALUES WITH (modulus 4, remainder 2);

CREATE TABLE user_sessions_p3 PARTITION OF user_sessions
FOR VALUES WITH (modulus 4, remainder 3);
```

### List Partitioning

```sql
-- List partitioning by region
CREATE TABLE customer_data (
    customer_id SERIAL,
    name TEXT NOT NULL,
    email TEXT,
    region TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    PRIMARY KEY (customer_id, region)
) PARTITION BY LIST (region);

-- Regional partitions
CREATE TABLE customer_data_us PARTITION OF customer_data
FOR VALUES IN ('US', 'USA', 'United States');

CREATE TABLE customer_data_eu PARTITION OF customer_data
FOR VALUES IN ('UK', 'DE', 'FR', 'IT', 'ES', 'NL');

CREATE TABLE customer_data_asia PARTITION OF customer_data
FOR VALUES IN ('JP', 'CN', 'IN', 'SG', 'KR');

CREATE TABLE customer_data_other PARTITION OF customer_data DEFAULT;
```

### Multi-Level Partitioning

```sql
-- Multi-level partitioning: first by date, then by region
CREATE TABLE order_analytics (
    order_id BIGSERIAL,
    order_date DATE NOT NULL,
    region TEXT NOT NULL,
    customer_id INTEGER NOT NULL,
    total_amount NUMERIC(10,2),
    
    PRIMARY KEY (order_id, order_date, region)
) PARTITION BY RANGE (order_date);

-- Year partitions
CREATE TABLE order_analytics_2023 PARTITION OF order_analytics
FOR VALUES FROM ('2023-01-01') TO ('2024-01-01')
PARTITION BY LIST (region);

CREATE TABLE order_analytics_2024 PARTITION OF order_analytics
FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')
PARTITION BY LIST (region);

-- Regional sub-partitions for 2023
CREATE TABLE order_analytics_2023_us PARTITION OF order_analytics_2023
FOR VALUES IN ('US', 'USA');

CREATE TABLE order_analytics_2023_eu PARTITION OF order_analytics_2023
FOR VALUES IN ('UK', 'DE', 'FR', 'IT', 'ES');

CREATE TABLE order_analytics_2023_asia PARTITION OF order_analytics_2023
FOR VALUES IN ('JP', 'CN', 'IN', 'SG');

-- Regional sub-partitions for 2024
CREATE TABLE order_analytics_2024_us PARTITION OF order_analytics_2024
FOR VALUES IN ('US', 'USA');

CREATE TABLE order_analytics_2024_eu PARTITION OF order_analytics_2024
FOR VALUES IN ('UK', 'DE', 'FR', 'IT', 'ES');
```

## Partition Management

### Automated Partition Creation

```sql
-- Function to create monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partition(
    table_name TEXT,
    start_date DATE
) RETURNS TEXT AS $$
DECLARE
    partition_name TEXT;
    end_date DATE;
BEGIN
    -- Calculate partition name and end date
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    end_date := start_date + INTERVAL '1 month';
    
    -- Create the partition
    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   partition_name, table_name, start_date, end_date);
    
    -- Create indexes
    EXECUTE format('CREATE INDEX %I ON %I (sale_date)', 
                   'idx_' || partition_name || '_date', partition_name);
    
    RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Create partitions for the next 6 months
SELECT create_monthly_partition('sales_data', date_trunc('month', CURRENT_DATE) + (n || ' month')::INTERVAL)
FROM generate_series(0, 5) n;
```

### Partition Pruning Verification

```sql
-- Check partition pruning with EXPLAIN
EXPLAIN (COSTS OFF, BUFFERS OFF) 
SELECT * FROM sales_data 
WHERE sale_date >= '2023-04-01' AND sale_date < '2023-07-01';

-- Verify constraint exclusion
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation
FROM pg_stats 
WHERE tablename LIKE 'sales_data_%' 
  AND attname = 'sale_date';
```

## Best Practices for Schema Design

### Constraint Strategy

```sql
-- Comprehensive example combining all constraint types
CREATE TABLE comprehensive_orders (
    -- Primary key with custom domain
    order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Foreign keys with actions
    customer_id INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE RESTRICT,
    sales_rep_id INTEGER REFERENCES employees(employee_id) ON DELETE SET NULL,
    
    -- Domains for data validation
    customer_email email_type,
    
    -- Temporal data with constraints
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    required_date DATE NOT NULL,
    shipped_date DATE,
    
    -- Financial data with business rules
    subtotal money_positive NOT NULL,
    tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    shipping_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_amount money_positive GENERATED ALWAYS AS (subtotal + tax_amount + shipping_cost) STORED,
    
    -- Status with state management
    status TEXT NOT NULL DEFAULT 'pending',
    
    -- Geographic data
    shipping_address JSONB NOT NULL,
    
    -- Audit fields
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER NOT NULL REFERENCES employees(employee_id),
    
    -- Multi-column constraints
    CONSTRAINT valid_dates CHECK (
        required_date >= order_date AND
        (shipped_date IS NULL OR shipped_date >= order_date) AND
        (shipped_date IS NULL OR shipped_date <= required_date + INTERVAL '7 days')
    ),
    
    -- Business logic constraints
    CONSTRAINT valid_status_transitions CHECK (
        status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
    ),
    
    CONSTRAINT shipping_rules CHECK (
        (status IN ('pending', 'confirmed', 'processing') AND shipped_date IS NULL) OR
        (status IN ('shipped', 'delivered') AND shipped_date IS NOT NULL)
    ),
    
    -- Financial constraints
    CONSTRAINT valid_amounts CHECK (
        tax_amount >= 0 AND
        shipping_cost >= 0 AND
        tax_amount <= subtotal * 0.2 -- Max 20% tax
    ),
    
    -- Address validation
    CONSTRAINT valid_shipping_address CHECK (
        shipping_address ? 'street' AND
        shipping_address ? 'city' AND
        shipping_address ? 'postal_code' AND
        shipping_address ? 'country'
    )
) PARTITION BY RANGE (order_date);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_orders_updated_at
    BEFORE UPDATE ON comprehensive_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### Performance Considerations

```sql
-- Indexing strategy for partitioned tables
CREATE INDEX idx_comprehensive_orders_customer 
ON comprehensive_orders (customer_id, order_date);

CREATE INDEX idx_comprehensive_orders_status 
ON comprehensive_orders (status, order_date);

CREATE INDEX idx_comprehensive_orders_rep 
ON comprehensive_orders (sales_rep_id, order_date) 
WHERE sales_rep_id IS NOT NULL;

-- GIN index for JSONB address searches
CREATE INDEX idx_comprehensive_orders_address_gin 
ON comprehensive_orders USING GIN (shipping_address);

-- Partial index for active orders
CREATE INDEX idx_comprehensive_orders_active 
ON comprehensive_orders (order_date, total_amount)
WHERE status NOT IN ('delivered', 'cancelled');
```

## Migration from Inheritance to Partitioning

```sql
-- Migrate from inheritance to declarative partitioning
-- Step 1: Create new partitioned table
CREATE TABLE vehicles_partitioned (
    LIKE vehicles INCLUDING ALL
) PARTITION BY LIST (vehicle_type);

-- Step 2: Create partitions
CREATE TABLE vehicles_cars PARTITION OF vehicles_partitioned 
FOR VALUES IN ('car');

CREATE TABLE vehicles_trucks PARTITION OF vehicles_partitioned 
FOR VALUES IN ('truck');

CREATE TABLE vehicles_motorcycles PARTITION OF vehicles_partitioned 
FOR VALUES IN ('motorcycle');

-- Step 3: Migrate data
INSERT INTO vehicles_partitioned 
SELECT *, 'car'::TEXT as vehicle_type FROM cars;

INSERT INTO vehicles_partitioned 
SELECT *, 'truck'::TEXT as vehicle_type FROM trucks;

INSERT INTO vehicles_partitioned 
SELECT *, 'motorcycle'::TEXT as vehicle_type FROM motorcycles;

-- Step 4: Update application and drop old tables
-- DROP TABLE cars, trucks, motorcycles, vehicles CASCADE;
-- ALTER TABLE vehicles_partitioned RENAME TO vehicles;
```

## Next Steps

In the next lesson, we'll explore PostgreSQL's advanced query language features, including CTEs, window functions, and JSON querying capabilities that work seamlessly with the robust schema designs we've covered here.

The combination of proper schema design with advanced constraints provides a solid foundation for building maintainable, performant applications with strong data integrity guarantees.
