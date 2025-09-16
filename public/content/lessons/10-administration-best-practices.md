# Administration & Best Practices

## Introduction

Effective PostgreSQL administration encompasses backup strategies, monitoring, security, performance tuning, and operational procedures. This lesson covers the essential practices for running PostgreSQL reliably in production environments.

## Backup & Recovery Strategies

### Comprehensive Backup Architecture

A robust backup architecture combines multiple backup types, automated scheduling, and comprehensive tracking. This approach ensures data protection while optimizing storage costs and recovery time objectives.

```sql
-- Backup configuration table
CREATE TABLE backup_schedules (
    schedule_id SERIAL PRIMARY KEY,
    backup_type TEXT NOT NULL, -- 'full', 'incremental', 'wal_archive'
    schedule_expression TEXT NOT NULL, -- Cron expression
    retention_days INTEGER NOT NULL,
    storage_location TEXT NOT NULL,
    encryption_key_id TEXT,
    compression_level INTEGER DEFAULT 6,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert backup schedules
INSERT INTO backup_schedules (backup_type, schedule_expression, retention_days, storage_location) VALUES
('full', '0 2 * * 0', 90, 's3://mycompany-backups/postgresql/full/'), -- Weekly full backup
('incremental', '0 2 * * 1-6', 30, 's3://mycompany-backups/postgresql/incremental/'), -- Daily incremental
('wal_archive', '*/5 * * * *', 7, 's3://mycompany-backups/postgresql/wal/'); -- WAL archival every 5 minutes

-- Backup execution tracking
CREATE TABLE backup_history (
    backup_id BIGSERIAL PRIMARY KEY,
    schedule_id INTEGER REFERENCES backup_schedules(schedule_id),
    backup_type TEXT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    status TEXT DEFAULT 'running', -- 'running', 'completed', 'failed', 'cancelled'
    backup_size_bytes BIGINT,
    backup_path TEXT NOT NULL,
    start_lsn pg_lsn,
    end_lsn pg_lsn,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Backup management functions
CREATE OR REPLACE FUNCTION execute_backup(p_schedule_id INTEGER)
RETURNS BIGINT AS $$
DECLARE
    schedule_record RECORD;
    backup_id BIGINT;
    backup_path TEXT;
    start_lsn pg_lsn;
    backup_label TEXT;
BEGIN
    -- Get schedule details
    SELECT * INTO schedule_record 
    FROM backup_schedules 
    WHERE schedule_id = p_schedule_id AND is_active = true;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Schedule % not found or inactive', p_schedule_id;
    END IF;
    
    -- Generate backup path
    backup_path := schedule_record.storage_location || 
                   to_char(NOW(), 'YYYY/MM/DD/') || 
                   'backup_' || to_char(NOW(), 'YYYYMMDD_HH24MISS');
    
    backup_label := 'Scheduled backup ' || schedule_record.backup_type || ' ' || to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
    
    -- Start backup tracking
    INSERT INTO backup_history (schedule_id, backup_type, start_time, backup_path, start_lsn)
    VALUES (p_schedule_id, schedule_record.backup_type, NOW(), backup_path, pg_current_wal_lsn())
    RETURNING backup_history.backup_id INTO backup_id;
    
    -- For demonstration, we'll mark as completed immediately
    -- In practice, this would integrate with backup tools like pg_basebackup, Barman, etc.
    UPDATE backup_history 
    SET end_time = NOW() + INTERVAL '1 hour', -- Simulated backup duration
        status = 'completed',
        backup_size_bytes = 1024 * 1024 * 1024, -- 1GB simulated
        end_lsn = pg_current_wal_lsn(),
        metadata = jsonb_build_object(
            'compression_level', schedule_record.compression_level,
            'encryption', CASE WHEN schedule_record.encryption_key_id IS NOT NULL THEN true ELSE false END
        )
    WHERE backup_history.backup_id = backup_id;
    
    RETURN backup_id;
END;
$$ LANGUAGE plpgsql;

-- Backup cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_backups()
RETURNS TABLE(
    deleted_backup_id BIGINT,
    backup_path TEXT,
    backup_age_days INTEGER
) AS $$
DECLARE
    cleanup_record RECORD;
BEGIN
    FOR cleanup_record IN
        SELECT 
            bh.backup_id,
            bh.backup_path,
            bs.retention_days,
            EXTRACT(DAYS FROM (NOW() - bh.end_time))::INTEGER as age_days
        FROM backup_history bh
        JOIN backup_schedules bs ON bh.schedule_id = bs.schedule_id
        WHERE bh.status = 'completed'
          AND bh.end_time < NOW() - (bs.retention_days || ' days')::INTERVAL
    LOOP
        -- Mark for deletion (in practice, would delete from storage)
        UPDATE backup_history 
        SET status = 'deleted',
            metadata = metadata || jsonb_build_object('deleted_at', NOW())
        WHERE backup_id = cleanup_record.backup_id;
        
        RETURN QUERY SELECT 
            cleanup_record.backup_id,
            cleanup_record.backup_path,
            cleanup_record.age_days;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Test backup functions
SELECT execute_backup(1); -- Execute full backup
SELECT execute_backup(2); -- Execute incremental backup
SELECT * FROM cleanup_old_backups();
```

### Point-in-Time Recovery Procedures

Point-in-Time Recovery requires careful planning and validation to ensure successful restoration. Proper procedures include backup verification, WAL file tracking, and recovery validation steps.

