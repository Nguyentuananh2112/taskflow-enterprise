# perf/task-read-raw — EXPLAIN (ANALYZE, BUFFERS) trên seed cỡ k6

Postgres 18.6 (postgres-test 5434), DB riêng `taskflow_load_a3`, `load/seed/seed.sql` (ws=5 proj=3 tasks=500 users=20 rproj=2 rtasks=500 ⇒ 27 500 task, 25 project), ANALYZE. SQL + tham số lấy NGUYÊN từ log query của Prisma 7.10 (cả câu cũ lẫn mới). Project có cột TODO 500 task.

```text
project 01a142d9-e8a3-7717-9012-daeb39a36ada

### PRISMA HIỆN TẠI — trang 1 (status=TODO, limit 200)
Limit  (cost=789.42..789.67 rows=100 width=525) (actual time=1.006..1.029 rows=200.00 loops=1)
  Buffers: shared hit=516
  ->  Sort  (cost=789.42..789.67 rows=100 width=525) (actual time=1.005..1.015 rows=200.00 loops=1)
        Sort Key: tasks.rank COLLATE "C", tasks.id
        Sort Method: top-N heapsort  Memory: 76kB
        Buffers: shared hit=516
        ->  Nested Loop  (cost=45.44..786.10 rows=100 width=525) (actual time=0.157..0.784 rows=500.00 loops=1)
              Buffers: shared hit=516
              ->  Nested Loop  (cost=0.00..2.45 rows=1 width=32) (actual time=0.014..0.021 rows=1.00 loops=1)
                    Buffers: shared hit=2
                    ->  Seq Scan on projects j0  (cost=0.00..1.38 rows=1 width=32) (actual time=0.010..0.011 rows=1.00 loops=1)
                          Filter: ((id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                          Rows Removed by Filter: 24
                          Buffers: shared hit=1
                    ->  Seq Scan on workspaces j1  (cost=0.00..1.06 rows=1 width=16) (actual time=0.003..0.007 rows=1.00 loops=1)
                          Filter: ((deleted_at IS NULL) AND (id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                          Rows Removed by Filter: 4
                          Buffers: shared hit=1
              ->  Bitmap Heap Scan on tasks  (cost=45.44..781.65 rows=100 width=465) (actual time=0.140..0.655 rows=500.00 loops=1)
                    Recheck Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus") AND (deleted_at IS NULL))
                    Filter: (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid)
                    Heap Blocks: exact=500
                    Buffers: shared hit=514
                    ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..45.42 rows=500 width=0) (actual time=0.095..0.096 rows=500.00 loops=1)
                          Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus"))
                          Index Searches: 1
                          Buffers: shared hit=14
Planning:
  Buffers: shared hit=1
Planning Time: 0.188 ms
Execution Time: 1.080 ms

### PRISMA HIỆN TẠI — trang 2 (cursor)
Limit  (cost=798.08..798.28 rows=79 width=525) (actual time=0.562..0.579 rows=200.00 loops=1)
  Buffers: shared hit=316
  ->  Sort  (cost=798.08..798.28 rows=79 width=525) (actual time=0.561..0.568 rows=200.00 loops=1)
        Sort Key: tasks.rank COLLATE "C", tasks.id
        Sort Method: quicksort  Memory: 102kB
        Buffers: shared hit=316
        ->  Nested Loop  (cost=56.20..795.59 rows=79 width=525) (actual time=0.095..0.469 rows=300.00 loops=1)
              Buffers: shared hit=316
              ->  Nested Loop  (cost=0.00..2.45 rows=1 width=32) (actual time=0.012..0.014 rows=1.00 loops=1)
                    Buffers: shared hit=2
                    ->  Seq Scan on projects j0  (cost=0.00..1.38 rows=1 width=32) (actual time=0.008..0.009 rows=1.00 loops=1)
                          Filter: ((id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                          Rows Removed by Filter: 24
                          Buffers: shared hit=1
                    ->  Seq Scan on workspaces j1  (cost=0.00..1.06 rows=1 width=16) (actual time=0.003..0.004 rows=1.00 loops=1)
                          Filter: ((deleted_at IS NULL) AND (id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                          Rows Removed by Filter: 4
                          Buffers: shared hit=1
              ->  Bitmap Heap Scan on tasks  (cost=56.20..791.56 rows=79 width=465) (actual time=0.080..0.400 rows=300.00 loops=1)
                    Recheck Cond: (((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ANY (ARRAY[('IN_PROGRESS'::cstring)::"TaskStatus", ('REVIEW'::cstring)::"TaskStatus", ('DONE'::cstring)::"TaskStatus"])) AND (status = ('TODO'::cstring)::"TaskStatus") AND (deleted_at IS NULL)) OR ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus") AND (status = ('TODO'::cstring)::"TaskStatus") AND (rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (deleted_at IS NULL)) OR ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus") AND (status = ('TODO'::cstring)::"TaskStatus") AND (rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (deleted_at IS NULL)))
                    Filter: ((workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus") AND ((status = ANY (ARRAY[('IN_PROGRESS'::cstring)::"TaskStatus", ('REVIEW'::cstring)::"TaskStatus", ('DONE'::cstring)::"TaskStatus"])) OR ((status = ('TODO'::cstring)::"TaskStatus") AND (rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text)) OR ((status = ('TODO'::cstring)::"TaskStatus") AND (rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (id > '01a142d9-e903-70d6-8abf-9d8ffd607b32'::uuid))))
                    Rows Removed by Filter: 1
                    Heap Blocks: exact=301
                    Buffers: shared hit=314
                    ->  BitmapOr  (cost=56.20..56.20 rows=464 width=0) (actual time=0.049..0.049 rows=0.00 loops=1)
                          Buffers: shared hit=13
                          ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..41.95 rows=375 width=0) (actual time=0.003..0.003 rows=0.00 loops=1)
                                Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ANY (ARRAY[('IN_PROGRESS'::cstring)::"TaskStatus", ('REVIEW'::cstring)::"TaskStatus", ('DONE'::cstring)::"TaskStatus"])) AND (status = ('TODO'::cstring)::"TaskStatus"))
                                Index Searches: 0
                          ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..9.76 rows=89 width=0) (actual time=0.043..0.043 rows=300.00 loops=1)
                                Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus") AND (status = ('TODO'::cstring)::"TaskStatus") AND (rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text))
                                Index Searches: 1
                                Buffers: shared hit=10
                          ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..4.44 rows=1 width=0) (actual time=0.002..0.002 rows=1.00 loops=1)
                                Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = ('TODO'::cstring)::"TaskStatus") AND (status = ('TODO'::cstring)::"TaskStatus") AND (rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text))
                                Index Searches: 1
                                Buffers: shared hit=3
Planning:
  Buffers: shared hit=1
Planning Time: 0.233 ms
Execution Time: 0.639 ms

### PRISMA HIỆN TẠI — không lọc status, cursor
Limit  (cost=996.89..997.39 rows=200 width=525) (actual time=3.847..3.865 rows=200.00 loops=1)
  Buffers: shared hit=559
  ->  Sort  (cost=996.89..997.69 rows=318 width=525) (actual time=3.846..3.854 rows=200.00 loops=1)
        Sort Key: tasks.status, tasks.rank COLLATE "C", tasks.id
        Sort Method: top-N heapsort  Memory: 102kB
        Buffers: shared hit=559
        ->  Nested Loop  (cost=79.37..983.67 rows=318 width=525) (actual time=0.183..2.565 rows=1800.00 loops=1)
              Buffers: shared hit=559
              ->  Nested Loop  (cost=0.00..2.45 rows=1 width=32) (actual time=0.011..0.017 rows=1.00 loops=1)
                    Buffers: shared hit=2
                    ->  Seq Scan on projects j0  (cost=0.00..1.38 rows=1 width=32) (actual time=0.008..0.009 rows=1.00 loops=1)
                          Filter: ((id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                          Rows Removed by Filter: 24
                          Buffers: shared hit=1
                    ->  Seq Scan on workspaces j1  (cost=0.00..1.06 rows=1 width=16) (actual time=0.003..0.005 rows=1.00 loops=1)
                          Filter: ((deleted_at IS NULL) AND (id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                          Rows Removed by Filter: 4
                          Buffers: shared hit=1
              ->  Bitmap Heap Scan on tasks  (cost=79.37..974.87 rows=318 width=465) (actual time=0.171..2.115 rows=1800.00 loops=1)
                    Recheck Cond: (project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid)
                    Filter: ((deleted_at IS NULL) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid) AND ((status = ANY (ARRAY[('IN_PROGRESS'::cstring)::"TaskStatus", ('REVIEW'::cstring)::"TaskStatus", ('DONE'::cstring)::"TaskStatus"])) OR ((status = ('TODO'::cstring)::"TaskStatus") AND (rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text)) OR ((status = ('TODO'::cstring)::"TaskStatus") AND (rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (id > '01a142d9-e903-70d6-8abf-9d8ffd607b32'::uuid))))
                    Rows Removed by Filter: 200
                    Heap Blocks: exact=540
                    Buffers: shared hit=557
                    ->  Bitmap Index Scan on tasks_project_id_number_key  (cost=0.00..79.29 rows=2000 width=0) (actual time=0.118..0.118 rows=2000.00 loops=1)
                          Index Cond: (project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=17
Planning:
  Buffers: shared hit=1
Planning Time: 0.193 ms
Execution Time: 3.907 ms

### RAW MỚI — trang 1
Limit  (cost=795.80..796.05 rows=100 width=550) (actual time=1.241..1.268 rows=200.00 loops=1)
  Buffers: shared hit=520
  ->  Sort  (cost=795.80..796.05 rows=100 width=550) (actual time=1.238..1.253 rows=200.00 loops=1)
        Sort Key: t.rank COLLATE "C", t.id
        Sort Method: top-N heapsort  Memory: 76kB
        Buffers: shared hit=520
        ->  Nested Loop Left Join  (cost=49.84..792.48 rows=100 width=550) (actual time=0.245..0.978 rows=500.00 loops=1)
              Buffers: shared hit=520
              ->  Hash Left Join  (cost=49.69..787.11 rows=100 width=479) (actual time=0.229..0.792 rows=500.00 loops=1)
                    Hash Cond: (t.assignee_id = a.id)
                    Buffers: shared hit=518
                    ->  Nested Loop  (cost=45.44..782.59 rows=100 width=468) (actual time=0.198..0.712 rows=500.00 loops=1)
                          Buffers: shared hit=516
                          ->  Nested Loop  (cost=0.00..2.45 rows=1 width=51) (actual time=0.033..0.039 rows=1.00 loops=1)
                                Buffers: shared hit=2
                                ->  Seq Scan on projects p  (cost=0.00..1.38 rows=1 width=35) (actual time=0.023..0.025 rows=1.00 loops=1)
                                      Filter: ((id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                                      Rows Removed by Filter: 24
                                      Buffers: shared hit=1
                                ->  Seq Scan on workspaces w  (cost=0.00..1.06 rows=1 width=16) (actual time=0.007..0.010 rows=1.00 loops=1)
                                      Filter: ((deleted_at IS NULL) AND (id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                                      Rows Removed by Filter: 4
                                      Buffers: shared hit=1
                          ->  Bitmap Heap Scan on tasks t  (cost=45.44..779.15 rows=100 width=465) (actual time=0.162..0.585 rows=500.00 loops=1)
                                Recheck Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = 'TODO'::"TaskStatus") AND (deleted_at IS NULL))
                                Filter: (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid)
                                Heap Blocks: exact=500
                                Buffers: shared hit=514
                                ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..45.41 rows=500 width=0) (actual time=0.116..0.116 rows=500.00 loops=1)
                                      Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = 'TODO'::"TaskStatus"))
                                      Index Searches: 1
                                      Buffers: shared hit=14
                    ->  Hash  (cost=3.00..3.00 rows=100 width=27) (actual time=0.028..0.030 rows=100.00 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 14kB
                          Buffers: shared hit=2
                          ->  Seq Scan on users a  (cost=0.00..3.00 rows=100 width=27) (actual time=0.006..0.012 rows=100.00 loops=1)
                                Buffers: shared hit=2
              ->  Memoize  (cost=0.15..0.33 rows=1 width=27) (actual time=0.000..0.000 rows=1.00 loops=500)
                    Cache Key: t.created_by_id
                    Cache Mode: logical
                    Hits: 499  Misses: 1  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                    Buffers: shared hit=2
                    ->  Index Scan using users_pkey on users c  (cost=0.14..0.32 rows=1 width=27) (actual time=0.009..0.009 rows=1.00 loops=1)
                          Index Cond: (id = t.created_by_id)
                          Index Searches: 1
                          Buffers: shared hit=2
Planning:
  Buffers: shared hit=7
Planning Time: 0.726 ms
Execution Time: 1.396 ms

### RAW MỚI — trang 2 (cursor)
Limit  (cost=691.23..691.41 rows=71 width=550) (actual time=0.852..0.873 rows=200.00 loops=1)
  Buffers: shared hit=320
  ->  Sort  (cost=691.23..691.41 rows=71 width=550) (actual time=0.850..0.860 rows=200.00 loops=1)
        Sort Key: t.rank COLLATE "C", t.id
        Sort Method: quicksort  Memory: 102kB
        Buffers: shared hit=320
        ->  Nested Loop Left Join  (cost=41.71..689.05 rows=71 width=550) (actual time=0.215..0.737 rows=300.00 loops=1)
              Buffers: shared hit=320
              ->  Hash Left Join  (cost=41.56..684.31 rows=71 width=479) (actual time=0.202..0.608 rows=300.00 loops=1)
                    Hash Cond: (t.assignee_id = a.id)
                    Buffers: shared hit=318
                    ->  Nested Loop  (cost=37.31..679.88 rows=71 width=468) (actual time=0.151..0.526 rows=300.00 loops=1)
                          Buffers: shared hit=316
                          ->  Nested Loop  (cost=0.00..2.45 rows=1 width=51) (actual time=0.029..0.034 rows=1.00 loops=1)
                                Buffers: shared hit=2
                                ->  Seq Scan on projects p  (cost=0.00..1.38 rows=1 width=35) (actual time=0.022..0.023 rows=1.00 loops=1)
                                      Filter: ((id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                                      Rows Removed by Filter: 24
                                      Buffers: shared hit=1
                                ->  Seq Scan on workspaces w  (cost=0.00..1.06 rows=1 width=16) (actual time=0.006..0.007 rows=1.00 loops=1)
                                      Filter: ((deleted_at IS NULL) AND (id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                                      Rows Removed by Filter: 4
                                      Buffers: shared hit=1
                          ->  Bitmap Heap Scan on tasks t  (cost=37.31..676.72 rows=71 width=465) (actual time=0.119..0.458 rows=300.00 loops=1)
                                Recheck Cond: (((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = 'TODO'::"TaskStatus") AND (rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (deleted_at IS NULL)) OR ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = 'TODO'::"TaskStatus") AND (rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (deleted_at IS NULL)))
                                Filter: ((workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid) AND ((rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) OR ((rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (id > '01a142d9-e903-70d6-8abf-9d8ffd607b32'::uuid))))
                                Rows Removed by Filter: 1
                                Heap Blocks: exact=301
                                Buffers: shared hit=314
                                ->  BitmapOr  (cost=37.31..37.31 rows=355 width=0) (actual time=0.074..0.075 rows=0.00 loops=1)
                                      Buffers: shared hit=13
                                      ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..32.85 rows=355 width=0) (actual time=0.069..0.070 rows=300.00 loops=1)
                                            Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = 'TODO'::"TaskStatus") AND (rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text))
                                            Index Searches: 1
                                            Buffers: shared hit=10
                                      ->  Bitmap Index Scan on tasks_rank_live_key  (cost=0.00..4.42 rows=1 width=0) (actual time=0.003..0.004 rows=1.00 loops=1)
                                            Index Cond: ((project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (status = 'TODO'::"TaskStatus") AND (rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text))
                                            Index Searches: 1
                                            Buffers: shared hit=3
                    ->  Hash  (cost=3.00..3.00 rows=100 width=27) (actual time=0.039..0.039 rows=100.00 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 14kB
                          Buffers: shared hit=2
                          ->  Seq Scan on users a  (cost=0.00..3.00 rows=100 width=27) (actual time=0.006..0.017 rows=100.00 loops=1)
                                Buffers: shared hit=2
              ->  Memoize  (cost=0.15..0.40 rows=1 width=27) (actual time=0.000..0.000 rows=1.00 loops=300)
                    Cache Key: t.created_by_id
                    Cache Mode: logical
                    Hits: 299  Misses: 1  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                    Buffers: shared hit=2
                    ->  Index Scan using users_pkey on users c  (cost=0.14..0.39 rows=1 width=27) (actual time=0.005..0.005 rows=1.00 loops=1)
                          Index Cond: (id = t.created_by_id)
                          Index Searches: 1
                          Buffers: shared hit=2
Planning:
  Buffers: shared hit=7
Planning Time: 0.682 ms
Execution Time: 0.998 ms

### RAW MỚI — không lọc status, cursor
Limit  (cost=953.64..954.14 rows=200 width=550) (actual time=3.112..3.132 rows=200.00 loops=1)
  Buffers: shared hit=563
  ->  Sort  (cost=953.64..954.44 rows=318 width=550) (actual time=3.111..3.121 rows=200.00 loops=1)
        Sort Key: t.status, t.rank COLLATE "C", t.id
        Sort Method: top-N heapsort  Memory: 102kB
        Buffers: shared hit=563
        ->  Nested Loop Left Join  (cost=83.77..940.43 rows=318 width=550) (actual time=0.210..2.018 rows=1800.00 loops=1)
              Buffers: shared hit=563
              ->  Hash Left Join  (cost=83.62..928.09 rows=318 width=479) (actual time=0.202..1.322 rows=1800.00 loops=1)
                    Hash Cond: (t.assignee_id = a.id)
                    Buffers: shared hit=561
                    ->  Nested Loop  (cost=79.37..922.99 rows=318 width=468) (actual time=0.177..1.112 rows=1800.00 loops=1)
                          Buffers: shared hit=559
                          ->  Nested Loop  (cost=0.00..2.45 rows=1 width=51) (actual time=0.014..0.018 rows=1.00 loops=1)
                                Buffers: shared hit=2
                                ->  Seq Scan on projects p  (cost=0.00..1.38 rows=1 width=35) (actual time=0.010..0.011 rows=1.00 loops=1)
                                      Filter: ((id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                                      Rows Removed by Filter: 24
                                      Buffers: shared hit=1
                                ->  Seq Scan on workspaces w  (cost=0.00..1.06 rows=1 width=16) (actual time=0.003..0.005 rows=1.00 loops=1)
                                      Filter: ((deleted_at IS NULL) AND (id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid))
                                      Rows Removed by Filter: 4
                                      Buffers: shared hit=1
                          ->  Bitmap Heap Scan on tasks t  (cost=79.37..917.37 rows=318 width=465) (actual time=0.163..0.922 rows=1800.00 loops=1)
                                Recheck Cond: (project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid)
                                Filter: ((deleted_at IS NULL) AND (workspace_id = '01a142d9-e7fc-73e5-ad23-8a04644afed5'::uuid) AND ((status > 'TODO'::"TaskStatus") OR ((status = 'TODO'::"TaskStatus") AND ((rank > 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) OR ((rank = 'a0VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV3H'::text) AND (id > '01a142d9-e903-70d6-8abf-9d8ffd607b32'::uuid))))))
                                Rows Removed by Filter: 200
                                Heap Blocks: exact=540
                                Buffers: shared hit=557
                                ->  Bitmap Index Scan on tasks_project_id_number_key  (cost=0.00..79.29 rows=2000 width=0) (actual time=0.113..0.114 rows=2000.00 loops=1)
                                      Index Cond: (project_id = '01a142d9-e8a3-7717-9012-daeb39a36ada'::uuid)
                                      Index Searches: 1
                                      Buffers: shared hit=17
                    ->  Hash  (cost=3.00..3.00 rows=100 width=27) (actual time=0.021..0.022 rows=100.00 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 14kB
                          Buffers: shared hit=2
                          ->  Seq Scan on users a  (cost=0.00..3.00 rows=100 width=27) (actual time=0.003..0.010 rows=100.00 loops=1)
                                Buffers: shared hit=2
              ->  Memoize  (cost=0.15..0.22 rows=1 width=27) (actual time=0.000..0.000 rows=1.00 loops=1800)
                    Cache Key: t.created_by_id
                    Cache Mode: logical
                    Hits: 1799  Misses: 1  Evictions: 0  Overflows: 0  Memory Usage: 1kB
                    Buffers: shared hit=2
                    ->  Index Scan using users_pkey on users c  (cost=0.14..0.21 rows=1 width=27) (actual time=0.003..0.003 rows=1.00 loops=1)
                          Index Cond: (id = t.created_by_id)
                          Index Searches: 1
                          Buffers: shared hit=2
Planning:
  Buffers: shared hit=7
Planning Time: 0.490 ms
Execution Time: 3.198 ms```
