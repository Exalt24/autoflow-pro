output "lake_bucket" {
  value = aws_s3_bucket.lake.id
}

output "results_bucket" {
  value = aws_s3_bucket.results.id
}

output "database" {
  value = aws_glue_catalog_database.events.name
}

output "table" {
  value = aws_glue_catalog_table.run_events.name
}

output "workgroup" {
  value = aws_athena_workgroup.events.name
}

output "query_policy_arn" {
  value = aws_iam_policy.query.arn
}

output "telemetry_tables" {
  value = [
    aws_glue_catalog_table.telemetry_readings.name,
    aws_glue_catalog_table.telemetry_rollup_5m.name,
    aws_glue_catalog_table.telemetry_rollup_1h.name,
    aws_glue_catalog_table.telemetry_quarantine.name,
  ]
}

output "telemetry_read_policy_arn" {
  value = aws_iam_policy.telemetry_read.arn
}

output "telemetry_write_policy_arn" {
  value = aws_iam_policy.telemetry_write.arn
}