```sql
-- Recovery point catalog
CREATE TABLE recovery_points (
    recovery_id SERIAL PRIMARY KEY,
    recovery_name TEXT NOT NULL,
    recovery_time TIMESTAMP NOT NULL,
    description TEXT,
    base_backup_id BIGINT REFERENCES backup_history(backup_id),
    required_wal_files TEXT[],
    created_by TEXT DEFAULT current_user,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Function to identify recovery requirements
CREATE OR REPLACE FUNCTION plan_recovery(target_time TIMESTAMP)
RETURNS TABLE(
    base_backup_id BIGINT,
    base_backup_path TEXT,
    base_backup_time TIMESTAMP,
    wal_files_needed TEXT[],
    estimated_recovery_time INTERVAL
) AS $$
DECLARE
    best_backup RECORD;
    wal_files TEXT[];
BEGIN
    -- Find the most recent backup before target time
    SELECT bh.backup_id, bh.backup_path, bh.end_time
    INTO best_backup
    FROM backup_history bh
    WHERE bh.backup_type = 'full'
      AND bh.status = 'completed'
      AND bh.end_time <= target_time
    ORDER BY bh.end_time DESC
    LIMIT 1;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No suitable base backup found for recovery to %', target_time;
    END IF;
    
    -- Estimate WAL files needed (simplified)
    wal_files := ARRAY['00000001000000000000001', '00000001000000000000002']; -- Placeholder
    
    RETURN QUERY SELECT 
        best_backup.backup_id,
        best_backup.backup_path,
        best_backup.end_time,
        wal_files,
        target_time - best_backup.end_time; -- Estimated recovery time
END;
$$ LANGUAGE plpgsql;

-- Recovery validation function
CREATE OR REPLACE FUNCTION validate_recovery_point(p_recovery_id INTEGER)
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details TEXT
) AS $$
DECLARE
    recovery_record RECORD;
    backup_record RECORD;
BEGIN
    -- Get recovery point details
    SELECT * INTO recovery_record 
    FROM recovery_points 
    WHERE recovery_id = p_recovery_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'recovery_point'::TEXT, 'ERROR'::TEXT, 'Recovery point not found'::TEXT;
        RETURN;
    END IF;
    
    -- Check base backup exists
    SELECT * INTO backup_record
    FROM backup_history 
    WHERE backup_id = recovery_record.base_backup_id 
      AND status = 'completed';
    
    IF FOUND THEN
        RETURN QUERY SELECT 'base_backup'::TEXT, 'OK'::TEXT, 
            ('Base backup available: ' || backup_record.backup_path)::TEXT;
    ELSE
        RETURN QUERY SELECT 'base_backup'::TEXT, 'ERROR'::TEXT, 
            'Base backup not available or incomplete'::TEXT;
    END IF;
    
    -- Check WAL files availability (simplified check)
    RETURN QUERY SELECT 'wal_files'::TEXT, 'OK'::TEXT, 
        ('WAL files check passed for ' || array_length(recovery_record.required_wal_files, 1)::TEXT || ' files')::TEXT;
    
    -- Verify timeline consistency
    RETURN QUERY SELECT 'timeline'::TEXT, 'OK'::TEXT, 
        'Timeline consistency verified'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Test recovery planning
SELECT * FROM plan_recovery('2024-01-15 14:30:00'::TIMESTAMP);

-- Create and validate recovery point
INSERT INTO recovery_points (recovery_name, recovery_time, description, base_backup_id, required_wal_files)
VALUES ('Before upgrade', '2024-01-15 14:30:00', 'Recovery point before major system upgrade', 1, 
        ARRAY['00000001000000000000001', '00000001000000000000002']);

SELECT * FROM validate_recovery_point(1);
```

## Monitoring & Performance Tracking

### Comprehensive Monitoring System

Effective monitoring combines system metrics, performance statistics, and business-specific indicators. A comprehensive monitoring system enables proactive issue detection and capacity planning.

