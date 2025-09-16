# Replication, High Availability & Scaling

## Introduction

PostgreSQL's replication and scaling capabilities enable building robust, highly available systems that can handle massive workloads. Understanding streaming replication, logical replication, connection pooling, and scaling strategies is essential for production deployments.

## Streaming Replication

### Setting Up Primary-Replica Configuration

Streaming replication requires configuring the primary server to send WAL records to replica servers in real-time. This involves setting WAL levels, creating replication users, and configuring connection permissions.

```sql
-- Primary server configuration (postgresql.conf)
/*
# Replication settings
wal_level = replica                    # Enable WAL for replication
max_wal_senders = 10                  # Max concurrent WAL sender processes
max_replication_slots = 10            # Max replication slots
wal_keep_size = 1GB                   # Retain WAL for replicas
synchronous_commit = on               # Wait for replica confirmation
synchronous_standby_names = 'replica1,replica2'  # Replica priority

# Connection settings
listen_addresses = '*'
port = 5432

# Archive settings (for PITR)
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
*/

-- Create replication user on primary
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'secure_replica_password';

-- Grant connection permissions (pg_hba.conf)
/*
# Allow replication connections
host replication replicator 10.0.1.0/24 md5
host replication replicator 192.168.1.0/24 md5
*/

-- Create replication slot for consistent streaming
SELECT pg_create_physical_replication_slot('replica_slot_1');

-- Monitor replication slots
SELECT 
    slot_name,
    plugin,
    slot_type,
    database,
    active,
    xmin,
    catalog_xmin,
    restart_lsn,
    confirmed_flush_lsn
FROM pg_replication_slots;
```

### Replica Server Setup

```bash
# On replica server - create base backup
pg_basebackup -h primary_server -D /var/lib/postgresql/data -U replicator -P -W -R

# The -R flag creates recovery.conf automatically
# recovery.conf content:
# standby_mode = 'on'
# primary_conninfo = 'host=primary_server port=5432 user=replicator'
# primary_slot_name = 'replica_slot_1'
```

### Monitoring Replication

Effective replication monitoring helps detect lag, identify failed replicas, and ensure data consistency. PostgreSQL provides comprehensive views and functions to track replication health and performance.

```sql
-- On primary: Monitor replication status
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    client_hostname,
    client_port,
    backend_start,
    backend_xmin,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    write_lag,
    flush_lag,
    replay_lag,
    sync_priority,
    sync_state
FROM pg_stat_replication;

-- Calculate replication lag in bytes
SELECT 
    client_addr,
    application_name,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) as lag_bytes,
    extract(epoch from (now() - pg_last_xact_replay_timestamp()))::int as lag_seconds
FROM pg_stat_replication;

-- On replica: Check recovery status
SELECT 
    pg_is_in_recovery() as is_replica,
    pg_last_wal_receive_lsn() as receive_lsn,
    pg_last_wal_replay_lsn() as replay_lsn,
    pg_last_xact_replay_timestamp() as last_replay_time;

-- Replication monitoring function
CREATE OR REPLACE FUNCTION monitor_replication_health()
RETURNS TABLE(
    replica_name TEXT,
    lag_bytes BIGINT,
    lag_seconds INTEGER,
    status TEXT,
    priority INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(sr.application_name, sr.client_addr::TEXT) as replica_name,
        pg_wal_lsn_diff(pg_current_wal_lsn(), sr.replay_lsn)::BIGINT as lag_bytes,
        EXTRACT(EPOCH FROM (NOW() - sr.reply_time))::INTEGER as lag_seconds,
        CASE 
            WHEN sr.state = 'streaming' AND sr.sync_state = 'sync' THEN 'HEALTHY_SYNC'
            WHEN sr.state = 'streaming' AND sr.sync_state = 'async' THEN 'HEALTHY_ASYNC'
            WHEN sr.state = 'startup' THEN 'STARTING_UP'
            WHEN sr.state = 'catchup' THEN 'CATCHING_UP'
            ELSE 'UNHEALTHY'
        END as status,
        sr.sync_priority as priority
    FROM pg_stat_replication sr
    ORDER BY sr.sync_priority, lag_bytes;
END;
$$ LANGUAGE plpgsql;

-- Test replication monitoring
SELECT * FROM monitor_replication_health();
```

### Synchronous vs Asynchronous Replication

