-- Migration: 031_pipeline_job_graph.down.sql
-- Service: xstockstrat-analysis, feature pipeline-job-graph. The edge table drops first; indexes drop with their tables.

DROP TABLE IF EXISTS analysis.pipeline_job_deps;
DROP TABLE IF EXISTS analysis.pipeline_jobs;