```sql
-- Performance metrics collection
CREATE TABLE performance_metrics (
    metric_id BIGSERIAL PRIMARY KEY,
    collected_at TIMESTAMP DEFAULT NOW(),
    metric_type TEXT NOT NULL, -- 'connection', 'query', 'io', 'lock', 'replication'
    metric_name TEXT NOT NULL,
    metric_value NUMERIC,
    metric_unit TEXT,
    instance_name TEXT DEFAULT current_setting('cluster.application_name', true),
    additional_data JSONB DEFAULT '{}'
);

-- Create partitioned table for metrics (by day)
CREATE TABLE performance_metrics_partitioned (
    LIKE performance_metrics INCLUDING ALL
) PARTITION BY RANGE (collected_at);

-- Create daily partitions for current month
CREATE TABLE performance_metrics_today PARTITION OF performance_metrics_partitioned
FOR VALUES FROM (CURRENT_DATE) TO (CURRENT_DATE + INTERVAL '1 day');

-- Comprehensive metrics collection function
CREATE OR REPLACE FUNCTION collect_performance_metrics()
RETURNS VOID AS $$
DECLARE
    metric_time TIMESTAMP := NOW();
BEGIN
    -- Database size metrics
    INSERT INTO performance_metrics (collected_at, metric_type, metric_name, metric_value, metric_unit)
    SELECT 
        metric_time,
        'storage',
        'database_size_bytes',
        pg_database_size(current_database()),
        'bytes';
    
    -- Connection metrics
    INSERT INTO performance_metrics (collected_at, metric_type, metric_name, metric_value, metric_unit, additional_data)
    SELECT 
        metric_time,
        'connection',
        'active_connections',
        COUNT(*),
        'count',
        jsonb_build_object(
            'by_state', jsonb_object_agg(state, state_count),
            'by_database', jsonb_object_agg(datname, db_count)
        )
    FROM (
        SELECT 
            state,
            datname,
            COUNT(*) as state_count,
            COUNT(*) as db_count
        FROM pg_stat_activity 
        WHERE state IS NOT NULL
        GROUP BY state, datname
    ) connection_stats;
    
    -- Query performance metrics
    INSERT INTO performance_metrics (collected_at, metric_type, metric_name, metric_value, metric_unit, additional_data)
    SELECT 
        metric_time,
        'query',
        'avg_query_time_ms',
        AVG(total_exec_time / calls),
        'milliseconds',
        jsonb_build_object(
            'total_queries', SUM(calls),
            'total_time_ms', SUM(total_exec_time),
            'top_queries', jsonb_agg(
                jsonb_build_object(
                    'query', LEFT(query, 100),
                    'calls', calls,
                    'avg_time', total_exec_time / calls
                ) ORDER BY total_exec_time / calls DESC
            ) FILTER (WHERE total_exec_time / calls > 1000) -- Only queries > 1 second avg
        )
    FROM pg_stat_statements
    WHERE calls > 0;
    
    -- Lock metrics
    INSERT INTO performance_metrics (collected_at, metric_type, metric_name, metric_value, metric_unit, additional_data)
    SELECT 
        metric_time,
        'locks',
        'waiting_locks',
        COUNT(*),
        'count',
        jsonb_build_object(
            'by_mode', jsonb_object_agg(mode, mode_count),
            'by_type', jsonb_object_agg(locktype, type_count)
        )
    FROM (
        SELECT 
            mode,
            locktype,
            COUNT(*) as mode_count,
            COUNT(*) as type_count
        FROM pg_locks 
        WHERE NOT granted
        GROUP BY mode, locktype
    ) lock_stats;
    
    -- Replication metrics (if applicable)
    IF NOT pg_is_in_recovery() THEN
        INSERT INTO performance_metrics (collected_at, metric_type, metric_name, metric_value, metric_unit, additional_data)
        SELECT 
            metric_time,
            'replication',
            'replica_lag_bytes',
            COALESCE(MAX(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)), 0),
            'bytes',
            jsonb_build_object(
                'replica_count', COUNT(*),
                'sync_replicas', COUNT(*) FILTER (WHERE sync_state = 'sync'),
                'async_replicas', COUNT(*) FILTER (WHERE sync_state = 'async')
            )
        FROM pg_stat_replication;
    END IF;
    
    -- Cache hit ratio
    INSERT INTO performance_metrics (collected_at, metric_type, metric_name, metric_value, metric_unit)
    SELECT 
        metric_time,
        'performance',
        'cache_hit_ratio',
        ROUND(
            100.0 * SUM(blks_hit) / NULLIF(SUM(blks_hit + blks_read), 0),
            2
        ),
        'percent'
    FROM pg_stat_database
    WHERE datname = current_database();
    
END;
$$ LANGUAGE plpgsql;

-- Automated alerting based on metrics
CREATE TABLE alert_rules (
    rule_id SERIAL PRIMARY KEY,
    rule_name TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    condition_operator TEXT NOT NULL, -- '>', '<', '>=', '<=', '=', '!='
    threshold_value NUMERIC NOT NULL,
    severity TEXT DEFAULT 'warning', -- 'info', 'warning', 'critical'
    is_active BOOLEAN DEFAULT true,
    notification_channels TEXT[], -- ['email', 'slack', 'pagerduty']
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sample alert rules
INSERT INTO alert_rules (rule_name, metric_type, metric_name, condition_operator, threshold_value, severity, notification_channels) VALUES
('High connection usage', 'connection', 'active_connections', '>', 150, 'warning', ARRAY['email']),
('Critical connection usage', 'connection', 'active_connections', '>', 180, 'critical', ARRAY['email', 'pagerduty']),
('Slow query performance', 'query', 'avg_query_time_ms', '>', 5000, 'warning', ARRAY['slack']),
('Replication lag critical', 'replication', 'replica_lag_bytes', '>', 100000000, 'critical', ARRAY['email', 'pagerduty']),
('Low cache hit ratio', 'performance', 'cache_hit_ratio', '<', 95, 'warning', ARRAY['email']);

-- Alert processing function
CREATE OR REPLACE FUNCTION process_alerts()
RETURNS TABLE(
    rule_name TEXT,
    severity TEXT,
    current_value NUMERIC,
    threshold_value NUMERIC,
    alert_message TEXT
) AS $$
DECLARE
    rule_record RECORD;
    latest_metric RECORD;
    alert_triggered BOOLEAN;
BEGIN
    FOR rule_record IN 
        SELECT * FROM alert_rules WHERE is_active = true
    LOOP
        -- Get latest metric value
        SELECT metric_value INTO latest_metric
        FROM performance_metrics 
        WHERE metric_type = rule_record.metric_type 
          AND metric_name = rule_record.metric_name
        ORDER BY collected_at DESC
        LIMIT 1;
        
        IF FOUND THEN
            -- Evaluate condition
            alert_triggered := CASE rule_record.condition_operator
                WHEN '>' THEN latest_metric.metric_value > rule_record.threshold_value
                WHEN '<' THEN latest_metric.metric_value < rule_record.threshold_value
                WHEN '>=' THEN latest_metric.metric_value >= rule_record.threshold_value
                WHEN '<=' THEN latest_metric.metric_value <= rule_record.threshold_value
                WHEN '=' THEN latest_metric.metric_value = rule_record.threshold_value
                WHEN '!=' THEN latest_metric.metric_value != rule_record.threshold_value
                ELSE false
            END;
            
            IF alert_triggered THEN
                RETURN QUERY SELECT 
                    rule_record.rule_name,
                    rule_record.severity,
                    latest_metric.metric_value,
                    rule_record.threshold_value,
                    format('%s: %s %s %s (current: %s)',
                        rule_record.rule_name,
                        rule_record.metric_name,
                        rule_record.condition_operator,
                        rule_record.threshold_value,
                        latest_metric.metric_value
                    );
            END IF;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule metrics collection (would be called by cron/scheduler)
SELECT collect_performance_metrics();
SELECT * FROM process_alerts();
```

