# Concurrency & Transactions

## Introduction

PostgreSQL's MVCC (Multi-Version Concurrency Control) system enables high-performance concurrent access while maintaining ACID properties. Understanding how transactions, isolation levels, and locking work together is crucial for building robust, scalable applications.

## MVCC in Practice

### Understanding Transaction Snapshots

PostgreSQL uses Multi-Version Concurrency Control (MVCC) to provide consistent reads without blocking writes. Each transaction sees a snapshot of the database at the moment it started, ensuring data consistency across concurrent operations.

```sql
-- Create test table for MVCC demonstrations
CREATE TABLE account_balances (
    account_id SERIAL PRIMARY KEY,
    account_name TEXT NOT NULL,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW(),
    version INTEGER DEFAULT 1
);

-- Insert sample accounts
INSERT INTO account_balances (account_name, balance) VALUES 
('Alice Savings', 1000.00),
('Bob Checking', 2500.00),
('Carol Business', 15000.00);

-- Demonstrate MVCC behavior across sessions
-- Session 1:
BEGIN;
SELECT txid_current(); -- Note this transaction ID
SELECT * FROM account_balances WHERE account_id = 1;

-- (Keep this transaction open and switch to Session 2)
```

```sql
-- Session 2 (concurrent with Session 1):
BEGIN;
SELECT txid_current(); -- Different transaction ID

-- Update the same row Session 1 is reading
UPDATE account_balances 
SET balance = balance - 100, 
    last_updated = NOW(),
    version = version + 1
WHERE account_id = 1;

-- Session 2 can see its own changes
SELECT * FROM account_balances WHERE account_id = 1;
COMMIT;

-- Now back to Session 1:
-- Session 1 still sees the original data (MVCC snapshot isolation)
SELECT * FROM account_balances WHERE account_id = 1;
COMMIT;

-- After Session 1 commits, fresh queries see Session 2's changes
SELECT * FROM account_balances WHERE account_id = 1;
```

### Transaction ID and Visibility

Every transaction receives a unique transaction ID (XID) that determines row visibility. PostgreSQL uses these XIDs along with tuple headers to implement MVCC, allowing multiple versions of rows to coexist safely.

```sql
-- Examine transaction visibility information
SELECT 
    account_id,
    account_name,
    balance,
    xmin, -- Transaction ID that created this row version
    xmax, -- Transaction ID that deleted this row version (0 if current)
    cmin, -- Command ID within transaction that created row
    cmax  -- Command ID within transaction that deleted row
FROM account_balances;

-- Check current transaction state
SELECT 
    txid_current() as current_txid,
    txid_current_snapshot() as snapshot_info,
    pg_backend_pid() as backend_pid;

-- View active transactions
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    backend_start,
    xact_start,
    query_start,
    state,
    query
FROM pg_stat_activity 
WHERE state = 'active' OR state = 'idle in transaction';
```

## Transaction Isolation Levels

### Read Uncommitted

Read Uncommitted is the lowest isolation level, allowing dirty reads of uncommitted changes from other transactions. While PostgreSQL supports this level for SQL compliance, it behaves identically to Read Committed due to MVCC architecture.

```sql
-- Read Uncommitted: Can see uncommitted changes from other transactions
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- Session A:
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
UPDATE account_balances SET balance = 999999 WHERE account_id = 1;
-- Don't commit yet

-- Session B:
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT * FROM account_balances WHERE account_id = 1; -- Sees dirty read!

-- Session A:
ROLLBACK; -- Changes are undone

-- Session B:
SELECT * FROM account_balances WHERE account_id = 1; -- Now sees original value
COMMIT;
```

### Read Committed (Default)

Read Committed ensures that transactions only see committed changes, preventing dirty reads. This is PostgreSQL's default isolation level, providing a good balance between consistency and concurrency for most applications.

```sql
-- Read Committed: Sees committed changes during transaction
-- Session A:
BEGIN; -- Uses READ COMMITTED by default
SELECT * FROM account_balances WHERE account_id = 1;

-- Session B:
BEGIN;
UPDATE account_balances SET balance = 1500 WHERE account_id = 1;
COMMIT;

-- Session A:
-- This read will see Session B's committed changes
SELECT * FROM account_balances WHERE account_id = 1;
COMMIT;
```

### Repeatable Read

