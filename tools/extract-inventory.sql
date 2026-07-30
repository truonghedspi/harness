-- extract-inventory.sql — enumerate every logic-bearing object in TimesTen.
-- Run: ttIsql -connStr "DSN=<reference-dsn>" -f tools/extract-inventory.sql > inventory/raw-inventory.txt
-- Then transform raw output into inventory/inventory.json (feat-001 builds that transform).
--
-- NOTE: dictionary view availability differs across TimesTen versions/configurations.
-- Verify each section against your instance; where a view is missing, use the ttIsql
-- built-in command noted in the comment. Never hand-edit the JSON output — fix this script.

-- 1. PL/SQL units (procedures, functions, packages)
SELECT owner, object_name, object_type, status
  FROM all_objects
 WHERE object_type IN ('PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY')
 ORDER BY owner, object_name, object_type;

-- 1b. Full source text — hashed per unit into sourceHash
SELECT owner, name, type, line, text
  FROM all_source
 ORDER BY owner, name, type, line;

-- 2. Views (ttIsql alternative: "views;")
SELECT owner, view_name, text FROM all_views ORDER BY owner, view_name;

-- 2b. Materialized views — check object_type in ALL_OBJECTS on your version
SELECT owner, object_name
  FROM all_objects
 WHERE object_type LIKE '%MATERIALIZED%'
 ORDER BY owner, object_name;

-- 3. Sequences (ttIsql alternative: "sequences;")
SELECT sequence_owner, sequence_name, min_value, max_value, increment_by, cycle_flag
  FROM all_sequences ORDER BY sequence_owner, sequence_name;

-- 4. Check constraints and defaults carrying business meaning
SELECT owner, table_name, constraint_name, search_condition
  FROM all_constraints
 WHERE constraint_type = 'C'
 ORDER BY owner, table_name, constraint_name;

SELECT owner, table_name, column_name, data_default
  FROM all_tab_columns
 WHERE data_default IS NOT NULL
 ORDER BY owner, table_name, column_name;

-- 5. Cache groups (TimesTen-specific). ttIsql command: "cachegroups;"
--    Capture full definitions INCLUDING aging policies — aging is business logic.

-- 6. Dependency edges (drives unit ordering / call graph in feat-005)
SELECT owner, name, type, referenced_owner, referenced_name, referenced_type
  FROM all_dependencies
 ORDER BY owner, name;

-- 7. Application-side SQL lives OUTSIDE the database.
--    Enumerate app repositories in inventory/sources.yaml and extract embedded SQL
--    as inventory units too (see docs/01-logic-inventory.md §7).