Choosing between synchronous and asynchronous replication involves balancing data safety against performance. Synchronous replication guarantees data consistency but may impact write performance, while asynchronous offers better performance with some risk of data loss.

```sql
-- Configure synchronous replication
-- On primary server:
-- synchronous_standby_names = 'FIRST 1 (replica1, replica2)'  -- At least 1 must confirm
-- synchronous_standby_names = 'ANY 2 (replica1, replica2, replica3)'  -- Any 2 must confirm
-- synchronous_standby_names = 'replica1'  -- Specific replica must confirm

-- Test synchronous behavior
BEGIN;
INSERT INTO test_table VALUES (1, 'sync test', NOW());
-- This will wait for replica confirmation before returning
COMMIT;

-- Monitor synchronous replication
SELECT 
    application_name,
    sync_state,
    sync_priority,
    state
FROM pg_stat_replication
WHERE sync_state IN ('sync', 'potential');

-- Switch to asynchronous temporarily
ALTER SYSTEM SET synchronous_standby_names = '';
SELECT pg_reload_conf();

-- Restore synchronous replication
ALTER SYSTEM SET synchronous_standby_names = 'replica1';
SELECT pg_reload_conf();
```

## Logical Replication

### Publication and Subscription Setup

Logical replication uses publications to define which data to replicate and subscriptions to specify how to receive that data. This selective approach enables complex replication topologies and data distribution patterns.

```sql
-- On publisher (source) database
-- Create publication for specific tables
CREATE PUBLICATION sales_publication FOR TABLE 
    customers, 
    orders, 
    order_items;

-- Create publication for all tables in schema
CREATE PUBLICATION analytics_publication FOR ALL TABLES IN SCHEMA analytics;

-- Create publication with filters (PostgreSQL 15+)
CREATE PUBLICATION filtered_publication FOR TABLE customers WHERE (country = 'US');

-- View publications
SELECT 
    pubname,
    puballtables,
    pubinsert,
    pubupdate,
    pubdelete,
    pubtruncate
FROM pg_publication;

-- View publication tables
SELECT 
    pub.pubname,
    pt.schemaname,
    pt.tablename,
    pt.rowfilter
FROM pg_publication pub
LEFT JOIN pg_publication_tables pt ON pub.pubname = pt.pubname
ORDER BY pub.pubname, pt.schemaname, pt.tablename;
```

```sql
-- On subscriber (target) database
-- Create subscription
CREATE SUBSCRIPTION sales_subscription
CONNECTION 'host=publisher_host port=5432 dbname=source_db user=replication_user password=password'
PUBLICATION sales_publication
WITH (copy_data = true, create_slot = true);

-- Monitor subscription status
SELECT 
    sub.subname,
    sub.subenabled,
    sub.subconninfo,
    sub.subslotname,
    sub.subsynccommit,
    sub.subpublications
FROM pg_subscription sub;

-- Monitor subscription worker status
SELECT 
    sr.subname,
    sr.pid,
    sr.relid::regclass as table_name,
    sr.received_lsn,
    sr.last_msg_send_time,
    sr.last_msg_receipt_time,
    sr.latest_end_lsn,
    sr.latest_end_time
FROM pg_stat_subscription sr;

-- Check replication slot usage
SELECT 
    slot_name,
    database,
    active,
    xmin,
    catalog_xmin,
    restart_lsn,
    confirmed_flush_lsn,
    wal_status,
    safe_wal_size
FROM pg_replication_slots 
WHERE slot_type = 'logical';
```

### Advanced Logical Replication Patterns

Complex replication scenarios require sophisticated patterns like multi-master setups, conflict resolution strategies, and selective replication. These patterns enable distributed architectures while maintaining data integrity.