### Advanced Monitoring Queries

Advanced monitoring queries provide deep insights into database behavior, identifying performance bottlenecks, resource contention, and operational anomalies. These queries form the foundation of proactive database management.

```sql
-- Top resource-consuming queries
CREATE VIEW slow_queries AS
SELECT 
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent,
    100.0 * total_exec_time / sum(total_exec_time) OVER() AS time_percent
FROM pg_stat_statements 
ORDER BY total_exec_time DESC;

-- Table bloat analysis
CREATE VIEW table_bloat_analysis AS
WITH table_stats AS (
    SELECT 
        schemaname,
        tablename,
        n_live_tup,
        n_dead_tup,
        pg_total_relation_size(schemaname||'.'||tablename) as total_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size_pretty,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
    FROM pg_stat_user_tables
)
SELECT 
    schemaname,
    tablename,
    n_live_tup,
    n_dead_tup,
    ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_tuple_percent,
    size_pretty,
    total_size,
    last_vacuum,
    last_autovacuum,
    CASE 
        WHEN n_dead_tup::FLOAT / NULLIF(n_live_tup + n_dead_tup, 0) > 0.2 THEN 'HIGH'
        WHEN n_dead_tup::FLOAT / NULLIF(n_live_tup + n_dead_tup, 0) > 0.1 THEN 'MEDIUM'
        ELSE 'LOW'
    END as bloat_level
FROM table_stats
WHERE n_live_tup + n_dead_tup > 0
ORDER BY dead_tuple_percent DESC;

-- Index usage analysis
CREATE VIEW index_usage_analysis AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size,
    pg_relation_size(indexname::regclass) as size_bytes,
    CASE 
        WHEN idx_scan = 0 THEN 'UNUSED'
        WHEN idx_scan < 100 THEN 'LOW_USAGE'
        WHEN idx_scan < 1000 THEN 'MEDIUM_USAGE'
        ELSE 'HIGH_USAGE'
    END as usage_category
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexname::regclass) DESC;

-- Connection analysis
CREATE VIEW connection_analysis AS
SELECT 
    datname,
    usename,
    application_name,
    client_addr,
    state,
    COUNT(*) as connection_count,
    AVG(EXTRACT(EPOCH FROM (NOW() - backend_start))) as avg_connection_age_seconds,
    MAX(EXTRACT(EPOCH FROM (NOW() - backend_start))) as max_connection_age_seconds,
    COUNT(*) FILTER (WHERE state = 'active') as active_connections,
    COUNT(*) FILTER (WHERE state = 'idle') as idle_connections,
    COUNT(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
FROM pg_stat_activity
WHERE pid != pg_backend_pid()
GROUP BY datname, usename, application_name, client_addr, state
ORDER BY connection_count DESC;

-- Test monitoring views
SELECT * FROM slow_queries LIMIT 5;
SELECT * FROM table_bloat_analysis WHERE bloat_level IN ('HIGH', 'MEDIUM') LIMIT 5;
SELECT * FROM index_usage_analysis WHERE usage_category = 'UNUSED' LIMIT 5;
SELECT * FROM connection_analysis LIMIT 10;
```

## Security Management

### Role-Based Access Control

Role-based access control implements the principle of least privilege, ensuring users have only the minimum permissions necessary for their functions. Proper RBAC reduces security risks and simplifies permission management.

```sql
-- Create role hierarchy
CREATE ROLE app_roles; -- Group role

-- Application-specific roles
CREATE ROLE app_readonly INHERIT;
CREATE ROLE app_readwrite INHERIT;
CREATE ROLE app_admin INHERIT;

-- Grant role hierarchy
GRANT app_readonly TO app_roles;
GRANT app_readwrite TO app_roles;
GRANT app_admin TO app_roles;

-- Data access roles
CREATE ROLE data_analyst INHERIT;
CREATE ROLE data_engineer INHERIT;
CREATE ROLE backup_operator INHERIT;

-- Grant appropriate base permissions
GRANT app_readonly TO data_analyst;
GRANT app_readwrite TO data_engineer;
GRANT app_admin TO backup_operator;

-- Create specific user accounts
CREATE USER alice_analyst PASSWORD 'secure_password' IN ROLE data_analyst;
CREATE USER bob_engineer PASSWORD 'secure_password' IN ROLE data_engineer;
CREATE USER charlie_admin PASSWORD 'secure_password' IN ROLE app_admin;

-- Database-level permissions
GRANT CONNECT ON DATABASE app_production TO app_roles;
GRANT USAGE ON SCHEMA public TO app_roles;
GRANT USAGE ON SCHEMA analytics TO data_analyst, data_engineer;

-- Table-level permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_readwrite;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;

-- Sequence permissions
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_readwrite;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;

-- Function permissions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_readwrite;

-- Set default permissions for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_readwrite;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO app_admin;
```

