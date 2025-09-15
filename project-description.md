# Intro 

That project is a website containing PostgreSQL Course for Experienced Developers. The website has a few lessons and it's designed as a blog system. The main page has list of posts, lessons in this case, where each lesson entry has a title and a small description. Every entry on the homepage leads to a page dedicated to that specific lesson. Generally, the structure of the website should remind a blog system. Take a look at [ScalaTut](https://scalatut.greq.me) website for reference.

The website has 10 lessons (the syllabus is below). Each lesson is separate page, whereas the content of the page is built of an MD file stored on the server. Therefore, when entering the page, it should fetch the relevant MD file from the server, and display it with the correct formatting. 


## Syllabys

### Lesson 1: PostgreSQL Architecture & Ecosystem

Overview of Postgres’ process model, storage engine, WAL (Write Ahead Log), MVCC (multi-version concurrency control).

Extensions ecosystem and why Postgres is considered a “platform” as much as a database.

### Lesson 2: Data Types & Advanced Structures

Rich built-in types: arrays, JSON/JSONB, hstore, ranges, UUIDs.

Composite and custom data types.

When to use Postgres’ advanced types instead of NoSQL solutions.

### Lesson 3: Schema Design & Constraints

Postgres’ support for domains, check constraints, exclusion constraints.

Table inheritance vs. partitioning.

Best practices for schema design in Postgres.

### Lesson 4: Query Language Enhancements

Postgres-specific SQL extensions (RETURNING, CTEs, window functions, FILTER, LATERAL).

Working with JSON/JSONB queries.

Full-text search and pattern matching.

### Lesson 5: Indexing Deep Dive

Index types: B-tree, Hash, GIN, GiST, BRIN, SP-GiST.

Covering indexes and partial indexes.

When to use which index type for performance optimization.

### Lesson 6: Concurrency & Transactions

MVCC in practice.

Transaction isolation levels in Postgres.

Row-level locking, advisory locks, and deadlock handling.

### Lesson 7: Partitioning & Performance Optimization

Declarative partitioning vs. table inheritance.

Query planning and the Postgres optimizer.

EXPLAIN/ANALYZE and query tuning techniques.

### Lesson 8: Extensions & Procedural Languages

Key extensions: PostGIS, pgcrypto, pg_partman, citext, etc.

Procedural languages (PL/pgSQL, PL/Python, PL/Perl).

When and how to write custom functions.

### Lesson 9: Replication, High Availability & Scaling

Streaming replication, logical replication, and WAL shipping.

Connection pooling (PgBouncer, Pgpool).

Scaling strategies: sharding, Citus, and FDW (Foreign Data Wrappers).

### Lesson 10: Administration & Best Practices

Backup & recovery (pg_dump, pg_basebackup, PITR).

Monitoring (pg_stat_activity, pg_stat_statements, extensions like pgBadger).

Security (roles, privileges, row-level security, auditing).