```sql
-- Multi-master setup with conflict resolution
-- Database A
CREATE PUBLICATION db_a_publication FOR ALL TABLES;

-- Database B  
CREATE PUBLICATION db_b_publication FOR ALL TABLES;
CREATE SUBSCRIPTION db_a_subscription
CONNECTION 'host=db_a_host port=5432 dbname=app_db user=replica_user'
PUBLICATION db_a_publication
WITH (copy_data = false, create_slot = true);

-- Add conflict resolution timestamp column
ALTER TABLE customers ADD COLUMN last_modified TIMESTAMP DEFAULT NOW();
ALTER TABLE orders ADD COLUMN last_modified TIMESTAMP DEFAULT NOW();

-- Conflict resolution trigger
CREATE OR REPLACE FUNCTION resolve_conflicts()
RETURNS TRIGGER AS $$
BEGIN
    -- Update timestamp on any modification
    NEW.last_modified = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_timestamp_customers
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION resolve_conflicts();

CREATE TRIGGER update_timestamp_orders
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION resolve_conflicts();

-- Selective replication based on business rules
CREATE PUBLICATION regional_us_publication FOR TABLE customers WHERE (country = 'US');
CREATE PUBLICATION regional_eu_publication FOR TABLE customers WHERE (country IN ('UK', 'DE', 'FR'));

-- Row-level security for selective replication
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_us_policy ON customers
    FOR ALL TO replication_user_us
    USING (country = 'US');

CREATE POLICY customers_eu_policy ON customers
    FOR ALL TO replication_user_eu  
    USING (country IN ('UK', 'DE', 'FR'));
```

### Logical Replication Monitoring

Monitoring logical replication requires tracking subscription status, worker processes, and replication lag. This ensures data consistency across distributed systems and helps identify performance bottlenecks.

```sql
-- Comprehensive replication monitoring view
CREATE VIEW logical_replication_status AS
SELECT 
    s.subname as subscription_name,
    s.subenabled as enabled,
    s.subpublications as publications,
    sr.pid as worker_pid,
    sr.relid::regclass as table_name,
    sr.received_lsn,
    sr.last_msg_receipt_time,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), sr.received_lsn)) as lag_size,
    EXTRACT(EPOCH FROM (NOW() - sr.last_msg_receipt_time))::INTEGER as lag_seconds,
    CASE 
        WHEN sr.pid IS NOT NULL THEN 'ACTIVE'
        WHEN s.subenabled THEN 'ENABLED_NO_WORKER'
        ELSE 'DISABLED'
    END as status
FROM pg_subscription s
LEFT JOIN pg_stat_subscription sr ON s.oid = sr.subid;

-- Conflict detection and logging
CREATE TABLE replication_conflicts (
    conflict_id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    conflict_type TEXT NOT NULL, -- 'UPDATE', 'DELETE', 'INSERT'
    local_data JSONB,
    remote_data JSONB,
    resolution TEXT,
    detected_at TIMESTAMP DEFAULT NOW()
);

-- Function to log conflicts
CREATE OR REPLACE FUNCTION log_replication_conflict(
    p_table_name TEXT,
    p_conflict_type TEXT,
    p_local_data JSONB,
    p_remote_data JSONB,
    p_resolution TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO replication_conflicts 
    (table_name, conflict_type, local_data, remote_data, resolution)
    VALUES (p_table_name, p_conflict_type, p_local_data, p_remote_data, p_resolution);
    
    -- Could also send alert here
    RAISE NOTICE 'Replication conflict detected in % (%) - %', 
        p_table_name, p_conflict_type, p_resolution;
END;
$$ LANGUAGE plpgsql;
```

## Connection Pooling

### PgBouncer Configuration

```ini
# pgbouncer.ini
[databases]
app_db = host=localhost port=5432 dbname=app_production user=app_user
analytics_db = host=replica_host port=5432 dbname=app_production user=readonly_user

[pgbouncer]
listen_port = 6432
listen_addr = *
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
logfile = /var/log/pgbouncer/pgbouncer.log
pidfile = /var/run/pgbouncer/pgbouncer.pid

# Pool settings
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5

# Connection limits
server_round_robin = 1
ignore_startup_parameters = extra_float_digits

# Timeouts
server_connect_timeout = 15
server_login_retry = 15
query_timeout = 0
query_wait_timeout = 120
client_idle_timeout = 0
server_idle_timeout = 600
server_lifetime = 3600
server_reset_query = DISCARD ALL
```

### Connection Pool Monitoring

Effective connection pool monitoring helps optimize pool sizes, identify connection leaks, and ensure optimal database resource utilization. Proper monitoring prevents connection exhaustion and performance degradation.