Repeatable Read provides transaction-level consistency by maintaining the same snapshot throughout the transaction. This prevents non-repeatable reads and phantom reads within a single transaction's scope.

```sql
-- Repeatable Read: Consistent snapshot throughout transaction
-- Session A:
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT * FROM account_balances WHERE account_id = 1;

-- Session B:
BEGIN;
UPDATE account_balances SET balance = 2000 WHERE account_id = 1;
COMMIT;

-- Session A:
-- Still sees the original snapshot, not Session B's changes
SELECT * FROM account_balances WHERE account_id = 1;

-- But phantom reads are prevented for range queries too
SELECT COUNT(*) FROM account_balances WHERE balance > 500;

-- Session C:
INSERT INTO account_balances (account_name, balance) VALUES ('David Checking', 600);

-- Session A:
-- Still sees same count (no phantom reads)
SELECT COUNT(*) FROM account_balances WHERE balance > 500;
COMMIT;

-- Fresh transaction sees all changes
SELECT * FROM account_balances;
```

### Serializable

Serializable isolation provides the strongest consistency guarantees by ensuring that concurrent transactions produce the same result as if they executed serially. This prevents all forms of anomalies but may cause serialization failures.

```sql
-- Serializable: Strongest isolation, prevents all anomalies
CREATE TABLE transfer_log (
    transfer_id SERIAL PRIMARY KEY,
    from_account INTEGER,
    to_account INTEGER,
    amount NUMERIC(12,2),
    transfer_date TIMESTAMP DEFAULT NOW()
);

-- Session A: Transfer money
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Check source account balance
SELECT balance FROM account_balances WHERE account_id = 1; -- 1000.00

-- Session B: Concurrent transfer attempt
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Both sessions try to transfer from same account
-- Session A:
UPDATE account_balances SET balance = balance - 600 WHERE account_id = 1;
INSERT INTO transfer_log (from_account, to_account, amount) VALUES (1, 2, 600);

-- Session B:
UPDATE account_balances SET balance = balance - 500 WHERE account_id = 1;
-- This will block waiting for Session A

-- Session A:
COMMIT; -- Succeeds

-- Session B:
INSERT INTO transfer_log (from_account, to_account, amount) VALUES (1, 3, 500);
COMMIT; -- Fails with serialization error

-- Check the results
SELECT * FROM account_balances WHERE account_id = 1;
SELECT * FROM transfer_log;
```

## Row-Level Locking

### Explicit Locking Commands

Explicit locking provides fine-grained control over concurrent access patterns. Different lock modes offer varying levels of exclusivity, allowing applications to implement custom concurrency control strategies beyond isolation levels.

```sql
-- Different lock types for different use cases
BEGIN;

-- FOR UPDATE: Exclusive lock for updates
SELECT * FROM account_balances WHERE account_id = 1 FOR UPDATE;

-- Other sessions will block on this row until we commit/rollback
-- Try from another session:
-- SELECT * FROM account_balances WHERE account_id = 1 FOR UPDATE; -- Blocks

COMMIT;

-- FOR SHARE: Shared lock, prevents updates but allows other shared locks
BEGIN;
SELECT * FROM account_balances WHERE account_id = 1 FOR SHARE;

-- Another session can also acquire shared lock:
-- SELECT * FROM account_balances WHERE account_id = 1 FOR SHARE; -- Works

-- But updates will block:
-- UPDATE account_balances SET balance = 1100 WHERE account_id = 1; -- Blocks

COMMIT;
```

### Lock Strength Variations

PostgreSQL offers multiple lock strengths to match different concurrency requirements. Understanding when to use each lock type helps optimize application performance while maintaining data integrity.

```sql
-- FOR NO KEY UPDATE: Less restrictive than FOR UPDATE
BEGIN;
SELECT * FROM account_balances WHERE account_id = 1 FOR NO KEY UPDATE;

-- Another session can still acquire FOR KEY SHARE
-- (useful for foreign key references)

COMMIT;

-- FOR KEY SHARE: Weakest lock
BEGIN;
SELECT * FROM account_balances WHERE account_id = 1 FOR KEY SHARE;

-- Other sessions can update non-key columns
-- UPDATE account_balances SET balance = 1200 WHERE account_id = 1; -- Works

COMMIT;

-- Skip locked rows to avoid blocking
SELECT * FROM account_balances 
WHERE balance > 1000 
FOR UPDATE SKIP LOCKED;
```