### Row-Level Security (RLS)

Row-Level Security provides fine-grained access control at the data level, enabling multi-tenant applications and complex authorization schemes. RLS policies automatically filter data based on user context.

```sql
-- Enable RLS on sensitive tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_data ENABLE ROW LEVEL SECURITY;

-- Policy for region-based access
CREATE POLICY customer_region_policy ON customers
    FOR ALL TO app_roles
    USING (
        CASE 
            WHEN current_setting('app.user_region', true) IS NULL THEN true -- Admin access
            ELSE country = current_setting('app.user_region', true)
        END
    );

-- Policy for user data access
CREATE POLICY user_data_policy ON user_profiles
    FOR ALL TO app_readonly, app_readwrite
    USING (user_id = current_setting('app.current_user_id', true)::INTEGER);

-- Time-based access policy
CREATE POLICY business_hours_policy ON sensitive_operations
    FOR ALL TO app_readwrite
    USING (
        EXTRACT(DOW FROM NOW()) BETWEEN 1 AND 5 -- Monday to Friday
        AND EXTRACT(HOUR FROM NOW()) BETWEEN 9 AND 17 -- 9 AM to 5 PM
    );

-- Audit trail policy
CREATE POLICY audit_access_policy ON audit_log
    FOR SELECT TO app_readonly, app_readwrite
    USING (
        created_by = current_user OR 
        'app_admin' = ANY(ARRAY(SELECT rolname FROM pg_roles WHERE pg_has_role(current_user, oid, 'member')))
    );

-- Test RLS policies
SET app.user_region = 'US';
SELECT COUNT(*) FROM customers; -- Should only show US customers

SET app.current_user_id = '123';
SELECT * FROM user_profiles; -- Should only show user 123's profile

RESET app.user_region;
RESET app.current_user_id;
```

### Security Monitoring and Auditing

Security monitoring and auditing track access patterns, detect suspicious activities, and ensure compliance with security policies. Comprehensive auditing provides accountability and forensic capabilities.

```sql
-- Audit log table
CREATE TABLE security_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    event_time TIMESTAMP DEFAULT NOW(),
    username TEXT NOT NULL,
    database_name TEXT NOT NULL,
    schema_name TEXT,
    object_name TEXT,
    object_type TEXT, -- 'table', 'function', 'role', etc.
    operation_type TEXT NOT NULL, -- 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'GRANT', 'REVOKE', etc.
    client_ip INET,
    application_name TEXT,
    query_text TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    session_id TEXT,
    additional_info JSONB DEFAULT '{}'
);

-- Create partitioned audit table
CREATE TABLE security_audit_log_partitioned (
    LIKE security_audit_log INCLUDING ALL
) PARTITION BY RANGE (event_time);

-- Function to log security events
CREATE OR REPLACE FUNCTION log_security_event(
    p_operation_type TEXT,
    p_object_name TEXT DEFAULT NULL,
    p_object_type TEXT DEFAULT NULL,
    p_success BOOLEAN DEFAULT true,
    p_error_message TEXT DEFAULT NULL,
    p_additional_info JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
    INSERT INTO security_audit_log (
        username,
        database_name,
        object_name,
        object_type,
        operation_type,
        client_ip,
        application_name,
        success,
        error_message,
        session_id,
        additional_info
    ) VALUES (
        current_user,
        current_database(),
        p_object_name,
        p_object_type,
        p_operation_type,
        inet_client_addr(),
        current_setting('application_name', true),
        p_success,
        p_error_message,
        current_setting('application_name', true) || '_' || pg_backend_pid(),
        p_additional_info
    );
END;
$$ LANGUAGE plpgsql;

-- Security monitoring functions
CREATE OR REPLACE FUNCTION detect_suspicious_activity()
RETURNS TABLE(
    alert_type TEXT,
    alert_severity TEXT,
    username TEXT,
    event_count BIGINT,
    time_window TEXT,
    details JSONB
) AS $$
BEGIN
    -- Failed login attempts
    RETURN QUERY
    SELECT 
        'failed_login_attempts'::TEXT,
        CASE WHEN COUNT(*) > 10 THEN 'critical' ELSE 'warning' END,
        sal.username,
        COUNT(*),
        'last_hour'::TEXT,
        jsonb_build_object(
            'client_ips', array_agg(DISTINCT sal.client_ip),
            'applications', array_agg(DISTINCT sal.application_name)
        )
    FROM security_audit_log sal
    WHERE sal.event_time >= NOW() - INTERVAL '1 hour'
      AND sal.operation_type = 'LOGIN'
      AND sal.success = false
    GROUP BY sal.username
    HAVING COUNT(*) > 5;
    
    -- Unusual privilege escalations
    RETURN QUERY
    SELECT 
        'privilege_escalation'::TEXT,
        'warning'::TEXT,
        sal.username,
        COUNT(*),
        'last_24_hours'::TEXT,
        jsonb_build_object(
            'operations', array_agg(DISTINCT sal.operation_type),
            'objects', array_agg(DISTINCT sal.object_name)
        )
    FROM security_audit_log sal
    WHERE sal.event_time >= NOW() - INTERVAL '24 hours'
      AND sal.operation_type IN ('GRANT', 'REVOKE', 'ALTER ROLE')
      AND sal.success = true
    GROUP BY sal.username
    HAVING COUNT(*) > 3;
    
    -- Excessive data access
    RETURN QUERY
    SELECT 
        'excessive_data_access'::TEXT,
        'warning'::TEXT,
        sal.username,
        COUNT(*),
        'last_hour'::TEXT,
        jsonb_build_object(
            'tables_accessed', array_agg(DISTINCT sal.object_name),
            'unique_tables', COUNT(DISTINCT sal.object_name)
        )
    FROM security_audit_log sal
    WHERE sal.event_time >= NOW() - INTERVAL '1 hour'
      AND sal.operation_type = 'SELECT'
      AND sal.object_type = 'table'
      AND sal.success = true
    GROUP BY sal.username
    HAVING COUNT(*) > 1000 OR COUNT(DISTINCT sal.object_name) > 50;
END;
$$ LANGUAGE plpgsql;

-- Password policy enforcement
CREATE OR REPLACE FUNCTION validate_password_policy(username TEXT, password TEXT)
RETURNS TABLE(
    check_name TEXT,
    passed BOOLEAN,
    message TEXT
) AS $$
BEGIN
    -- Length check
    RETURN QUERY SELECT 
        'length'::TEXT,
        length(password) >= 12,
        CASE WHEN length(password) >= 12 
            THEN 'Password length is adequate' 
            ELSE 'Password must be at least 12 characters' END;
    
    -- Complexity checks
    RETURN QUERY SELECT 
        'uppercase'::TEXT,
        password ~ '[A-Z]',
        CASE WHEN password ~ '[A-Z]' 
            THEN 'Contains uppercase letters' 
            ELSE 'Must contain at least one uppercase letter' END;
    
    RETURN QUERY SELECT 
        'lowercase'::TEXT,
        password ~ '[a-z]',
        CASE WHEN password ~ '[a-z]' 
            THEN 'Contains lowercase letters' 
            ELSE 'Must contain at least one lowercase letter' END;
    
    RETURN QUERY SELECT 
        'numbers'::TEXT,
        password ~ '[0-9]',
        CASE WHEN password ~ '[0-9]' 
            THEN 'Contains numbers' 
            ELSE 'Must contain at least one number' END;
    
    RETURN QUERY SELECT 
        'special_chars'::TEXT,
        password ~ '[!@#$%^&*()_+\-=\[\]{};:"\\|,.<>\?]',
        CASE WHEN password ~ '[!@#$%^&*()_+\-=\[\]{};:"\\|,.<>\?]' 
            THEN 'Contains special characters' 
            ELSE 'Must contain at least one special character' END;
    
    -- Username similarity check
    RETURN QUERY SELECT 
        'username_similarity'::TEXT,
        NOT (upper(password) LIKE '%' || upper(username) || '%'),
        CASE WHEN NOT (upper(password) LIKE '%' || upper(username) || '%')
            THEN 'Password is not similar to username' 
            ELSE 'Password must not contain username' END;
END;
$$ LANGUAGE plpgsql;

-- Test security functions
SELECT * FROM detect_suspicious_activity();
SELECT * FROM validate_password_policy('alice_analyst', 'weak');
SELECT * FROM validate_password_policy('alice_analyst', 'SecureP@ssw0rd123!');
```