```sql
-- Monitor connection pool status (via PgBouncer admin)
-- Connect to pgbouncer admin: psql "host=localhost port=6432 dbname=pgbouncer user=pgbouncer"

/*
SHOW POOLS;
SHOW CLIENTS; 
SHOW SERVERS;
SHOW STATS;
*/

-- Application-level connection monitoring
CREATE TABLE connection_pool_stats (
    stat_id SERIAL PRIMARY KEY,
    pool_name TEXT,
    active_connections INTEGER,
    idle_connections INTEGER,
    waiting_connections INTEGER,
    max_connections INTEGER,
    collected_at TIMESTAMP DEFAULT NOW()
);

-- Function to collect pool statistics
CREATE OR REPLACE FUNCTION collect_pool_stats()
RETURNS VOID AS $$
DECLARE
    conn_count INTEGER;
    active_count INTEGER;
    idle_count INTEGER;
BEGIN
    -- Get current connection statistics
    SELECT COUNT(*) INTO conn_count
    FROM pg_stat_activity 
    WHERE state != 'idle';
    
    SELECT COUNT(*) INTO active_count
    FROM pg_stat_activity 
    WHERE state = 'active';
    
    SELECT COUNT(*) INTO idle_count
    FROM pg_stat_activity 
    WHERE state = 'idle';
    
    -- Log statistics
    INSERT INTO connection_pool_stats 
    (pool_name, active_connections, idle_connections, waiting_connections, max_connections)
    VALUES 
    ('main_pool', active_count, idle_count, 0, 200);
    
END;
$$ LANGUAGE plpgsql;

-- Connection health check
CREATE OR REPLACE FUNCTION check_connection_health()
RETURNS TABLE(
    metric TEXT,
    value INTEGER,
    threshold INTEGER,
    status TEXT
) AS $$
DECLARE
    total_conn INTEGER;
    active_conn INTEGER;
    max_conn INTEGER;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE state = 'active'),
        setting::INTEGER
    INTO total_conn, active_conn, max_conn
    FROM pg_stat_activity, pg_settings 
    WHERE name = 'max_connections';
    
    RETURN QUERY VALUES
    ('total_connections', total_conn, max_conn, 
     CASE WHEN total_conn > max_conn * 0.8 THEN 'WARNING' ELSE 'OK' END),
    ('active_connections', active_conn, max_conn / 2,
     CASE WHEN active_conn > max_conn * 0.4 THEN 'WARNING' ELSE 'OK' END);
END;
$$ LANGUAGE plpgsql;

SELECT * FROM check_connection_health();
```

### Application Connection Patterns

Smart application connection patterns ensure optimal use of connection pools and database resources. These patterns include read/write splitting, transaction-aware routing, and graceful degradation strategies.

```sql
-- Read/write splitting configuration
CREATE OR REPLACE FUNCTION get_connection_string(operation_type TEXT)
RETURNS TEXT AS $$
BEGIN
    CASE operation_type
        WHEN 'read' THEN
            RETURN 'host=readonly_replica port=5432 dbname=app_production user=readonly_user';
        WHEN 'write' THEN
            RETURN 'host=primary_host port=5432 dbname=app_production user=app_user';
        WHEN 'analytics' THEN
            RETURN 'host=analytics_replica port=5432 dbname=app_production user=analytics_user';
        ELSE
            RETURN 'host=primary_host port=5432 dbname=app_production user=app_user';
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Connection routing based on query type
CREATE OR REPLACE FUNCTION route_query(query_text TEXT)
RETURNS TEXT AS $$
BEGIN
    IF query_text ~* '^(SELECT|WITH)' AND query_text !~* '(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)' THEN
        RETURN 'read';
    ELSIF query_text ~* '(INSERT|UPDATE|DELETE)' THEN
        RETURN 'write';
    ELSIF query_text ~* 'analytics|report|aggregate' THEN
        RETURN 'analytics';
    ELSE
        RETURN 'write'; -- Default to primary for safety
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Test query routing
SELECT route_query('SELECT * FROM customers WHERE country = ''US''');
SELECT route_query('INSERT INTO orders (customer_id, total) VALUES (1, 100)');
SELECT route_query('SELECT COUNT(*) FROM sales_analytics WHERE date >= ''2024-01-01''');
```

## Scaling Strategies

### Sharding Implementation

Database sharding distributes data across multiple PostgreSQL instances to handle massive scale. Proper sharding strategies consider data distribution patterns, cross-shard queries, and rebalancing requirements.