### Lock Monitoring

Monitoring lock activity is essential for diagnosing performance issues and understanding system behavior under load. PostgreSQL provides comprehensive views for analyzing lock patterns and identifying bottlenecks.

```sql
-- Monitor current locks
SELECT 
    pl.pid,
    pl.locktype,
    pl.mode,
    pl.granted,
    pl.relation::regclass as relation_name,
    pl.tuple,
    pa.query,
    pa.state
FROM pg_locks pl
LEFT JOIN pg_stat_activity pa ON pl.pid = pa.pid
WHERE pl.relation IS NOT NULL
ORDER BY pl.granted, pl.pid;

-- Check for lock waits
SELECT 
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.DATABASE IS NOT DISTINCT FROM blocked_locks.DATABASE
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

## Advisory Locks

### Application-Level Coordination

Advisory locks enable application-level coordination without table or row locking. These named locks allow distributed applications to coordinate activities and prevent conflicting operations across multiple sessions.

```sql
-- Advisory locks for application-level coordination
-- Useful for preventing duplicate processing, coordinating batch jobs, etc.

-- Try to acquire exclusive advisory lock
SELECT pg_try_advisory_lock(12345) as lock_acquired;

-- If true, we got the lock. If false, someone else has it.

-- Perform exclusive operation here
DO $$
BEGIN
    IF pg_try_advisory_lock(12345) THEN
        -- Safe to proceed with exclusive operation
        RAISE NOTICE 'Acquired lock, processing...';
        PERFORM pg_sleep(2); -- Simulate work
        PERFORM pg_advisory_unlock(12345);
        RAISE NOTICE 'Released lock';
    ELSE
        RAISE NOTICE 'Could not acquire lock, skipping operation';
    END IF;
END $$;

