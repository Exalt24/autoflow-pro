data "aws_caller_identity" "current" {
  count = var.account_id == null ? 1 : 0
}

data "aws_partition" "current" {}

locals {
  account_id     = coalesce(var.account_id, one(data.aws_caller_identity.current[*].account_id))
  suffix         = coalesce(var.bucket_suffix, local.account_id)
  lake_name      = "${var.name_prefix}-lake-${local.suffix}"
  results_name   = "${var.name_prefix}-athena-results-${local.suffix}"
  results_prefix = "queries/"
  database_name  = "${var.name_prefix}_events"
  table_name     = "run_events"
  iceberg_table  = "run_events_iceberg"
  iceberg_prefix = "iceberg/"
  workgroup_name = "${var.name_prefix}-events"
  partition      = data.aws_partition.current.partition
  lake_arn       = "arn:${local.partition}:s3:::${local.lake_name}"
  results_arn    = "arn:${local.partition}:s3:::${local.results_name}"
  glue_arn       = "arn:${local.partition}:glue:${var.region}:${local.account_id}"
  athena_arn     = "arn:${local.partition}:athena:${var.region}:${local.account_id}:workgroup/${local.workgroup_name}"
}

# ---------------------------------------------------------------- the two buckets

resource "aws_s3_bucket" "lake" {
  bucket        = local.lake_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket" "results" {
  bucket        = local.results_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "lake" {
  bucket = aws_s3_bucket.lake.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "results" {
  bucket = aws_s3_bucket.results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lake" {
  bucket = aws_s3_bucket.lake.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "lake" {
  bucket = aws_s3_bucket.lake.id

  rule {
    id     = "expire-run-events"
    status = "Enabled"

    filter {
      prefix = var.events_prefix
    }

    expiration {
      days = var.events_expiry_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  rule {
    id     = "expire-query-results"
    status = "Enabled"

    filter {
      prefix = local.results_prefix
    }

    expiration {
      days = var.results_expiry_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# ---------------------------------------------------------------- the Glue database and the table over the events

resource "aws_glue_catalog_database" "events" {
  name        = local.database_name
  description = "AutoFlow Pro run events written to S3 as one JSON document per line"
}

# External table over events/dt=YYYY-MM-DD/*.json. Partition projection generates the dt values from the date range,
# so no crawler and no ALTER TABLE ADD PARTITION is needed when a new day starts.
resource "aws_glue_catalog_table" "run_events" {
  name          = local.table_name
  database_name = aws_glue_catalog_database.events.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    EXTERNAL                      = "TRUE"
    classification                = "json"
    "projection.enabled"          = "true"
    "projection.dt.type"          = "date"
    "projection.dt.format"        = "yyyy-MM-dd"
    "projection.dt.range"         = "${var.projection_start_day},NOW"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
    "storage.location.template"   = "s3://${aws_s3_bucket.lake.bucket}/${var.events_prefix}dt=$${dt}/"
  }

  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.lake.bucket}/${var.events_prefix}"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"
    }

    columns {
      name = "execution_id"
      type = "string"
    }
    columns {
      name = "workflow_id"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "status"
      type = "string"
    }
    columns {
      name = "duration_ms"
      type = "bigint"
    }
    columns {
      name = "event_time"
      type = "string"
    }
  }
}

# ---------------------------------------------------------------- the workgroup

resource "aws_athena_workgroup" "events" {
  name          = local.workgroup_name
  description   = "Queries over the AutoFlow Pro run events"
  state         = "ENABLED"
  force_destroy = var.force_destroy

  configuration {
    # The workgroup's result location and encryption win over whatever a client sends.
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    bytes_scanned_cutoff_per_query     = var.bytes_scanned_cutoff

    result_configuration {
      output_location = "s3://${aws_s3_bucket.results.bucket}/${local.results_prefix}"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }

    engine_version {
      selected_engine_version = "AUTO"
    }
  }
}

# ---------------------------------------------------------------- what the backend needs to run queries

# Start, read and stop queries in this workgroup only; read the one table; read the events prefix; write and read the
# results prefix. Nothing else in either bucket and nothing outside them.
resource "aws_iam_policy" "query" {
  name        = "${var.name_prefix}-athena-query"
  description = "Run Athena queries over the AutoFlow Pro run events"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunQueriesInTheWorkgroup"
        Effect   = "Allow"
        Action   = ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults", "athena:StopQueryExecution"]
        Resource = local.athena_arn
      },
      {
        Sid    = "ReadTheTable"
        Effect = "Allow"
        Action = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]
        Resource = [
          "${local.glue_arn}:catalog",
          "${local.glue_arn}:database/${local.database_name}",
          "${local.glue_arn}:table/${local.database_name}/${local.table_name}",
          "${local.glue_arn}:table/${local.database_name}/${local.iceberg_table}",
        ]
      },
      {
        # CREATE TABLE and INSERT on the Iceberg copy: Athena creates the table in the Glue catalog and commits each insert by updating it.
        Sid    = "ManageTheIcebergTable"
        Effect = "Allow"
        Action = ["glue:CreateTable", "glue:UpdateTable"]
        Resource = [
          "${local.glue_arn}:catalog",
          "${local.glue_arn}:database/${local.database_name}",
          "${local.glue_arn}:table/${local.database_name}/${local.iceberg_table}",
        ]
      },
      {
        Sid      = "WriteTheIcebergFiles"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = "${local.lake_arn}/${local.iceberg_prefix}*"
      },
      {
        Sid      = "ReadTheEvents"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${local.lake_arn}/${var.events_prefix}*"
      },
      {
        Sid       = "ListTheEventsAndIceberg"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = local.lake_arn
        Condition = { StringLike = { "s3:prefix" = ["${var.events_prefix}*", "${local.iceberg_prefix}*"] } }
      },
      {
        Sid      = "WriteAndReadResults"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
        Resource = "${local.results_arn}/${local.results_prefix}*"
      },
      {
        Sid       = "ListTheResults"
        Effect    = "Allow"
        Action    = ["s3:ListBucket"]
        Resource  = local.results_arn
        Condition = { StringLike = { "s3:prefix" = ["${local.results_prefix}*"] } }
      },
      {
        # Athena asks where each bucket lives. The request carries no prefix, so this cannot share a statement with a prefix condition.
        Sid      = "FindTheBuckets"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = [local.lake_arn, local.results_arn]
      },
    ]
  })
}