```sql
-- Horizontal sharding setup
-- Shard configuration table
CREATE TABLE shard_config (
    shard_id INTEGER PRIMARY KEY,
    shard_name TEXT UNIQUE NOT NULL,
    connection_string TEXT NOT NULL,
    min_hash_value BIGINT NOT NULL,
    max_hash_value BIGINT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert shard configuration
INSERT INTO shard_config (shard_id, shard_name, connection_string, min_hash_value, max_hash_value) VALUES
(1, 'shard_1', 'host=shard1.example.com port=5432 dbname=app_shard1', 0, 1073741823),
(2, 'shard_2', 'host=shard2.example.com port=5432 dbname=app_shard2', 1073741824, 2147483647),
(3, 'shard_3', 'host=shard3.example.com port=5432 dbname=app_shard3', 2147483648, 3221225471),
(4, 'shard_4', 'host=shard4.example.com port=5432 dbname=app_shard4', 3221225472, 4294967295);

-- Sharding function
CREATE OR REPLACE FUNCTION get_shard_for_key(sharding_key TEXT)
RETURNS INTEGER AS $$
DECLARE
    hash_value BIGINT;
    shard_id INTEGER;
BEGIN
    -- Calculate hash of the sharding key
    hash_value := abs(hashtext(sharding_key));
    
    -- Find appropriate shard
    SELECT sc.shard_id INTO shard_id
    FROM shard_config sc
    WHERE hash_value BETWEEN sc.min_hash_value AND sc.max_hash_value
      AND sc.is_active = true;
    
    IF shard_id IS NULL THEN
        RAISE EXCEPTION 'No active shard found for key: %', sharding_key;
    END IF;
    
    RETURN shard_id;
END;
$$ LANGUAGE plpgsql;

-- Sharded table structure (replicated on each shard)
CREATE TABLE customers_sharded (
    customer_id BIGSERIAL PRIMARY KEY,
    customer_key TEXT NOT NULL, -- Sharding key
    name TEXT NOT NULL,
    email TEXT,
    country TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure data is on correct shard
    CONSTRAINT check_shard CHECK (get_shard_for_key(customer_key) = @SHARD_ID@)
);

-- Shard-aware insert function
CREATE OR REPLACE FUNCTION insert_customer_sharded(
    p_customer_key TEXT,
    p_name TEXT,
    p_email TEXT,
    p_country TEXT
) RETURNS TABLE(shard_id INTEGER, customer_id BIGINT) AS $$
DECLARE
    target_shard INTEGER;
    new_customer_id BIGINT;
BEGIN
    target_shard := get_shard_for_key(p_customer_key);
    
    -- In a real implementation, this would connect to the appropriate shard
    -- For demo purposes, we'll assume we're on the correct shard
    INSERT INTO customers_sharded (customer_key, name, email, country)
    VALUES (p_customer_key, p_name, p_email, p_country)
    RETURNING customers_sharded.customer_id INTO new_customer_id;
    
    RETURN QUERY SELECT target_shard, new_customer_id;
END;
$$ LANGUAGE plpgsql;

-- Cross-shard query aggregation
CREATE OR REPLACE FUNCTION aggregate_across_shards(query_template TEXT)
RETURNS TABLE(result JSONB) AS $$
DECLARE
    shard_record RECORD;
    shard_query TEXT;
    shard_result JSONB;
    final_result JSONB := '[]'::JSONB;
BEGIN
    FOR shard_record IN 
        SELECT shard_id, shard_name, connection_string 
        FROM shard_config 
        WHERE is_active = true
    LOOP
        -- Replace placeholder with actual shard ID
        shard_query := replace(query_template, '@SHARD_ID@', shard_record.shard_id::TEXT);
        
        -- In practice, you'd execute this on the remote shard
        -- For demo, we'll simulate the result
        shard_result := jsonb_build_object(
            'shard_id', shard_record.shard_id,
            'shard_name', shard_record.shard_name,
            'data', '{"count": 1000, "sum": 50000}'::JSONB
        );
        
        final_result := final_result || jsonb_build_array(shard_result);
    END LOOP;
    
    RETURN QUERY SELECT final_result;
END;
$$ LANGUAGE plpgsql;

-- Test sharding
SELECT get_shard_for_key('customer_123');
SELECT get_shard_for_key('customer_456');
SELECT get_shard_for_key('customer_789');
```

### Foreign Data Wrappers (FDW)

Foreign Data Wrappers enable accessing external data sources as if they were local tables. This facilitates data federation, cross-database queries, and integration with heterogeneous systems without data migration.