-- Blocking advisory lock (waits until available)
SELECT pg_advisory_lock(54321);
-- Do work that requires exclusivity
SELECT pg_advisory_unlock(54321);
```

### Advisory Lock Patterns

Common advisory lock patterns include resource allocation, batch job coordination, and preventing duplicate work. These patterns demonstrate how advisory locks solve real-world concurrency challenges in distributed systems.

```sql
-- Session-based advisory locks (automatically released on session end)
CREATE OR REPLACE FUNCTION safe_batch_process(batch_id INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    -- Try to acquire lock for this batch
    IF NOT pg_try_advisory_lock(1000000 + batch_id) THEN
        RAISE NOTICE 'Batch % already being processed by another session', batch_id;
        RETURN FALSE;
    END IF;
    
    -- Process the batch
    RAISE NOTICE 'Processing batch %', batch_id;
    
    -- Simulate batch processing
    PERFORM pg_sleep(1);
    
    -- Lock automatically released when function exits
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Test concurrent batch processing
SELECT safe_batch_process(1); -- Run this simultaneously from multiple sessions

-- Shared advisory locks
SELECT pg_advisory_lock_shared(67890);
-- Multiple sessions can hold shared locks
-- SELECT pg_advisory_lock_shared(67890); -- Works from other sessions
-- SELECT pg_advisory_lock(67890); -- Blocks until all shared locks released
SELECT pg_advisory_unlock_shared(67890);

-- View current advisory locks
SELECT 
    locktype,
    objid,
    mode,
    granted,
    pid
FROM pg_locks 
WHERE locktype = 'advisory'
ORDER BY objid, pid;
```

## Deadlock Detection and Handling

### Understanding Deadlocks

Deadlocks occur when transactions wait for each other in a circular pattern, creating an unresolvable dependency. PostgreSQL automatically detects and resolves deadlocks by aborting one of the participating transactions.

```sql
-- Create scenario for deadlock demonstration
CREATE TABLE resource_a (id INTEGER PRIMARY KEY, value TEXT);
CREATE TABLE resource_b (id INTEGER PRIMARY KEY, value TEXT);

INSERT INTO resource_a VALUES (1, 'Resource A1'), (2, 'Resource A2');
INSERT INTO resource_b VALUES (1, 'Resource B1'), (2, 'Resource B2');

-- Session 1:
BEGIN;
UPDATE resource_a SET value = 'Modified by Session 1' WHERE id = 1;
-- Now try to update resource_b (but wait for Session 2 to start)

-- Session 2:
BEGIN;
UPDATE resource_b SET value = 'Modified by Session 2' WHERE id = 1;
-- Now try to update resource_a

-- Session 1:
UPDATE resource_b SET value = 'Also modified by Session 1' WHERE id = 1; -- Will block

-- Session 2:
UPDATE resource_a SET value = 'Also modified by Session 2' WHERE id = 1; -- Deadlock!

-- PostgreSQL will detect the deadlock and abort one transaction
```

### Deadlock Prevention Strategies

Preventing deadlocks requires consistent ordering of resource access and careful application design. These strategies help minimize deadlock occurrences and improve system reliability under concurrent load.

```sql
-- Strategy 1: Consistent lock ordering
CREATE OR REPLACE FUNCTION transfer_money_safe(
    from_account INTEGER,
    to_account INTEGER,
    amount NUMERIC(12,2)
) RETURNS BOOLEAN AS $$
DECLARE
    first_account INTEGER;
    second_account INTEGER;
BEGIN
    -- Always lock accounts in ID order to prevent deadlocks
    IF from_account < to_account THEN
        first_account := from_account;
        second_account := to_account;
    ELSE
        first_account := to_account;
        second_account := from_account;
    END IF;
    
    -- Lock accounts in consistent order
    PERFORM 1 FROM account_balances WHERE account_id = first_account FOR UPDATE;
    PERFORM 1 FROM account_balances WHERE account_id = second_account FOR UPDATE;
    
    -- Check sufficient funds
    IF (SELECT balance FROM account_balances WHERE account_id = from_account) < amount THEN
        RAISE EXCEPTION 'Insufficient funds';
    END IF;
    
    -- Perform transfer
    UPDATE account_balances SET balance = balance - amount WHERE account_id = from_account;
    UPDATE account_balances SET balance = balance + amount WHERE account_id = to_account;
    
    INSERT INTO transfer_log (from_account, to_account, amount) VALUES (from_account, to_account, amount);
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Test concurrent transfers
SELECT transfer_money_safe(1, 2, 100);
SELECT transfer_money_safe(2, 1, 50); -- No deadlock!
```

### Deadlock Monitoring

Monitoring deadlock patterns helps identify systemic issues and optimize application logic. Regular analysis of deadlock logs reveals problematic query patterns and resource contention points.

```sql
-- Enable deadlock logging
-- In postgresql.conf: log_lock_waits = on, deadlock_timeout = 1s

-- View deadlock statistics
SELECT 
    deadlocks
FROM pg_stat_database 
WHERE datname = current_database();

-- Function to simulate deadlock logging
CREATE OR REPLACE FUNCTION log_deadlock_info()
RETURNS TABLE(
    session_info TEXT,
    lock_info TEXT,
    query_info TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'PID: ' || pid::TEXT || ', User: ' || usename as session_info,
        'Waiting for: ' || wait_event as lock_info,
        'Query: ' || query as query_info
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock'
    ORDER BY query_start;
END;
$$ LANGUAGE plpgsql;
```

## Performance Implications of Concurrency

### Lock Contention Analysis

Analyzing lock contention patterns reveals system bottlenecks and helps optimize concurrent workloads. Understanding which resources create contention guides both schema design and application architecture decisions.

```sql
-- Monitor lock waits and contention
CREATE VIEW lock_monitoring AS
SELECT 
    pl.locktype,
    pl.mode,
    pl.granted,
    pl.relation::regclass as table_name,
    pl.pid,
    pa.usename,
    pa.application_name,
    pa.client_addr,
    pa.query_start,
    pa.state,
    pa.query
FROM pg_locks pl
LEFT JOIN pg_stat_activity pa ON pl.pid = pa.pid
WHERE pl.relation IS NOT NULL
ORDER BY pl.granted, pl.relation, pl.mode;

-- Lock wait analysis
WITH lock_waits AS (
    SELECT 
        pl.relation::regclass as table_name,
        pl.mode,
        COUNT(*) as wait_count,
        AVG(EXTRACT(EPOCH FROM (NOW() - pa.query_start))) as avg_wait_seconds
    FROM pg_locks pl
    JOIN pg_stat_activity pa ON pl.pid = pa.pid
    WHERE NOT pl.granted
    GROUP BY pl.relation, pl.mode
)
SELECT 
    table_name,
    mode,
    wait_count,
    ROUND(avg_wait_seconds, 2) as avg_wait_seconds
FROM lock_waits
ORDER BY wait_count DESC, avg_wait_seconds DESC;
```

### MVCC Maintenance

MVCC requires periodic maintenance to remove obsolete row versions and update visibility maps. Understanding vacuum processes and tuple visibility is crucial for maintaining optimal performance in high-transaction environments.

```sql
-- Monitor transaction age and long-running transactions
SELECT 
    pid,
    usename,
    application_name,
    state,
    xact_start,
    query_start,
    EXTRACT(EPOCH FROM (NOW() - xact_start)) as transaction_age_seconds,
    query
FROM pg_stat_activity
WHERE state != 'idle'
  AND xact_start IS NOT NULL
ORDER BY xact_start;

-- Check for VACUUM and ANALYZE needs
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_live_tup as live_tuples,
    n_dead_tup as dead_tuples,
    ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_tuple_percent,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY dead_tuple_percent DESC;

-- Table bloat estimation
WITH table_bloat AS (
    SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes,
        ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as bloat_percent
    FROM pg_stat_user_tables
    WHERE n_live_tup > 0
)
SELECT *
FROM table_bloat
WHERE bloat_percent > 10
ORDER BY size_bytes DESC;
```

## Transaction Management Best Practices

### Connection Pooling Considerations

Connection pooling affects transaction behavior and lock duration. Understanding how pooling modes interact with transaction boundaries helps optimize both resource usage and concurrency patterns.

```sql
-- Prepare statements for pooled connections
PREPARE transfer_stmt (INTEGER, INTEGER, NUMERIC) AS
    UPDATE account_balances 
    SET balance = balance + $3, 
        last_updated = NOW(),
        version = version + 1 
    WHERE account_id = $1;

-- Execute prepared statement
EXECUTE transfer_stmt(1, 2, -100.00);
EXECUTE transfer_stmt(2, 1, 100.00);

-- Deallocate when done (important in pooled environments)
DEALLOCATE transfer_stmt;

-- Check prepared statement cache
SELECT 
    name,
    statement,
    parameter_types,
    from_sql
FROM pg_prepared_statements;
```

### Optimistic vs Pessimistic Locking

Choosing between optimistic and pessimistic locking strategies depends on contention patterns and application requirements. Each approach offers different trade-offs between concurrency, complexity, and consistency guarantees.

```sql
-- Optimistic locking with version numbers
CREATE OR REPLACE FUNCTION update_account_optimistic(
    p_account_id INTEGER,
    p_expected_version INTEGER,
    p_new_balance NUMERIC(12,2)
) RETURNS BOOLEAN AS $$
DECLARE
    rows_affected INTEGER;
BEGIN
    UPDATE account_balances 
    SET balance = p_new_balance,
        last_updated = NOW(),
        version = version + 1
    WHERE account_id = p_account_id 
      AND version = p_expected_version;
    
    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    
    IF rows_affected = 0 THEN
        -- Version mismatch or account not found
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Usage pattern for optimistic locking
DO $$
DECLARE
    current_balance NUMERIC(12,2);
    current_version INTEGER;
    success BOOLEAN;
BEGIN
    -- Read current state
    SELECT balance, version INTO current_balance, current_version
    FROM account_balances WHERE account_id = 1;
    
    -- Application logic here...
    current_balance := current_balance + 50;
    
    -- Attempt optimistic update
    success := update_account_optimistic(1, current_version, current_balance);
    
    IF NOT success THEN
        RAISE NOTICE 'Update failed - version conflict or account not found';
    ELSE
        RAISE NOTICE 'Update successful';
    END IF;
END $$;

-- Pessimistic locking alternative
CREATE OR REPLACE FUNCTION update_account_pessimistic(
    p_account_id INTEGER,
    p_amount_change NUMERIC(12,2)
) RETURNS NUMERIC AS $$
DECLARE
    new_balance NUMERIC(12,2);
BEGIN
    -- Lock the row immediately
    SELECT balance INTO new_balance
    FROM account_balances 
    WHERE account_id = p_account_id 
    FOR UPDATE;
    
    -- Calculate new balance
    new_balance := new_balance + p_amount_change;
    
    -- Update with exclusive lock held
    UPDATE account_balances 
    SET balance = new_balance,
        last_updated = NOW(),
        version = version + 1
    WHERE account_id = p_account_id;
    
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;
```

## Advanced Concurrency Patterns

### Queue Processing with Skip Locked

```sql
-- Job queue table
CREATE TABLE job_queue (
    job_id SERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload JSONB,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    worker_id TEXT
);

-- Sample jobs
INSERT INTO job_queue (job_type, payload) VALUES 
('email', '{"to": "user@example.com", "subject": "Welcome"}'),
('report', '{"report_type": "monthly", "date": "2024-01-01"}'),
('cleanup', '{"table": "temp_data", "older_than": "7 days"}');

-- Worker function using SKIP LOCKED
CREATE OR REPLACE FUNCTION process_next_job(worker_name TEXT)
RETURNS TABLE(
    job_id INTEGER,
    job_type TEXT,
    payload JSONB
) AS $$
DECLARE
    selected_job RECORD;
BEGIN
    -- Select and lock next available job
    SELECT jq.job_id, jq.job_type, jq.payload
    INTO selected_job
    FROM job_queue jq
    WHERE jq.status = 'pending'
    ORDER BY jq.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF FOUND THEN
        -- Mark job as in progress
        UPDATE job_queue 
        SET status = 'processing',
            started_at = NOW(),
            worker_id = worker_name
        WHERE job_queue.job_id = selected_job.job_id;
        
        -- Return job details
        RETURN QUERY 
        SELECT selected_job.job_id, selected_job.job_type, selected_job.payload;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Multiple workers can run this concurrently without conflicts
SELECT * FROM process_next_job('worker-1');
SELECT * FROM process_next_job('worker-2');
```

### Rate Limiting with Advisory Locks

```sql
-- Rate limiting using advisory locks
CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    window_start TIMESTAMP DEFAULT NOW(),
    limit_per_window INTEGER NOT NULL,
    window_duration INTERVAL NOT NULL
);

CREATE OR REPLACE FUNCTION check_rate_limit(
    limit_key TEXT,
    max_requests INTEGER,
    window_interval INTERVAL
) RETURNS BOOLEAN AS $$
DECLARE
    lock_id BIGINT;
    current_count INTEGER;
    window_start TIMESTAMP;
BEGIN
    -- Convert key to numeric lock ID
    lock_id := abs(hashtext(limit_key));
    
    -- Acquire advisory lock for this key
    PERFORM pg_advisory_lock(lock_id);
    
    BEGIN
        -- Get or create rate limit record
        SELECT count, rate_limits.window_start INTO current_count, window_start
        FROM rate_limits 
        WHERE key = limit_key;
        
        IF NOT FOUND THEN
            -- First request for this key
            INSERT INTO rate_limits (key, count, limit_per_window, window_duration)
            VALUES (limit_key, 1, max_requests, window_interval);
            RETURN TRUE;
        END IF;
        
        -- Check if window has expired
        IF NOW() - window_start > window_interval THEN
            -- Reset window
            UPDATE rate_limits 
            SET count = 1, window_start = NOW()
            WHERE key = limit_key;
            RETURN TRUE;
        END IF;
        
        -- Check if within limit
        IF current_count < max_requests THEN
            UPDATE rate_limits 
            SET count = count + 1
            WHERE key = limit_key;
            RETURN TRUE;
        END IF;
        
        -- Rate limit exceeded
        RETURN FALSE;
        
    EXCEPTION WHEN OTHERS THEN
        -- Release lock on error
        PERFORM pg_advisory_unlock(lock_id);
        RAISE;
    END;
    
    -- Release advisory lock
    PERFORM pg_advisory_unlock(lock_id);
END;
$$ LANGUAGE plpgsql;

-- Test rate limiting
SELECT check_rate_limit('user:123', 5, INTERVAL '1 minute'); -- Should return true
SELECT check_rate_limit('user:123', 5, INTERVAL '1 minute'); -- Should return true
-- ... continue until limit exceeded
```

## Next Steps

In the next lesson, we'll explore partitioning strategies and performance optimization techniques that build upon the concurrency concepts we've covered here.

Understanding PostgreSQL's concurrency model enables you to build applications that scale well under load while maintaining data consistency and avoiding common pitfalls like deadlocks and lock contention.