## Operational Best Practices

### Database Maintenance Automation

Automated maintenance ensures optimal database performance through scheduled tasks like vacuuming, statistics updates, and index maintenance. Automation reduces manual effort and ensures consistency.

```sql
-- Maintenance schedule table
CREATE TABLE maintenance_schedules (
    schedule_id SERIAL PRIMARY KEY,
    maintenance_type TEXT NOT NULL, -- 'vacuum', 'analyze', 'reindex', 'stats_update'
    target_schema TEXT,
    target_table TEXT,
    schedule_expression TEXT NOT NULL, -- Cron expression
    maintenance_options JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_run TIMESTAMP,
    next_run TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert maintenance schedules
INSERT INTO maintenance_schedules (maintenance_type, target_schema, target_table, schedule_expression, maintenance_options) VALUES
('vacuum', 'public', NULL, '0 2 * * *', '{"analyze": true, "freeze": false}'), -- Daily vacuum
('analyze', 'public', NULL, '0 3 * * 0', '{"sample_size": 10000}'), -- Weekly analyze
('reindex', 'public', 'large_table', '0 4 * * 0', '{"concurrent": true}'), -- Weekly reindex
('stats_update', NULL, NULL, '0 1 * * *', '{"cascade": true}'); -- Daily stats update

-- Maintenance execution function
CREATE OR REPLACE FUNCTION execute_maintenance(p_schedule_id INTEGER)
RETURNS TABLE(
    schedule_id INTEGER,
    maintenance_type TEXT,
    target_object TEXT,
    status TEXT,
    duration_seconds INTEGER,
    details JSONB
) AS $$
DECLARE
    schedule_record RECORD;
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    sql_command TEXT;
    result_details JSONB := '{}';
BEGIN
    SELECT * INTO schedule_record 
    FROM maintenance_schedules 
    WHERE maintenance_schedules.schedule_id = p_schedule_id 
      AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT p_schedule_id, 'unknown'::TEXT, 'N/A'::TEXT, 'error'::TEXT, 0, 
            '{"error": "Schedule not found or inactive"}'::JSONB;
        RETURN;
    END IF;
    
    start_time := NOW();
    
    BEGIN
        CASE schedule_record.maintenance_type
            WHEN 'vacuum' THEN
                IF schedule_record.target_table IS NOT NULL THEN
                    sql_command := format('VACUUM %s %I.%I',
                        CASE WHEN (schedule_record.maintenance_options->>'analyze')::BOOLEAN THEN 'ANALYZE' ELSE '' END,
                        schedule_record.target_schema,
                        schedule_record.target_table
                    );
                ELSE
                    sql_command := format('VACUUM %s',
                        CASE WHEN (schedule_record.maintenance_options->>'analyze')::BOOLEAN THEN 'ANALYZE' ELSE '' END
                    );
                END IF;
                
            WHEN 'analyze' THEN
                IF schedule_record.target_table IS NOT NULL THEN
                    sql_command := format('ANALYZE %I.%I', schedule_record.target_schema, schedule_record.target_table);
                ELSE
                    sql_command := 'ANALYZE';
                END IF;
                
            WHEN 'reindex' THEN
                IF schedule_record.target_table IS NOT NULL THEN
                    sql_command := format('REINDEX %s TABLE %I.%I',
                        CASE WHEN (schedule_record.maintenance_options->>'concurrent')::BOOLEAN THEN 'CONCURRENTLY' ELSE '' END,
                        schedule_record.target_schema,
                        schedule_record.target_table
                    );
                ELSE
                    sql_command := 'REINDEX DATABASE ' || current_database();
                END IF;
                
            WHEN 'stats_update' THEN
                -- Update table statistics
                sql_command := 'SELECT pg_stat_reset()';
        END CASE;
        
        -- Execute maintenance command
        EXECUTE sql_command;
        
        end_time := NOW();
        result_details := jsonb_build_object(
            'sql_command', sql_command,
            'executed_at', start_time,
            'options', schedule_record.maintenance_options
        );
        
        -- Update last run time
        UPDATE maintenance_schedules 
        SET last_run = start_time,
            next_run = start_time + INTERVAL '1 day' -- Simplified next run calculation
        WHERE maintenance_schedules.schedule_id = p_schedule_id;
        
        RETURN QUERY SELECT 
            p_schedule_id,
            schedule_record.maintenance_type,
            COALESCE(schedule_record.target_schema || '.' || schedule_record.target_table, 'database'),
            'success'::TEXT,
            EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER,
            result_details;
            
    EXCEPTION WHEN OTHERS THEN
        end_time := NOW();
        result_details := jsonb_build_object(
            'error', SQLERRM,
            'sql_command', sql_command,
            'executed_at', start_time
        );
        
        RETURN QUERY SELECT 
            p_schedule_id,
            schedule_record.maintenance_type,
            COALESCE(schedule_record.target_schema || '.' || schedule_record.target_table, 'database'),
            'error'::TEXT,
            EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER,
            result_details;
    END;
END;
$$ LANGUAGE plpgsql;

-- Maintenance health check
CREATE OR REPLACE FUNCTION check_maintenance_health()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    recommendation TEXT
) AS $$
BEGIN
    -- Check for tables needing vacuum
    RETURN QUERY
    SELECT 
        'table_bloat'::TEXT,
        CASE 
            WHEN MAX(dead_tuple_percent) > 20 THEN 'critical'
            WHEN MAX(dead_tuple_percent) > 10 THEN 'warning'
            ELSE 'ok'
        END,
        CASE 
            WHEN MAX(dead_tuple_percent) > 20 THEN 'Immediate VACUUM needed for tables: ' || string_agg(tablename, ', ')
            WHEN MAX(dead_tuple_percent) > 10 THEN 'Schedule VACUUM for tables: ' || string_agg(tablename, ', ')
            ELSE 'Table maintenance is up to date'
        END
    FROM (
        SELECT 
            tablename,
            ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_tuple_percent
        FROM pg_stat_user_tables
        WHERE n_live_tup + n_dead_tup > 1000 -- Only consider substantial tables
    ) bloat_stats;
    
    -- Check for missing table statistics
    RETURN QUERY
    SELECT 
        'table_statistics'::TEXT,
        CASE WHEN COUNT(*) > 0 THEN 'warning' ELSE 'ok' END,
        CASE 
            WHEN COUNT(*) > 0 THEN 'Run ANALYZE on tables: ' || string_agg(tablename, ', ')
            ELSE 'Table statistics are current'
        END
    FROM pg_stat_user_tables
    WHERE last_analyze IS NULL OR last_analyze < NOW() - INTERVAL '7 days';
    
    -- Check for unused indexes
    RETURN QUERY
    SELECT 
        'unused_indexes'::TEXT,
        CASE WHEN COUNT(*) > 0 THEN 'info' ELSE 'ok' END,
        CASE 
            WHEN COUNT(*) > 0 THEN 'Consider dropping unused indexes: ' || string_agg(indexname, ', ')
            ELSE 'Index usage looks healthy'
        END
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0 
      AND pg_relation_size(indexname::regclass) > 1024 * 1024; -- > 1MB
END;
$$ LANGUAGE plpgsql;

-- Test maintenance functions
SELECT * FROM execute_maintenance(1);
SELECT * FROM check_maintenance_health();
```