```sql
-- Install postgres_fdw extension
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Create foreign server definitions
CREATE SERVER analytics_server
FOREIGN DATA WRAPPER postgres_fdw
OPTIONS (host 'analytics.example.com', port '5432', dbname 'analytics_db');

CREATE SERVER reporting_server
FOREIGN DATA WRAPPER postgres_fdw
OPTIONS (host 'reporting.example.com', port '5432', dbname 'reporting_db');

-- Create user mappings
CREATE USER MAPPING FOR app_user
SERVER analytics_server
OPTIONS (user 'analytics_user', password 'analytics_password');

CREATE USER MAPPING FOR app_user
SERVER reporting_server
OPTIONS (user 'reporting_user', password 'reporting_password');

-- Create foreign tables
CREATE FOREIGN TABLE remote_sales_data (
    sale_id BIGINT,
    sale_date DATE,
    customer_id INTEGER,
    amount NUMERIC(10,2),
    region TEXT
) SERVER analytics_server
OPTIONS (schema_name 'public', table_name 'sales_analytics');

CREATE FOREIGN TABLE remote_customer_segments (
    segment_id INTEGER,
    segment_name TEXT,
    customer_count INTEGER,
    avg_lifetime_value NUMERIC(10,2)
) SERVER reporting_server
OPTIONS (schema_name 'marketing', table_name 'customer_segments');

-- Query across local and remote data
SELECT 
    l.customer_id,
    l.name,
    r.amount as latest_sale_amount,
    rs.segment_name
FROM customers l
JOIN remote_sales_data r ON l.customer_id = r.customer_id
JOIN remote_customer_segments rs ON l.segment_id = rs.segment_id
WHERE r.sale_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY r.amount DESC
LIMIT 10;

-- Materialized view combining local and remote data
CREATE MATERIALIZED VIEW customer_360_view AS
SELECT 
    c.customer_id,
    c.name,
    c.email,
    c.country,
    COALESCE(rs.total_sales, 0) as lifetime_sales,
    COALESCE(rs.order_count, 0) as total_orders,
    seg.segment_name,
    seg.avg_lifetime_value as segment_avg_ltv
FROM customers c
LEFT JOIN (
    SELECT 
        customer_id,
        SUM(amount) as total_sales,
        COUNT(*) as order_count
    FROM remote_sales_data
    GROUP BY customer_id
) rs ON c.customer_id = rs.customer_id
LEFT JOIN remote_customer_segments seg ON c.segment_id = seg.segment_id;

-- Refresh materialized view periodically
SELECT pg_stat_get_last_analyze_time('customer_360_view'::regclass);
REFRESH MATERIALIZED VIEW customer_360_view;
```

### Citus: Distributed PostgreSQL

```sql
-- Install Citus extension
CREATE EXTENSION IF NOT EXISTS citus;

-- Add worker nodes to the cluster
SELECT citus_add_node('worker1.example.com', 5432);
SELECT citus_add_node('worker2.example.com', 5432);
SELECT citus_add_node('worker3.example.com', 5432);

-- View cluster status
SELECT * FROM citus_get_active_worker_nodes();

-- Create distributed tables
-- Distribute by customer_id for co-location
SELECT create_distributed_table('customers', 'customer_id');
SELECT create_distributed_table('orders', 'customer_id');
SELECT create_distributed_table('order_items', 'customer_id'); -- Note: needs customer_id added

-- Create reference tables (replicated to all nodes)
SELECT create_reference_table('products');
SELECT create_reference_table('shipping_zones');

-- Distributed queries work transparently
SELECT 
    c.country,
    COUNT(o.order_id) as order_count,
    SUM(o.total_amount) as total_revenue
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE o.order_date >= '2024-01-01'
GROUP BY c.country
ORDER BY total_revenue DESC;

-- Check shard distribution
SELECT 
    table_name,
    shard_count,
    shards_on_coordinator,
    colocation_id
FROM citus_tables;

-- Monitor distributed query performance
SELECT 
    query,
    state,
    wait_event_type,
    wait_event,
    query_start,
    backend_start
FROM citus_stat_activity();

-- Rebalance shards across workers
SELECT citus_rebalance_start();

-- Monitor rebalance progress
SELECT * FROM citus_rebalance_status();
```

## High Availability Patterns

### Automatic Failover with Patroni

```yaml
# patroni.yml configuration
scope: postgres-cluster
namespace: /db/
name: postgres-node-1

restapi:
  listen: 0.0.0.0:8008
  connect_address: node1.example.com:8008

etcd:
  hosts: etcd1.example.com:2379,etcd2.example.com:2379,etcd3.example.com:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 30
    maximum_lag_on_failover: 1048576
    master_start_timeout: 300
    synchronous_mode: true
    synchronous_mode_strict: false
    synchronous_node_count: 1
    
  postgresql:
    use_pg_rewind: true
    parameters:
      max_connections: 200
      shared_buffers: 256MB
      effective_cache_size: 1GB
      wal_level: replica
      max_wal_senders: 10
      wal_keep_size: 1GB

postgresql:
  listen: 0.0.0.0:5432
  connect_address: node1.example.com:5432
  data_dir: /var/lib/postgresql/data
  bin_dir: /usr/lib/postgresql/15/bin
  authentication:
    replication:
      username: replicator
      password: replicator_password
    superuser:
      username: postgres
      password: postgres_password
```

### Health Monitoring and Alerting

Comprehensive health monitoring detects issues before they impact users. Automated alerting systems enable rapid response to failures, performance degradation, and capacity limits.

```sql
-- Comprehensive health monitoring system
CREATE TABLE cluster_health_log (
    log_id BIGSERIAL PRIMARY KEY,
    node_name TEXT NOT NULL,
    node_role TEXT NOT NULL, -- 'primary', 'replica', 'witness'
    check_time TIMESTAMP DEFAULT NOW(),
    is_healthy BOOLEAN NOT NULL,
    health_details JSONB,
    response_time_ms INTEGER,
    error_message TEXT
);

-- Health check function
CREATE OR REPLACE FUNCTION perform_health_check()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details JSONB,
    action_required TEXT
) AS $$
DECLARE
    replication_lag INTEGER;
    connection_count INTEGER;
    max_conn INTEGER;
    disk_usage_percent NUMERIC;
    wal_size BIGINT;
BEGIN
    -- Check replication lag
    IF pg_is_in_recovery() THEN
        SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp()))::INTEGER 
        INTO replication_lag;
        
        RETURN QUERY SELECT 
            'replication_lag'::TEXT,
            CASE WHEN replication_lag > 60 THEN 'CRITICAL' 
                 WHEN replication_lag > 30 THEN 'WARNING' 
                 ELSE 'OK' END,
            jsonb_build_object('lag_seconds', replication_lag),
            CASE WHEN replication_lag > 60 THEN 'Check network and primary server'
                 ELSE 'None' END;
    END IF;
    
    -- Check connection usage
    SELECT COUNT(*), setting::INTEGER 
    INTO connection_count, max_conn
    FROM pg_stat_activity, pg_settings 
    WHERE name = 'max_connections';
    
    RETURN QUERY SELECT 
        'connection_usage'::TEXT,
        CASE WHEN connection_count::FLOAT / max_conn > 0.9 THEN 'CRITICAL'
             WHEN connection_count::FLOAT / max_conn > 0.8 THEN 'WARNING'
             ELSE 'OK' END,
        jsonb_build_object(
            'current_connections', connection_count,
            'max_connections', max_conn,
            'usage_percent', ROUND(connection_count::NUMERIC / max_conn * 100, 2)
        ),
        CASE WHEN connection_count::FLOAT / max_conn > 0.9 THEN 'Increase max_connections or add connection pooling'
             ELSE 'None' END;
    
    -- Check WAL disk usage
    SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'::pg_lsn) INTO wal_size;
    
    RETURN QUERY SELECT 
        'wal_size'::TEXT,
        CASE WHEN wal_size > 10 * 1024^3 THEN 'WARNING' ELSE 'OK' END, -- 10GB
        jsonb_build_object('wal_size_bytes', wal_size, 'wal_size_pretty', pg_size_pretty(wal_size)),
        CASE WHEN wal_size > 10 * 1024^3 THEN 'Check archive_command and replica connectivity'
             ELSE 'None' END;
    
    -- Add more checks as needed...
END;
$$ LANGUAGE plpgsql;

-- Automated health monitoring
CREATE OR REPLACE FUNCTION log_cluster_health()
RETURNS VOID AS $$
DECLARE
    health_record RECORD;
    overall_health BOOLEAN := true;
    health_summary JSONB := '[]'::JSONB;
BEGIN
    FOR health_record IN SELECT * FROM perform_health_check()
    LOOP
        health_summary := health_summary || jsonb_build_array(
            jsonb_build_object(
                'check', health_record.check_name,
                'status', health_record.status,
                'details', health_record.details
            )
        );
        
        IF health_record.status IN ('WARNING', 'CRITICAL') THEN
            overall_health := false;
        END IF;
    END LOOP;
    
    INSERT INTO cluster_health_log (
        node_name, 
        node_role, 
        is_healthy, 
        health_details
    ) VALUES (
        current_setting('cluster.application_name', true),
        CASE WHEN pg_is_in_recovery() THEN 'replica' ELSE 'primary' END,
        overall_health,
        health_summary
    );
END;
$$ LANGUAGE plpgsql;

-- Schedule health checks (run every minute)
-- In practice, this would be called by a cron job or monitoring system
SELECT log_cluster_health();
```