### Configuration Management

Configuration management ensures consistent settings across environments and tracks configuration changes over time. Proper configuration management prevents configuration drift and enables rapid environment provisioning.

```sql
-- Configuration tracking table
CREATE TABLE configuration_history (
    config_id BIGSERIAL PRIMARY KEY,
    parameter_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT DEFAULT current_user,
    changed_at TIMESTAMP DEFAULT NOW(),
    change_reason TEXT,
    requires_restart BOOLEAN DEFAULT false,
    applied BOOLEAN DEFAULT false
);

-- Function to track configuration changes
CREATE OR REPLACE FUNCTION track_config_change(
    p_parameter_name TEXT,
    p_new_value TEXT,
    p_change_reason TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    current_value TEXT;
    config_id BIGINT;
    needs_restart BOOLEAN;
BEGIN
    -- Get current value
    SELECT setting INTO current_value 
    FROM pg_settings 
    WHERE name = p_parameter_name;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parameter % not found', p_parameter_name;
    END IF;
    
    -- Check if restart is required
    SELECT context = 'postmaster' INTO needs_restart
    FROM pg_settings 
    WHERE name = p_parameter_name;
    
    -- Log the change
    INSERT INTO configuration_history 
    (parameter_name, old_value, new_value, change_reason, requires_restart)
    VALUES (p_parameter_name, current_value, p_new_value, p_change_reason, needs_restart)
    RETURNING configuration_history.config_id INTO config_id;
    
    -- Apply the change (if possible without restart)
    IF NOT needs_restart THEN
        BEGIN
            EXECUTE format('ALTER SYSTEM SET %I = %L', p_parameter_name, p_new_value);
            SELECT pg_reload_conf();
            
            UPDATE configuration_history 
            SET applied = true 
            WHERE configuration_history.config_id = config_id;
            
        EXCEPTION WHEN OTHERS THEN
            UPDATE configuration_history 
            SET applied = false 
            WHERE configuration_history.config_id = config_id;
            RAISE;
        END;
    END IF;
    
    RETURN config_id;
END;
$$ LANGUAGE plpgsql;

-- Configuration recommendations function
CREATE OR REPLACE FUNCTION get_config_recommendations()
RETURNS TABLE(
    parameter_name TEXT,
    current_value TEXT,
    recommended_value TEXT,
    reasoning TEXT,
    priority TEXT
) AS $$
DECLARE
    total_memory_kb BIGINT;
    connection_count INTEGER;
BEGIN
    -- Get system information
    SELECT setting::BIGINT INTO total_memory_kb FROM pg_settings WHERE name = 'shared_buffers';
    SELECT COUNT(*) INTO connection_count FROM pg_stat_activity;
    
    -- Shared buffers recommendation
    IF EXISTS (SELECT 1 FROM pg_settings WHERE name = 'shared_buffers' AND setting::BIGINT < 131072) THEN -- < 512MB
        RETURN QUERY SELECT 
            'shared_buffers'::TEXT,
            (SELECT setting FROM pg_settings WHERE name = 'shared_buffers'),
            '512MB'::TEXT,
            'Shared buffers should be 25% of total RAM for dedicated database servers'::TEXT,
            'high'::TEXT;
    END IF;
    
    -- Work memory recommendation based on connection count
    IF connection_count > 100 THEN
        RETURN QUERY SELECT 
            'work_mem'::TEXT,
            (SELECT setting FROM pg_settings WHERE name = 'work_mem'),
            '4MB'::TEXT,
            'Lower work_mem recommended for high connection count to avoid memory pressure'::TEXT,
            'medium'::TEXT;
    END IF;
    
    -- WAL settings for performance
    IF EXISTS (SELECT 1 FROM pg_settings WHERE name = 'wal_buffers' AND setting = '-1') THEN
        RETURN QUERY SELECT 
            'wal_buffers'::TEXT,
            '-1'::TEXT,
            '16MB'::TEXT,
            'Explicit WAL buffer setting can improve write performance'::TEXT,
            'medium'::TEXT;
    END IF;
    
    -- Checkpoint settings
    IF EXISTS (SELECT 1 FROM pg_settings WHERE name = 'checkpoint_completion_target' AND setting::NUMERIC < 0.9) THEN
        RETURN QUERY SELECT 
            'checkpoint_completion_target'::TEXT,
            (SELECT setting FROM pg_settings WHERE name = 'checkpoint_completion_target'),
            '0.9'::TEXT,
            'Higher checkpoint completion target reduces I/O spikes'::TEXT,
            'medium'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Test configuration functions
SELECT track_config_change('log_min_duration_statement', '1000', 'Enable slow query logging');
SELECT * FROM get_config_recommendations();

-- View current critical settings
SELECT 
    name,
    setting,
    unit,
    context,
    short_desc
FROM pg_settings 
WHERE name IN (
    'shared_buffers', 'work_mem', 'maintenance_work_mem', 
    'wal_buffers', 'checkpoint_completion_target', 
    'max_connections', 'log_min_duration_statement'
)
ORDER BY name;
```

## Conclusion

This comprehensive PostgreSQL course has covered the essential topics for experienced developers working with PostgreSQL in production environments. From understanding the architecture and advanced data types to implementing high availability and security best practices, you now have the foundation to build robust, scalable database systems.

### Key Takeaways

1. **PostgreSQL as a Platform**: Leverage extensions and procedural languages to build sophisticated database-centric applications
2. **Performance at Scale**: Use partitioning, proper indexing, and query optimization to maintain performance as data grows
3. **High Availability**: Implement replication and backup strategies that match your business requirements
4. **Security First**: Use role-based access control, row-level security, and comprehensive auditing
5. **Operational Excellence**: Automate monitoring, maintenance, and alerting for reliable production systems

### Next Steps

- Implement these patterns in your production environments
- Contribute to the PostgreSQL community
- Stay current with new PostgreSQL releases and features
- Build expertise in specific areas like PostGIS for spatial data or Citus for distributed scaling

PostgreSQL's combination of reliability, performance, and extensibility makes it an excellent choice for modern applications. The patterns and practices covered in this course will serve you well as you build and maintain PostgreSQL systems at scale.