## Disaster Recovery

### Point-in-Time Recovery (PITR)

Point-in-Time Recovery enables restoring databases to any specific moment in time, providing protection against data corruption, accidental deletions, and application errors. PITR combines base backups with WAL archive replay.

```sql
-- Configure continuous archiving
-- postgresql.conf:
-- archive_mode = on
-- archive_command = 'cp %p /backup/wal_archive/%f'
-- wal_level = replica

-- Take base backup
-- pg_basebackup -D /backup/base_backup_$(date +%Y%m%d_%H%M%S) -Ft -z -P

-- Recovery configuration
-- recovery.conf (or postgresql.auto.conf in PostgreSQL 12+):
-- restore_command = 'cp /backup/wal_archive/%f %p'
-- recovery_target_time = '2024-01-15 14:30:00'
-- recovery_target_action = 'promote'

-- Monitor recovery progress
SELECT 
    pg_is_in_recovery() as in_recovery,
    pg_last_wal_receive_lsn() as receive_lsn,
    pg_last_wal_replay_lsn() as replay_lsn,
    pg_last_xact_replay_timestamp() as last_replay_time;

-- Automated backup management
CREATE TABLE backup_catalog (
    backup_id SERIAL PRIMARY KEY,
    backup_type TEXT NOT NULL, -- 'full', 'incremental', 'wal'
    backup_path TEXT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    size_bytes BIGINT,
    start_lsn pg_lsn,
    end_lsn pg_lsn,
    status TEXT DEFAULT 'running' -- 'running', 'completed', 'failed'
);

-- Function to initiate backup
CREATE OR REPLACE FUNCTION start_backup(backup_label TEXT)
RETURNS TABLE(backup_id INTEGER, start_lsn pg_lsn) AS $$
DECLARE
    new_backup_id INTEGER;
    backup_start_lsn pg_lsn;
BEGIN
    -- Start backup
    SELECT pg_start_backup(backup_label, false, false) INTO backup_start_lsn;
    
    -- Log backup start
    INSERT INTO backup_catalog (backup_type, backup_path, start_time, start_lsn)
    VALUES ('full', '/backup/base_backup_' || to_char(NOW(), 'YYYYMMDD_HH24MISS'), NOW(), backup_start_lsn)
    RETURNING backup_catalog.backup_id INTO new_backup_id;
    
    RETURN QUERY SELECT new_backup_id, backup_start_lsn;
END;
$$ LANGUAGE plpgsql;

-- Function to stop backup
CREATE OR REPLACE FUNCTION stop_backup(p_backup_id INTEGER)
RETURNS pg_lsn AS $$
DECLARE
    backup_end_lsn pg_lsn;
BEGIN
    -- Stop backup
    SELECT pg_stop_backup(false, true) INTO backup_end_lsn;
    
    -- Update backup record
    UPDATE backup_catalog 
    SET end_time = NOW(),
        end_lsn = backup_end_lsn,
        status = 'completed'
    WHERE backup_id = p_backup_id;
    
    RETURN backup_end_lsn;
END;
$$ LANGUAGE plpgsql;
```

## Next Steps

In the final lesson, we'll cover administration best practices, monitoring, security, and operational procedures that tie together all the replication and scaling concepts we've covered here.

Understanding replication and scaling strategies enables you to build PostgreSQL systems that can grow with your application while maintaining high availability and performance.
